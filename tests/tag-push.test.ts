import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitService } from '../server/git-service.js';
import { runGit } from '../server/git-command.js';

test('push a selected tag without pushing other tags or accepting a refspec injection', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'branchlet-tag-'));
  try {
    const service = new GitService(path.join(temporary, 'data'), false);
    await service.initialize();
    const repo = await service.init(path.join(temporary, 'repo'));
    await service.setConfig(repo.id, { name: 'Test', email: 'test@example.com' });
    await writeFile(path.join(repo.path, 'hello.txt'), 'hello');
    await service.action(repo.id, { action: 'stage', files: ['hello.txt'] });
    await service.action(repo.id, { action: 'commit', message: 'initial' });
    const remote = path.join(temporary, 'remote.git');
    await mkdir(remote);
    await runGit(remote, ['init', '--bare', '-b', 'main']);
    await service.action(repo.id, { action: 'remote-add', name: 'origin', url: remote });
    await service.action(repo.id, {
      action: 'tag-create',
      name: 'v1.0.0',
      message: 'First release',
    });
    await service.action(repo.id, { action: 'tag-create', name: 'private-tag' });
    await service.action(repo.id, { action: 'tag-push', name: 'v1.0.0', remote: 'origin' });
    assert.equal((await runGit(remote, ['tag', '--list'])).trim(), 'v1.0.0');
    await assert.rejects(
      service.action(repo.id, { action: 'tag-push', name: 'v1.0.0:refs/heads/main' }),
    );
    await assert.rejects(service.action(repo.id, { action: 'tag-push', name: '--all' }));
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('branchlet-tag-'));
    await rm(temporary, { recursive: true, force: true });
  }
});
