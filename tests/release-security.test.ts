import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';

test('app upload exception retains session/origin protection and rejects other non-JSON writes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'branchlet-release-security-'));
  // Keep the native local HTTP client; all fetch calls captured by the app are blocked.
  const localFetch = globalThis.fetch;
  let externalRequests = 0;
  const blockedFetch = t.mock.method(globalThis, 'fetch', async () => {
    externalRequests += 1;
    throw new Error('External requests are prohibited by this integration test.');
  });
  let server: ReturnType<Awaited<ReturnType<typeof createApp>>['app']['listen']> | undefined;
  try {
    const { app, service } = await createApp({
      dataDir: path.join(directory, 'data'),
      demo: false,
      staticDir: path.join(directory, 'no-static-files'),
    });
    const repo = await service.init(path.join(directory, 'repository'));
    await service.action(repo.id, {
      action: 'remote-add',
      name: 'origin',
      url: 'https://github.com/branchlet-test/example.git',
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const root = `/api/repos/${repo.id}/releases`;
    const uploadPath = `${root}/7/assets?name=test.bin`;
    const session = await localFetch(`${origin}/api/session`);
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    const { token } = (await session.json()) as { token: string };
    assert.match(token, /^[a-f0-9]{64}$/);

    const binary = async (
      endpoint: string,
      extraHeaders: Record<string, string> = {},
      method = 'POST',
    ) =>
      localFetch(`${origin}${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/octet-stream', ...extraHeaders },
        body: new Uint8Array([0, 1, 128, 255]),
      });

    const missing = await binary(uploadPath);
    assert.equal(missing.status, 403);
    assert.match(((await missing.json()) as { error: string }).error, /安全会话/);
    assert.equal((await binary(uploadPath, { 'X-Branchlet-Token': '0'.repeat(64) })).status, 403);
    assert.equal(
      (
        await binary(uploadPath, {
          'X-Branchlet-Token': token,
          Origin: 'https://attacker.example',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await binary(uploadPath, {
          'X-Branchlet-Token': token,
          'Sec-Fetch-Site': 'cross-site',
        })
      ).status,
      403,
    );

    // 401 proves the valid binary request passed the app middleware and raw parser,
    // then stopped at GitHub authentication before any external action was possible.
    const authorizedLocally = await binary(uploadPath, {
      'X-Branchlet-Token': token,
      Origin: 'http://127.0.0.1:5173',
    });
    assert.equal(authorizedLocally.status, 401);
    assert.match(
      ((await authorizedLocally.json()) as { error: string }).error,
      /连接 GitHub 访问令牌/,
    );

    for (const endpoint of [
      '/api/repos/init',
      `/api/repos/${repo.id}/action`,
      `/api/repos/${repo.id}/config`,
      root,
      `${root}/auth`,
      `${root}/auth/clear`,
      `${root}/7/publish`,
      `${root}/0/assets`,
      `${root}/01/assets`,
      `${root}/-1/assets`,
      `${root}/%37/assets`,
      `${root}/7/assets/extra`,
    ]) {
      assert.equal(
        (await binary(endpoint, { 'X-Branchlet-Token': token })).status,
        415,
        `binary content must not be accepted at ${endpoint}`,
      );
    }
    assert.equal((await binary(uploadPath, { 'X-Branchlet-Token': token }, 'PUT')).status, 415);
    assert.equal(
      (
        await binary(uploadPath, {
          'X-Branchlet-Token': token,
          'Content-Type': 'text/plain',
        })
      ).status,
      415,
    );
    const jsonOnUpload = await localFetch(`${origin}${uploadPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Branchlet-Token': token },
      body: '{}',
    });
    assert.equal(jsonOnUpload.status, 415);
    assert.equal(externalRequests, 0, 'no test request may reach GitHub or another external host');
    assert.equal((await service.snapshot(repo.id)).status.clean, true);
  } finally {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    blockedFetch.mock.restore();
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
});
