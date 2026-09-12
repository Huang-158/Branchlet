import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { GitService } from '../server/git-service.js';
import { ApiError, runGit } from '../server/git-command.js';
import {
  createRepositoryFilesRouter,
  listRepositoryDirectory,
  previewRepositoryFile,
} from '../server/repository-files.js';

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'branchlet-files-'));
  const service = new GitService(path.join(temporary, 'data'), false);
  await service.initialize();
  const repo = await service.init(path.join(temporary, 'repository'));
  await service.setConfig(repo.id, { name: 'File Browser Test', email: 'files@example.com' });
  await runGit(repo.path, ['config', '--local', 'core.autocrlf', 'false']);
  return {
    service,
    repo,
    temporary,
    clean: async () => {
      assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
      assert.ok(path.basename(temporary).startsWith('branchlet-files-'));
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

test('repository files list real tracked, untracked and empty folders with statuses, Unicode and ignore rules', async () => {
  const ctx = await fixture();
  try {
    const { repo, service } = ctx;
    for (const dir of ['src/deep', 'empty-folder', 'ignored', 'node_modules/pkg'])
      await mkdir(path.join(repo.path, dir), { recursive: true });
    await writeFile(path.join(repo.path, '.gitignore'), 'ignored/\n*.log\n');
    await writeFile(path.join(repo.path, 'README.md'), 'first\n');
    await writeFile(path.join(repo.path, 'src/中文 file.ts'), 'const 问候 = "你好";\n');
    await writeFile(path.join(repo.path, 'tracked.log'), 'tracked despite ignore\n');
    await runGit(repo.path, [
      'add',
      '-f',
      '--',
      '.gitignore',
      'README.md',
      'src/中文 file.ts',
      'tracked.log',
    ]);
    await runGit(repo.path, ['commit', '-m', 'initial files']);
    await writeFile(path.join(repo.path, 'README.md'), 'first\nmodified\n');
    await writeFile(path.join(repo.path, 'src/draft.txt'), 'untracked\n');
    await writeFile(path.join(repo.path, 'new.ts'), 'staged\n');
    await runGit(repo.path, ['add', '--', 'new.ts']);
    await writeFile(path.join(repo.path, 'ignored/secret.txt'), 'ignored secret');
    await writeFile(path.join(repo.path, 'debug.log'), 'ignored log');
    await writeFile(path.join(repo.path, 'node_modules/pkg/index.js'), 'dependency');
    const root = await listRepositoryDirectory(service, repo.id, '');
    const names = root.entries.map((entry) => entry.name);
    assert.ok(names.includes('src'));
    assert.ok(names.includes('empty-folder'));
    assert.ok(names.includes('tracked.log'));
    assert.ok(!names.includes('.git'));
    assert.ok(!names.includes('ignored'));
    assert.ok(!names.includes('node_modules'));
    assert.ok(!names.includes('debug.log'));
    assert.equal(root.entries.find((entry) => entry.name === 'README.md')?.status, 'M');
    assert.equal(root.entries.find((entry) => entry.name === 'new.ts')?.status, 'A');
    assert.equal(root.parent, null);
    assert.equal(root.truncated, false);
    const src = await listRepositoryDirectory(service, repo.id, 'src');
    assert.equal(src.parent, '');
    assert.ok(src.entries.some((entry) => entry.path === 'src/中文 file.ts'));
    assert.equal(src.entries.find((entry) => entry.name === 'draft.txt')?.status, '?');
    const empty = await listRepositoryDirectory(service, repo.id, 'empty-folder');
    assert.deepEqual(empty.entries, []);
    const preview = await previewRepositoryFile(service, repo.id, 'src/中文 file.ts');
    assert.equal(preview.content, 'const 问候 = "你好";\n');
    assert.equal(preview.binary, false);
    assert.equal(preview.truncated, false);
  } finally {
    await ctx.clean();
  }
});

test('preview limits text bytes without corrupting UTF-8 and marks binary files', async () => {
  const ctx = await fixture();
  try {
    const { repo, service } = ctx;
    await writeFile(path.join(repo.path, 'binary.dat'), Buffer.from([1, 2, 0, 255, 10]));
    await writeFile(path.join(repo.path, 'large.txt'), '界'.repeat(400000));
    await writeFile(path.join(repo.path, 'empty.txt'), '');
    const binary = await previewRepositoryFile(service, repo.id, 'binary.dat');
    assert.equal(binary.binary, true);
    assert.equal(binary.content, undefined);
    assert.equal(binary.size, 5);
    const large = await previewRepositoryFile(service, repo.id, 'large.txt');
    assert.equal(large.binary, false);
    assert.equal(large.truncated, true);
    assert.equal(large.size, 1200000);
    assert.ok(Buffer.byteLength(large.content || '') <= 1024 * 1024);
    assert.ok(!large.content?.includes('\uFFFD'));
    assert.equal((await previewRepositoryFile(service, repo.id, 'empty.txt')).content, '');
  } finally {
    await ctx.clean();
  }
});

test('repository file paths reject traversal, Git internals, ignored files and escaping symlinks', async (t) => {
  const ctx = await fixture();
  try {
    const { repo, service, temporary } = ctx;
    await writeFile(path.join(repo.path, '.gitignore'), 'ignored/\n');
    await mkdir(path.join(repo.path, 'ignored'));
    await writeFile(path.join(repo.path, 'ignored/secret.txt'), 'hidden');
    for (const invalid of [
      '../outside.txt',
      '/etc/passwd',
      'C:/outside.txt',
      '.git/config',
      'folder/../../outside.txt',
      'README.md:stream',
      'node_modules/index.js',
      'ignored/secret.txt',
      '',
      ['README.md'],
    ]) {
      await assert.rejects(
        previewRepositoryFile(service, repo.id, invalid),
        `must reject ${String(invalid)}`,
      );
    }
    for (const invalid of ['../', '.git', '.git/objects', 'node_modules', 'C:\\outside'])
      await assert.rejects(listRepositoryDirectory(service, repo.id, invalid));
    const outside = path.join(temporary, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.txt'), 'outside secret');
    const link = path.join(repo.path, 'external-link');
    try {
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code || '')) {
        t.diagnostic('Symlink creation unavailable; traversal checks still completed.');
        return;
      }
      throw error;
    }
    await assert.rejects(listRepositoryDirectory(service, repo.id, 'external-link'), /符号链接/);
    await assert.rejects(
      previewRepositoryFile(service, repo.id, 'external-link/secret.txt'),
      /符号链接/,
    );
  } finally {
    await ctx.clean();
  }
});

test('repository file router returns JSON and meaningful status codes for invalid requests', async () => {
  const ctx = await fixture();
  const app = express();
  app.use('/api', createRepositoryFilesRouter(ctx.service));
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
      res.status(error instanceof ApiError ? error.status : 500).json({ error: error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.on('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/repos/${ctx.repo.id}`;
    await writeFile(path.join(ctx.repo.path, 'hello 中文.txt'), 'hello world');
    const listing = await fetch(`${base}/files`);
    assert.equal(listing.status, 200);
    assert.ok(
      (await listing.json()).entries.some(
        (entry: { name: string }) => entry.name === 'hello 中文.txt',
      ),
    );
    const file = await fetch(`${base}/file?path=${encodeURIComponent('hello 中文.txt')}`);
    assert.equal(file.status, 200);
    assert.equal((await file.json()).content, 'hello world');
    assert.equal(
      (await fetch(`${base}/file?path=${encodeURIComponent('../outside.txt')}`)).status,
      400,
    );
    assert.equal(
      (await fetch(`${base}/file?path=${encodeURIComponent('.git/config')}`)).status,
      400,
    );
    assert.equal((await fetch(`${base}/file?path=missing.txt`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await ctx.clean();
  }
});
