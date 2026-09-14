import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitService, validateRepositoryInitPath } from '../server/git-service.js';
import { ApiError, runGit } from '../server/git-command.js';
import { listRepositoryDirectory } from '../server/repository-files.js';

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'branchlet-init-'));
  const service = new GitService(path.join(temporary, 'data'), false);
  await service.initialize();
  return {
    temporary,
    service,
    async clean() {
      assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
      assert.ok(path.basename(temporary).startsWith('branchlet-init-'));
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

function invalidPath(message: RegExp) {
  return (error: unknown) =>
    error instanceof ApiError && error.status === 400 && message.test(error.message);
}

test('init path validation rejects home, filesystem roots and relative paths without writing', async () => {
  // Call the read-only validator for real protected paths: even a regression
  // must never run git init in the machine's home or a filesystem root.
  const home = os.homedir();
  for (const candidate of [
    home,
    `${home}${path.sep}`,
    path.join(home, 'unused', '..'),
    path.parse(home).root,
  ])
    await assert.rejects(validateRepositoryInitPath(candidate), invalidPath(/专用的项目文件夹/));
  for (const candidate of ['my-project', './my-project', '../my-project'])
    await assert.rejects(validateRepositoryInitPath(candidate), invalidPath(/绝对路径/));
  if (process.platform === 'win32') {
    for (const candidate of ['C:', 'D:project', '\\project', '/project'])
      await assert.rejects(validateRepositoryInitPath(candidate), invalidPath(/绝对路径/));
    await assert.rejects(
      validateRepositoryInitPath(home.toUpperCase()),
      invalidPath(/专用的项目文件夹/),
    );
  }
});

test('init path validation resolves aliases to home and filesystem roots', async (t) => {
  const ctx = await fixture();
  try {
    for (const [name, target] of [
      ['home-link', os.homedir()],
      ['root-link', path.parse(os.homedir()).root],
    ]) {
      const alias = path.join(ctx.temporary, name);
      try {
        await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          t.skip('This filesystem does not permit directory links.');
          return;
        }
        throw error;
      }
      await assert.rejects(validateRepositoryInitPath(alias), invalidPath(/专用的项目文件夹/));
    }
    assert.deepEqual(ctx.service.list(), []);
  } finally {
    await ctx.clean();
  }
});

test('init rejects a protected target before creating its directory or changing the registry', async () => {
  const ctx = await fixture();
  const homeVariable = process.platform === 'win32' ? 'USERPROFILE' : 'HOME';
  const previous = process.env[homeVariable];
  try {
    // A temporary home keeps this integration regression safe even if init
    // stops calling the guard. Never invoke init against the real user home.
    const protectedTarget = path.join(ctx.temporary, 'not-created-home');
    process.env[homeVariable] = protectedTarget;
    assert.equal(os.homedir(), protectedTarget);
    await assert.rejects(ctx.service.init(protectedTarget), invalidPath(/专用的项目文件夹/));
    await assert.rejects(access(protectedTarget), { code: 'ENOENT' });
    assert.deepEqual(ctx.service.list(), []);
    await assert.rejects(access(path.join(ctx.service.dataDir, 'repos.json')), { code: 'ENOENT' });
  } finally {
    if (previous === undefined) delete process.env[homeVariable];
    else process.env[homeVariable] = previous;
    await ctx.clean();
  }
});

test('new Unicode and space path has a valid empty snapshot and supports its first commit', async () => {
  const ctx = await fixture();
  try {
    const repo = await ctx.service.init(path.join(ctx.temporary, '新建 项目'));
    const empty = await ctx.service.snapshot(repo.id);
    assert.equal(empty.repo.id, repo.id);
    assert.equal(empty.status.branch, 'main');
    assert.equal(empty.status.head, '');
    assert.equal(empty.status.clean, true);
    assert.equal(empty.totalCommits, 0);
    for (const field of ['commits', 'branches', 'stashes', 'tags', 'remotes'] as const)
      assert.deepEqual(empty[field], []);
    assert.deepEqual((await listRepositoryDirectory(ctx.service, repo.id)).entries, []);
    await ctx.service.setConfig(repo.id, { name: 'Branchlet Test', email: 'test@example.invalid' });
    await writeFile(path.join(repo.path, 'README.md'), '# First project\n');
    await ctx.service.action(repo.id, { action: 'stage', files: ['README.md'] });
    await ctx.service.action(repo.id, { action: 'commit', message: 'Initial commit' });
    const committed = await ctx.service.snapshot(repo.id);
    assert.equal(committed.status.clean, true);
    assert.equal(committed.totalCommits, 1);
    assert.equal(committed.commits[0].subject, 'Initial commit');
    assert.ok(committed.branches.some((branch) => branch.name === 'main' && branch.current));
    const restarted = new GitService(ctx.service.dataDir, false);
    await restarted.initialize();
    assert.equal(restarted.list()[0].id, repo.id);
  } finally {
    await ctx.clean();
  }
});

test('init accepts existing project files and nested dedicated folders, preserving their contents', async () => {
  const ctx = await fixture();
  try {
    const parent = await ctx.service.init(path.join(ctx.temporary, 'parent-project'));
    const target = path.join(parent.path, 'nested-project');
    await mkdir(target);
    await writeFile(path.join(target, 'existing.txt'), 'preserve existing work\n');
    const repo = await ctx.service.init(target);
    assert.equal(repo.path, target);
    assert.equal(
      await readFile(path.join(target, 'existing.txt'), 'utf8'),
      'preserve existing work\n',
    );
    assert.deepEqual(
      (await ctx.service.snapshot(repo.id)).status.untracked.map((file) => file.path),
      ['existing.txt'],
    );
    assert.equal(ctx.service.list().length, 2);
  } finally {
    await ctx.clean();
  }
});

test('init refuses existing ordinary, linked worktree and bare repositories without changing them', async () => {
  const ctx = await fixture();
  try {
    const repo = await ctx.service.init(path.join(ctx.temporary, 'existing-repository'));
    await ctx.service.setConfig(repo.id, { name: 'Branchlet Test', email: 'test@example.invalid' });
    await writeFile(path.join(repo.path, 'keep.txt'), 'keep my work\n');
    await ctx.service.action(repo.id, { action: 'stage', files: ['keep.txt'] });
    await ctx.service.action(repo.id, { action: 'commit', message: 'Keep this history' });
    const head = await runGit(repo.path, ['rev-parse', 'HEAD']);
    const config = await readFile(path.join(repo.path, '.git', 'config'), 'utf8');
    const linked = path.join(ctx.temporary, 'linked-worktree');
    await runGit(repo.path, ['worktree', 'add', '-b', 'linked', linked]);
    const worktreePointer = await readFile(path.join(linked, '.git'), 'utf8');
    const bare = path.join(ctx.temporary, 'bare.git');
    await mkdir(bare);
    await runGit(bare, ['init', '--bare', '-b', 'main']);
    const bareHead = await readFile(path.join(bare, 'HEAD'), 'utf8');
    for (const existing of [repo.path, linked, bare])
      await assert.rejects(ctx.service.init(existing), invalidPath(/打开仓库/));
    assert.equal(await runGit(repo.path, ['rev-parse', 'HEAD']), head);
    assert.equal(await readFile(path.join(repo.path, '.git', 'config'), 'utf8'), config);
    assert.equal(await readFile(path.join(repo.path, 'keep.txt'), 'utf8'), 'keep my work\n');
    assert.equal(await readFile(path.join(linked, '.git'), 'utf8'), worktreePointer);
    assert.equal(await readFile(path.join(bare, 'HEAD'), 'utf8'), bareHead);
    assert.deepEqual(
      ctx.service.list().map((saved) => saved.id),
      [repo.id],
    );
  } finally {
    await ctx.clean();
  }
});
