import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rename,
  rm,
  rmdir,
  access,
  chmod,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { GitService, parseStatus } from '../server/git-service.js';
import { createApp } from '../server/app.js';
import { ApiError, runGit, safeRelativePath, safeRemoteUrl } from '../server/git-command.js';

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'branchlet-test-'));
  const service = new GitService(path.join(temporary, 'data'), false);
  await service.initialize();
  const repo = await service.init(path.join(temporary, 'repository'));
  await runGit(repo.path, ['config', '--local', 'core.autocrlf', 'false']);
  await service.setConfig(repo.id, { name: '测试用户', email: 'test@example.com' });
  return {
    temporary,
    service,
    repo,
    clean: async () => {
      const resolved = path.resolve(temporary);
      assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
      await rm(resolved, { force: true, recursive: true });
    },
  };
}

test('status parser preserves Unicode/space paths, renames, dual changes and conflicts', () => {
  const result = parseStatus(
    'MM src/中文 file.ts\0R  new name.ts\0old name.ts\0?? hello.txt\0UU conflict.ts\0',
  );
  assert.deepEqual(
    result.staged.map((file) => file.path),
    ['src/中文 file.ts', 'new name.ts'],
  );
  assert.equal(result.staged[1].oldPath, 'old name.ts');
  assert.equal(result.unstaged[0].path, 'src/中文 file.ts');
  assert.equal(result.untracked[0].status, '?');
  assert.equal(result.conflicted.length, 1);
  assert.equal(result.clean, false);
});

test('real repository supports unborn unstage, commit, diff, rename and persisted registry', async () => {
  const ctx = await fixture();
  try {
    const { service, repo } = ctx;
    await writeFile(path.join(repo.path, '中文 file.txt'), 'first\n');
    assert.match((await service.diff(repo.id, '中文 file.txt', false)).diff, /\+first/);
    await service.action(repo.id, { action: 'stage', files: ['中文 file.txt'] });
    await service.action(repo.id, { action: 'unstage', files: ['中文 file.txt'] });
    assert.equal((await service.snapshot(repo.id)).status.untracked.length, 1);
    await service.action(repo.id, { action: 'stage', files: ['中文 file.txt'] });
    await service.action(repo.id, {
      action: 'commit',
      message: 'feat: 第一次提交\n\n完整提交说明。',
    });
    let snapshot = await service.snapshot(repo.id);
    assert.equal(snapshot.status.clean, true);
    assert.equal(snapshot.commits.length, 1);
    assert.equal(snapshot.commits[0].author, '测试用户');
    assert.match(snapshot.commits[0].body, /完整提交说明/);
    const detail = await service.commitDetail(repo.id, snapshot.commits[0].hash);
    assert.equal(detail.files[0].path, '中文 file.txt');
    assert.match(detail.diff, /\+first/);
    await writeFile(path.join(repo.path, '中文 file.txt'), 'first\nsecond\n');
    assert.match((await service.diff(repo.id, '中文 file.txt', false)).diff, /\+second/);
    await service.action(repo.id, { action: 'stage', files: ['中文 file.txt'] });
    await writeFile(path.join(repo.path, '中文 file.txt'), 'first\nsecond\nthird\n');
    await service.action(repo.id, { action: 'discard', files: ['中文 file.txt'] });
    assert.equal(await readFile(path.join(repo.path, '中文 file.txt'), 'utf8'), 'first\nsecond\n');
    assert.match((await service.diff(repo.id, '中文 file.txt', true)).diff, /\+second/);
    await service.action(repo.id, { action: 'commit', message: 'feat: 第二次提交' });
    await rename(path.join(repo.path, '中文 file.txt'), path.join(repo.path, 'renamed file.txt'));
    await service.action(repo.id, {
      action: 'stage',
      files: ['中文 file.txt', 'renamed file.txt'],
    });
    snapshot = await service.snapshot(repo.id);
    assert.equal(snapshot.status.staged[0].oldPath, '中文 file.txt');
    await service.action(repo.id, { action: 'unstage', files: ['renamed file.txt'] });
    assert.equal((await service.snapshot(repo.id)).status.staged.length, 0);
    const reopened = new GitService(service.dataDir, false);
    await reopened.initialize();
    assert.equal(reopened.list()[0].id, repo.id);
  } finally {
    await ctx.clean();
  }
});

test('removing a repository persists across restarts, preserves files and allows reopening', async () => {
  const ctx = await fixture();
  try {
    const { service, repo } = ctx;
    await writeFile(path.join(repo.path, 'my-work.txt'), 'keep my work');
    assert.deepEqual(await service.remove(repo.id), []);
    assert.equal(await readFile(path.join(repo.path, 'my-work.txt'), 'utf8'), 'keep my work');
    assert.equal((await runGit(repo.path, ['rev-parse', '--is-inside-work-tree'])).trim(), 'true');
    await assert.rejects(
      service.remove(repo.id),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    const restarted = new GitService(service.dataDir, false);
    await restarted.initialize();
    assert.deepEqual(restarted.list(), []);
    assert.equal((await restarted.open(repo.path)).id, repo.id);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(service.dataDir, 'repos.json'), 'utf8')).map(
        (saved: { id: string }) => saved.id,
      ),
      [repo.id],
    );
  } finally {
    await ctx.clean();
  }
});

test('failed registry writes restore the removed entry and leave the save queue usable', async () => {
  const ctx = await fixture();
  try {
    const { service, repo } = ctx;
    const registry = path.join(service.dataDir, 'repos.json'),
      backup = path.join(service.dataDir, 'repos.backup.json');
    await rename(registry, backup);
    await mkdir(registry);
    await assert.rejects(service.remove(repo.id));
    assert.equal(service.get(repo.id).path, repo.path);
    await rmdir(registry);
    await rename(backup, registry);
    assert.deepEqual(await service.remove(repo.id), []);
    assert.deepEqual(JSON.parse(await readFile(registry, 'utf8')), []);
  } finally {
    await ctx.clean();
  }
});

test('directory browsing exposes filesystem roots and resolves bare Windows drives to their roots', async () => {
  const ctx = await fixture();
  try {
    const listing = await ctx.service.filesystem(ctx.temporary);
    assert.ok(
      listing.directories.some((entry) => entry.name === 'repository' && entry.isRepository),
    );
    assert.ok(
      listing.roots.some(
        (root) => root.path.toLowerCase() === path.parse(ctx.temporary).root.toLowerCase(),
      ),
    );
    if (process.platform === 'win32') {
      assert.ok(
        listing.roots.some(
          (root) => root.path.toLowerCase() === path.parse(process.cwd()).root.toLowerCase(),
        ),
      );
      for (const drive of listing.roots) {
        assert.match(drive.path, /^[A-Z]:\\$/);
        const root = await ctx.service.filesystem(drive.path.slice(0, 2));
        assert.equal(root.path, drive.path);
        assert.equal(root.parent, null);
      }
    } else {
      assert.deepEqual(listing.roots, [{ name: '文件系统', path: '/' }]);
    }
    await assert.rejects(
      ctx.service.filesystem(path.join(ctx.temporary, 'missing-folder')),
      /无法读取该目录/,
    );
  } finally {
    await ctx.clean();
  }
});

test('branch, merge, tags and stash operations modify actual Git state', async () => {
  const ctx = await fixture();
  try {
    const { service, repo } = ctx;
    await writeFile(path.join(repo.path, 'README.md'), '# Test\n');
    await service.action(repo.id, { action: 'stage', files: ['README.md'] });
    await service.action(repo.id, { action: 'commit', message: 'initial' });
    await service.action(repo.id, { action: 'branch-create', name: 'feature/test' });
    assert.equal((await service.snapshot(repo.id)).status.branch, 'feature/test');
    await writeFile(path.join(repo.path, 'feature.txt'), 'feature\n');
    await service.action(repo.id, { action: 'stage', files: ['feature.txt'] });
    await service.action(repo.id, { action: 'commit', message: 'feature commit' });
    await service.action(repo.id, { action: 'branch-switch', name: 'main' });
    await assert.rejects(
      service.action(repo.id, { action: 'branch-delete', name: 'feature/test' }),
      /尚有未合并/,
    );
    await service.action(repo.id, { action: 'merge', name: 'feature/test' });
    await service.action(repo.id, { action: 'branch-delete', name: 'feature/test' });
    await service.action(repo.id, {
      action: 'tag-create',
      name: 'v1.0.0',
      message: 'first release',
    });
    assert.equal((await service.snapshot(repo.id)).tags[0].name, 'v1.0.0');
    await service.action(repo.id, { action: 'tag-delete', name: 'v1.0.0' });
    await writeFile(path.join(repo.path, 'draft.txt'), 'draft\n');
    await service.action(repo.id, {
      action: 'stash-save',
      message: '草稿',
      includeUntracked: true,
    });
    let snapshot = await service.snapshot(repo.id);
    assert.equal(snapshot.status.clean, true, JSON.stringify(snapshot.status));
    assert.equal(snapshot.stashes.length, 1);
    await service.action(repo.id, { action: 'stash-pop', ref: snapshot.stashes[0].ref });
    snapshot = await service.snapshot(repo.id);
    assert.equal(snapshot.stashes.length, 0);
    assert.equal(snapshot.status.untracked.length, 1);
    await service.action(repo.id, { action: 'discard', files: ['draft.txt'] });
    assert.equal((await service.snapshot(repo.id)).status.clean, true);
  } finally {
    await ctx.clean();
  }
});

test('local bare remote supports clone, fetch, push and fast-forward pull', async () => {
  const ctx = await fixture();
  try {
    const { service, repo, temporary } = ctx;
    await writeFile(path.join(repo.path, 'README.md'), '# Remote\n');
    await service.action(repo.id, { action: 'stage', files: ['README.md'] });
    await service.action(repo.id, { action: 'commit', message: 'initial' });
    const bare = path.join(temporary, 'origin.git');
    await mkdir(bare);
    await runGit(bare, ['init', '--bare', '-b', 'main']);
    await service.action(repo.id, { action: 'remote-add', name: 'origin', url: bare });
    await service.action(repo.id, { action: 'push' });
    await service.action(repo.id, { action: 'branch-create', name: 'feature/remote' });
    await service.action(repo.id, { action: 'push' });
    await service.action(repo.id, { action: 'branch-switch', name: 'main' });
    const clone = await service.clone(bare, path.join(temporary, 'clone'));
    await runGit(clone.path, ['config', '--local', 'core.autocrlf', 'false']);
    await service.setConfig(clone.id, { name: 'Clone', email: 'clone@example.com' });
    await service.action(clone.id, { action: 'branch-switch', name: 'origin/feature/remote' });
    assert.equal((await service.snapshot(clone.id)).status.branch, 'feature/remote');
    await service.action(clone.id, { action: 'branch-switch', name: 'origin/main' });
    await writeFile(path.join(clone.path, 'remote.txt'), 'remote update\n');
    await service.action(clone.id, { action: 'stage', files: ['remote.txt'] });
    await service.action(clone.id, { action: 'commit', message: 'remote update' });
    await service.action(clone.id, { action: 'push' });
    await service.action(repo.id, { action: 'fetch' });
    assert.equal((await service.snapshot(repo.id)).status.behind, 1);
    await service.action(repo.id, { action: 'pull' });
    assert.equal(await readFile(path.join(repo.path, 'remote.txt'), 'utf8'), 'remote update\n');
    assert.equal((await service.snapshot(repo.id)).status.behind, 0);
  } finally {
    await ctx.clean();
  }
});

test('merge conflicts can be inspected and aborted; cherry-pick and revert preserve history', async () => {
  const ctx = await fixture();
  try {
    const { service, repo } = ctx;
    const save = async (content: string, message: string) => {
      await writeFile(path.join(repo.path, 'shared.txt'), content);
      await service.action(repo.id, { action: 'stage', files: ['shared.txt'] });
      await service.action(repo.id, { action: 'commit', message });
    };
    await save('base\n', 'base');
    await service.action(repo.id, { action: 'branch-create', name: 'feature/conflict' });
    await save('feature\n', 'feature change');
    const featureHash = (await runGit(repo.path, ['rev-parse', 'HEAD'])).trim();
    await service.action(repo.id, { action: 'branch-switch', name: 'main' });
    await save('main\n', 'main change');
    const mainHash = (await runGit(repo.path, ['rev-parse', 'HEAD'])).trim();
    await assert.rejects(
      service.action(repo.id, { action: 'merge', name: 'feature/conflict' }),
      /冲突/,
    );
    const conflicted = await service.snapshot(repo.id);
    assert.equal(conflicted.status.conflicted[0].path, 'shared.txt');
    assert.equal(conflicted.status.operation, 'merge');
    assert.match((await service.diff(repo.id, 'shared.txt', false)).diff, /<<<<<<< HEAD/);
    await service.action(repo.id, { action: 'merge-abort' });
    assert.equal((await service.snapshot(repo.id)).status.clean, true);
    assert.equal((await service.snapshot(repo.id)).status.operation, undefined);
    assert.equal(await readFile(path.join(repo.path, 'shared.txt'), 'utf8'), 'main\n');
    await assert.rejects(service.action(repo.id, { action: 'merge-continue' }), /没有对应/);
    await assert.rejects(
      service.action(repo.id, { action: 'cherry-pick', hash: featureHash }),
      /冲突/,
    );
    assert.equal((await service.snapshot(repo.id)).status.operation, 'cherry-pick');
    await service.action(repo.id, { action: 'cherry-pick-abort' });
    await save('newer main\n', 'newer main change');
    await assert.rejects(service.action(repo.id, { action: 'revert', hash: mainHash }), /冲突/);
    assert.equal((await service.snapshot(repo.id)).status.operation, 'revert');
    await service.action(repo.id, { action: 'revert-abort' });
    await assert.rejects(runGit(repo.path, ['rebase', 'feature/conflict']), /冲突/);
    assert.equal((await service.snapshot(repo.id)).status.operation, 'rebase');
    await service.action(repo.id, { action: 'rebase-abort' });
    assert.equal((await service.snapshot(repo.id)).status.operation, undefined);
    await service.action(repo.id, {
      action: 'branch-create',
      name: 'feature/rebase-check',
      startPoint: mainHash,
    });
    await assert.rejects(runGit(repo.path, ['rebase', 'feature/conflict']), /冲突/);
    await writeFile(path.join(repo.path, 'shared.txt'), 'resolved rebase\n');
    await service.action(repo.id, { action: 'stage', files: ['shared.txt'] });
    assert.equal((await service.snapshot(repo.id)).status.operation, 'rebase');
    await service.action(repo.id, { action: 'rebase-continue' });
    assert.equal((await service.snapshot(repo.id)).status.operation, undefined);
    await service.action(repo.id, { action: 'branch-switch', name: 'main' });
    await assert.rejects(
      service.action(repo.id, { action: 'merge', name: 'feature/conflict' }),
      /冲突/,
    );
    await writeFile(path.join(repo.path, 'shared.txt'), 'resolved merge\n');
    await service.action(repo.id, { action: 'stage', files: ['shared.txt'] });
    assert.equal((await service.snapshot(repo.id)).status.operation, 'merge');
    await service.action(repo.id, { action: 'merge-continue' });
    assert.equal((await service.snapshot(repo.id)).status.operation, undefined);
    await service.action(repo.id, { action: 'branch-switch', name: 'feature/conflict' });
    await writeFile(path.join(repo.path, 'picked.txt'), 'safe independent addition\n');
    await service.action(repo.id, { action: 'stage', files: ['picked.txt'] });
    await service.action(repo.id, { action: 'commit', message: 'independent feature' });
    const selectedHash = (await runGit(repo.path, ['rev-parse', 'HEAD'])).trim();
    await service.action(repo.id, { action: 'branch-switch', name: 'main' });
    await service.action(repo.id, { action: 'cherry-pick', hash: selectedHash });
    assert.equal(
      await readFile(path.join(repo.path, 'picked.txt'), 'utf8'),
      'safe independent addition\n',
    );
    const pickedHash = (await runGit(repo.path, ['rev-parse', 'HEAD'])).trim();
    await service.action(repo.id, { action: 'revert', hash: pickedHash });
    const commits = (await service.snapshot(repo.id)).commits;
    assert.ok(commits.some((commit) => commit.subject.startsWith('Revert')));
    assert.ok(commits.some((commit) => commit.hash === pickedHash));
  } finally {
    await ctx.clean();
  }
});

test('worktree state paths are independent and identity writes cannot race commits', async () => {
  const ctx = await fixture();
  try {
    const { service, repo, temporary } = ctx;
    await writeFile(path.join(repo.path, 'base.txt'), 'base\n');
    await service.action(repo.id, { action: 'stage', files: ['base.txt'] });
    await service.action(repo.id, { action: 'commit', message: 'base' });
    const linkedPath = path.join(temporary, 'linked worktree');
    await runGit(repo.path, ['worktree', 'add', '-b', 'feature/linked', linkedPath]);
    const linked = await service.open(linkedPath);
    await writeFile(path.join(linked.path, 'base.txt'), 'feature\n');
    await service.action(linked.id, { action: 'stage', files: ['base.txt'] });
    await service.action(linked.id, { action: 'commit', message: 'feature' });
    await writeFile(path.join(repo.path, 'base.txt'), 'main\n');
    await service.action(repo.id, { action: 'stage', files: ['base.txt'] });
    await service.action(repo.id, { action: 'commit', message: 'main' });
    await assert.rejects(service.action(linked.id, { action: 'merge', name: 'main' }), /冲突/);
    assert.equal((await service.snapshot(linked.id)).status.operation, 'merge');
    assert.equal((await service.snapshot(repo.id)).status.operation, undefined);
    await service.action(linked.id, { action: 'merge-abort' });
    const hook = path.join(repo.path, '.git', 'hooks', 'pre-commit');
    await writeFile(hook, '#!/bin/sh\nprintf started > .hook-entered\nsleep 1\n');
    await chmod(hook, 0o755);
    await writeFile(path.join(repo.path, 'next.txt'), 'next\n');
    await service.action(repo.id, { action: 'stage', files: ['next.txt'] });
    const committing = service.action(repo.id, {
      action: 'commit',
      message: 'identity remains consistent',
    });
    let entered = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        await access(path.join(repo.path, '.hook-entered'));
        entered = true;
        break;
      } catch {
        await delay(50);
      }
    }
    try {
      assert.equal(entered, true, 'commit hook must start before concurrency check');
      await assert.rejects(
        service.setConfig(linked.id, { name: 'Other Author', email: 'other@example.com' }),
        (error: unknown) => error instanceof ApiError && error.status === 409,
      );
    } finally {
      await committing;
    }
    assert.equal((await service.config(repo.id)).name, '测试用户');
    assert.equal(
      (await service.snapshot(repo.id)).commits.find(
        (commit) => commit.subject === 'identity remains consistent',
      )?.author,
      '测试用户',
    );
  } finally {
    await ctx.clean();
  }
});

test('file operations treat glob characters literally', async () => {
  const ctx = await fixture();
  try {
    await writeFile(path.join(ctx.repo.path, '[abc].txt'), 'selected');
    await writeFile(path.join(ctx.repo.path, 'a.txt'), 'unselected');
    await ctx.service.action(ctx.repo.id, { action: 'stage', files: ['[abc].txt'] });
    const status = (await ctx.service.snapshot(ctx.repo.id)).status;
    assert.deepEqual(
      status.staged.map((file) => file.path),
      ['[abc].txt'],
    );
    assert.deepEqual(
      status.untracked.map((file) => file.path),
      ['a.txt'],
    );
  } finally {
    await ctx.clean();
  }
});

test('inherited Git environment cannot redirect selected repository or index', async () => {
  const ctx = await fixture();
  const keys = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    const other = await ctx.service.init(path.join(ctx.temporary, 'other-repo'));
    await writeFile(path.join(ctx.repo.path, 'selected.txt'), 'selected\n');
    process.env.GIT_DIR = path.join(other.path, '.git');
    process.env.GIT_WORK_TREE = other.path;
    process.env.GIT_INDEX_FILE = path.join(other.path, '.git', 'index');
    await ctx.service.action(ctx.repo.id, { action: 'stage', files: ['selected.txt'] });
    assert.equal((await ctx.service.snapshot(ctx.repo.id)).status.staged[0].path, 'selected.txt');
    assert.equal((await ctx.service.snapshot(other.id)).status.clean, true);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await ctx.clean();
  }
});

test('path traversal, external helpers and option injection are rejected', async () => {
  for (const value of [
    '../secret.txt',
    '.git/config',
    'src/../../secret',
    path.resolve(os.tmpdir(), 'secret'),
  ])
    assert.throws(() => safeRelativePath(value), ApiError);
  for (const url of ['ext::sh -c bad', '--upload-pack=bad', 'unknown://helper'])
    assert.throws(() => safeRemoteUrl(url), ApiError);
  const ctx = await fixture();
  try {
    await assert.rejects(
      ctx.service.action(ctx.repo.id, { action: 'stage', files: ['../outside.txt'] }),
      ApiError,
    );
    await assert.rejects(
      ctx.service.action(ctx.repo.id, { action: 'branch-create', name: '--help' }),
      ApiError,
    );
    await assert.rejects(
      ctx.service.action(ctx.repo.id, { action: 'cherry-pick', hash: '--help' }),
      ApiError,
    );
    await assert.rejects(
      ctx.service.action(ctx.repo.id, { action: 'remote-add', name: 'origin', url: 'ext::danger' }),
      ApiError,
    );
  } finally {
    await ctx.clean();
  }
});

test('API rejects missing CSRF tokens, untrusted origins and DNS rebinding hosts', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'branchlet-api-'));
  const { app } = await createApp({
    dataDir: path.join(temporary, 'data'),
    demo: false,
    staticDir: path.join(temporary, 'absent'),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    assert.equal(
      (await fetch(`${base}/api/session`, { headers: { Origin: 'https://attacker.example' } }))
        .status,
      403,
    );
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request(
        `${base}/api/session`,
        { headers: { Host: 'attacker.example' } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });
    assert.equal(reboundStatus, 403);
    assert.equal(
      (
        await fetch(`${base}/api/repos/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
    );
    const { token } = (await (await fetch(`${base}/api/session`)).json()) as { token: string };
    const response = await fetch(`${base}/api/repos/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Branchlet-Token': token,
        Origin: 'http://127.0.0.1:5173',
      },
      body: JSON.stringify({ path: path.join(temporary, 'new-repo') }),
    });
    assert.equal(response.status, 200);
    const list = (await (await fetch(`${base}/api/repos`)).json()) as {
      id: string;
      path: string;
    }[];
    assert.equal(list.length, 1);
    const removeUrl = `${base}/api/repos/${list[0].id}/remove`;
    const rejectedHeaders: Record<string, string>[] = [
      { 'Content-Type': 'application/json' },
      {
        'Content-Type': 'application/json',
        'X-Branchlet-Token': token,
        Origin: 'https://attacker.example',
      },
    ];
    for (const headers of rejectedHeaders) {
      assert.equal((await fetch(removeUrl, { method: 'POST', headers, body: '{}' })).status, 403);
    }
    assert.equal(((await (await fetch(`${base}/api/repos`)).json()) as unknown[]).length, 1);
    const removed = await fetch(removeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Branchlet-Token': token },
      body: '{}',
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), []);
    await access(path.join(list[0].path, '.git'));
    assert.equal(
      (
        await fetch(removeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Branchlet-Token': token },
          body: '{}',
        })
      ).status,
      404,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    const resolved = path.resolve(temporary);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
});

test('demo is richly populated and never resets existing user changes on reinitialization', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'branchlet-demo-'));
  try {
    const service = new GitService(temporary, true);
    await service.initialize();
    const repo = service.list()[0],
      snapshot = await service.snapshot(repo.id);
    assert.equal(repo.isDemo, true);
    assert.ok(snapshot.commits.length >= 12);
    assert.ok(snapshot.branches.filter((branch) => !branch.remote).length >= 3);
    assert.equal(snapshot.stashes.length, 1);
    assert.equal(snapshot.tags[0].name, 'v1.0.0');
    assert.ok(snapshot.status.staged.length);
    assert.ok(snapshot.status.unstaged.length);
    assert.ok(snapshot.status.untracked.length);
    await writeFile(path.join(repo.path, 'my-work.txt'), 'preserved');
    const again = new GitService(temporary, true);
    await again.initialize();
    assert.equal(await readFile(path.join(repo.path, 'my-work.txt'), 'utf8'), 'preserved');
    assert.equal(again.list()[0].isDemo, true);
    assert.deepEqual(await again.remove(repo.id), []);
    assert.equal(await readFile(path.join(repo.path, 'my-work.txt'), 'utf8'), 'preserved');
    const dismissed = new GitService(temporary, true);
    await dismissed.initialize();
    assert.deepEqual(dismissed.list(), []);
    assert.equal((await dismissed.open(repo.path)).id, repo.id);
    const explicitlyRestored = new GitService(temporary, true);
    await explicitlyRestored.initialize();
    assert.equal(explicitlyRestored.list()[0].id, repo.id);
  } finally {
    const resolved = path.resolve(temporary);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
});
