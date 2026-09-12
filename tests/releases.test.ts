import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { ApiError } from '../server/git-command.js';
import { ReleasesService, createReleasesRouter, parseGitHubRemote } from '../server/releases.js';

const TOKEN = 'github_pat_test_memory_only_not_a_real_secret';
const repo = { id: 'test-repo', name: 'work', path: 'C:/test-repo' };
const repositories = {
  get: (id: string) => {
    assert.equal(id, repo.id);
    return repo;
  },
};
const release = {
  id: 21,
  tag_name: 'v1.2.0',
  name: 'Version 1.2',
  body: 'Changes',
  draft: true,
  prerelease: false,
  created_at: '2026-09-12T00:00:00Z',
  published_at: null,
  html_url: 'https://github.com/octocat/project/releases/tag/v1.2.0',
  upload_url: 'https://uploads.github.com/repos/octocat/project/releases/21/assets{?name,label}',
  assets: [],
};
const asset = {
  id: 8,
  name: 'app.zip',
  size: 4,
  download_count: 0,
  browser_download_url: 'https://github.com/octocat/project/releases/download/v1.2.0/app.zip',
};
const git = async (_cwd: string, args: string[]) =>
  args[0] === 'remote'
    ? 'origin\thttps://github.com/octocat/project.git (fetch)\norigin\thttps://github.com/octocat/project.git (push)\n'
    : '';
type Call = { url: string; init: RequestInit };
function harness(handler: (call: Call) => Response | Promise<Response> = () => Response.json({})) {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    assert.equal(call.init.redirect, 'error');
    assert.match(call.url, /^https:\/\/(api|uploads)\.github\.com\//);
    if (call.url === 'https://api.github.com/user') return Response.json({ login: 'octocat' });
    return handler(call);
  }) as typeof fetch;
  return { service: new ReleasesService(repositories, { git, fetch: fetcher }), calls, fetcher };
}

test('GitHub remote detection accepts HTTPS/SSH and rejects alternate hosts and malformed paths', () => {
  const expected = { owner: 'octocat', repository: 'project' };
  for (const input of [
    'https://github.com/octocat/project.git',
    'git@github.com:octocat/project.git',
    'ssh://git@github.com/octocat/project.git',
    'https://embedded-token@github.com/octocat/project',
  ])
    assert.deepEqual(parseGitHubRemote(input), expected);
  for (const input of [
    'https://github.com.attacker.test/octocat/project',
    'https://github.com@attacker.test/octocat/project',
    'http://github.com/octocat/project',
    'https://github.com/octocat/project/extra',
    'https://github.com/octocat/%2e%2e',
    'C:/repo',
    'ext::danger',
    'https://github.com:8080/octocat/project',
  ])
    assert.equal(parseGitHubRemote(input), null);
});

test('tokens are validated on explicit connect, remain private and disappear on clear/new service', async () => {
  const h = harness(() => Response.json([release]));
  let state = await h.service.list(repo.id);
  assert.equal(state.available, true);
  assert.equal(state.authenticated, false);
  assert.equal(h.calls.length, 0);
  await assert.rejects(
    h.service.create(repo.id, { tag: 'v1.2.0' }),
    (error: unknown) => error instanceof ApiError && error.status === 401,
  );
  const connected = await h.service.connect(repo.id, TOKEN);
  assert.deepEqual(connected, { authenticated: true, login: 'octocat' });
  state = await h.service.list(repo.id);
  assert.equal(state.authenticated, true);
  assert.equal(state.releases[0].tag, 'v1.2.0');
  assert.ok(!JSON.stringify(state).includes(TOKEN));
  assert.ok(!JSON.stringify(connected).includes(TOKEN));
  assert.equal(
    (await new ReleasesService(repositories, { git, fetch: h.fetcher }).list(repo.id))
      .authenticated,
    false,
  );
  h.service.clear(repo.id);
  assert.equal((await h.service.list(repo.id)).authenticated, false);
  assert.equal(h.calls.length, 2);
});

test('forgetting a removed repository clears credentials without reading the removed registry entry', async () => {
  const h = harness(() => Response.json([release]));
  let removed = false;
  const service = new ReleasesService(
    {
      get: (id) => {
        if (removed) throw new ApiError(404, 'Repository removed');
        return repositories.get(id);
      },
    },
    { git, fetch: h.fetcher },
  );
  await service.connect(repo.id, TOKEN);
  removed = true;
  assert.deepEqual(service.forgetRepository(repo.id), { authenticated: false });
  removed = false;
  assert.equal((await service.list(repo.id)).authenticated, false);
});

test('draft creation checks the remote tag and preserves literal title/notes in structured JSON', async () => {
  const notes = '## Release\nA literal $(echo nope), `code`, and "quoted" text.';
  const h = harness((call) =>
    call.url.includes('/git/ref/tags/')
      ? Response.json({ ref: 'refs/tags/v1.2.0' })
      : Response.json({ ...release, body: notes }, { status: 201 }),
  );
  await h.service.connect(repo.id, TOKEN);
  const created = await h.service.create(repo.id, { tag: 'v1.2.0', title: 'New version', notes });
  assert.equal(created.draft, true);
  assert.equal(created.notes, notes);
  assert.match(h.calls[1].url, /\/git\/ref\/tags\/v1.2.0$/);
  const body = JSON.parse(String(h.calls[2].init.body));
  assert.deepEqual(body, {
    tag_name: 'v1.2.0',
    name: 'New version',
    body: notes,
    draft: true,
    prerelease: false,
  });
  assert.equal(h.calls[2].init.method, 'POST');
  assert.equal(new Headers(h.calls[2].init.headers).get('Authorization'), `Bearer ${TOKEN}`);
});

test('missing remote tags prevent creation and invalid credentials never persist', async () => {
  const h = harness(() => Response.json({ message: `secret ${TOKEN}` }, { status: 404 }));
  await h.service.connect(repo.id, TOKEN);
  await assert.rejects(h.service.create(repo.id, { tag: 'v-missing' }), /先推送该标签/);
  assert.equal(h.calls.filter((call) => call.init.method === 'POST').length, 0);
  const bad = new ReleasesService(repositories, {
    git,
    fetch: (async () => Response.json({ message: TOKEN }, { status: 401 })) as typeof fetch,
  });
  await assert.rejects(
    bad.connect(repo.id, TOKEN),
    (error: unknown) =>
      error instanceof ApiError && error.status === 401 && !error.message.includes(TOKEN),
  );
  assert.equal((await bad.list(repo.id)).authenticated, false);
});

test('binary upload verifies selected repo/release and sends exact bytes to its allowlisted upload URL', async () => {
  const bytes = Buffer.from([0, 1, 128, 255]);
  const h = harness((call) =>
    call.url.startsWith('https://uploads.')
      ? Response.json(asset, { status: 201 })
      : Response.json(release),
  );
  await h.service.connect(repo.id, TOKEN);
  const result = await h.service.upload(repo.id, '21', 'app.zip', bytes);
  assert.equal(result.name, 'app.zip');
  assert.equal(h.calls[1].url, 'https://api.github.com/repos/octocat/project/releases/21');
  assert.equal(
    h.calls[2].url,
    'https://uploads.github.com/repos/octocat/project/releases/21/assets?name=app.zip',
  );
  assert.equal(h.calls[2].init.method, 'POST');
  assert.equal(
    new Headers(h.calls[2].init.headers).get('Content-Type'),
    'application/octet-stream',
  );
  assert.deepEqual(Buffer.from(h.calls[2].init.body as Uint8Array), bytes);
});

test('uploads reject invalid IDs, filenames, duplicates, foreign release IDs and unsafe upload URLs', async () => {
  const cases = [
    { value: { ...release, id: 22 }, pattern: /当前仓库/ },
    { value: { ...release, upload_url: 'https://attacker.test/receive' }, pattern: /安全校验/ },
    {
      value: {
        ...release,
        upload_url: 'https://uploads.github.com/repos/other/project/releases/21/assets',
      },
      pattern: /安全校验/,
    },
    { value: { ...release, assets: [asset] }, pattern: /同名附件/ },
    { value: { ...release, immutable: true }, pattern: /已锁定/ },
  ];
  for (const { value, pattern } of cases) {
    const h = harness(() => Response.json(value));
    await h.service.connect(repo.id, TOKEN);
    await assert.rejects(h.service.upload(repo.id, 21, 'app.zip', Buffer.from('test')), pattern);
    assert.equal(h.calls.filter((call) => call.init.method === 'POST').length, 0);
  }
  const h = harness();
  await h.service.connect(repo.id, TOKEN);
  for (const invalid of ['-1', '21/../22', '1e3', 0, 1.5])
    await assert.rejects(
      h.service.upload(repo.id, invalid, 'file.zip', Buffer.from('x')),
      /ID 无效/,
    );
  for (const name of ['../file.zip', 'dir/file.zip', 'a\\b.zip', 'a\nb.zip'])
    await assert.rejects(h.service.upload(repo.id, 21, name, Buffer.from('x')), /路径或控制字符/);
  await assert.rejects(h.service.upload(repo.id, 21, 'empty.zip', Buffer.alloc(0)), /非空/);
  await assert.rejects(
    h.service.upload(repo.id, 21, 'large.zip', Buffer.alloc(100 * 1024 * 1024 + 1)),
    /100 MB/,
  );
});

test('publishing validates ownership and only PATCHes draft:false after an explicit call', async () => {
  const h = harness((call) =>
    Response.json(call.init.method === 'PATCH' ? { ...release, draft: false } : release),
  );
  await h.service.connect(repo.id, TOKEN);
  const result = await h.service.publish(repo.id, 21);
  assert.equal(result.draft, false);
  assert.equal(h.calls[1].url, 'https://api.github.com/repos/octocat/project/releases/21');
  assert.equal(h.calls[2].url, h.calls[1].url);
  assert.equal(h.calls[2].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(h.calls[2].init.body)), { draft: false });
  const wrong = harness(() => Response.json({ ...release, id: 99 }));
  await wrong.service.connect(repo.id, TOKEN);
  await assert.rejects(wrong.service.publish(repo.id, 21), /当前仓库/);
  assert.ok(!wrong.calls.some((call) => call.init.method === 'PATCH'));
});

test('network failures and API error bodies never leak tokens and mutations are not retried', async () => {
  const h = harness((call) => {
    if (call.url.includes('/git/ref/tags/')) return Response.json({ ref: 'refs/tags/v1.2.0' });
    throw new Error(`request failure with ${TOKEN}`);
  });
  await h.service.connect(repo.id, TOKEN);
  await assert.rejects(
    h.service.create(repo.id, { tag: 'v1.2.0' }),
    (error: unknown) =>
      error instanceof ApiError && /尚未确认/.test(error.message) && !error.message.includes(TOKEN),
  );
  assert.equal(h.calls.filter((call) => call.init.method === 'POST').length, 1);
});

test('release router accepts binary upload and supports auth clear and publish JSON endpoints', async () => {
  const h = harness((call) => {
    if (call.url.startsWith('https://uploads.')) return Response.json(asset, { status: 201 });
    if (call.init.method === 'PATCH') return Response.json({ ...release, draft: false });
    return Response.json(release);
  });
  const app = express();
  app.use(express.json());
  app.use('/api', createReleasesRouter(repositories, { git, fetch: h.fetcher }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/repos/${repo.id}/releases`;
  try {
    const connected = await fetch(`${base}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN }),
    });
    assert.equal(connected.status, 200);
    const uploaded = await fetch(`${base}/21/assets?name=app.zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array([0, 1, 128, 255]),
    });
    assert.equal(uploaded.status, 201);
    const wrongType = await fetch(`${base}/21/assets?name=app.zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(wrongType.status, 415);
    const published = await fetch(`${base}/21/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(published.status, 200);
    const cleared = await fetch(`${base}/auth/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(cleared.status, 200);
    const state = (await (await fetch(base)).json()) as { authenticated: boolean };
    assert.equal(state.authenticated, false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
