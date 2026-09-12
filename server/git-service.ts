import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
  lstat,
  readlink,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {
  Branch,
  Commit,
  DirectoryListing,
  FileChange,
  GitAction,
  GitStatus,
  Remote,
  Repository,
  RepoSnapshot,
  Stash,
  Tag,
} from '../shared/types.js';
import { ApiError, requireString, runGit, safeRelativePath, safeRemoteUrl } from './git-command.js';
import { ensureDemo } from './demo.js';

const FIELD = '\x1f';
const COMMIT_FORMAT = '%H%x1f%h%x1f%P%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%aI%x1f%D%x1e';
const conflictCodes = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function localPath(input: string) {
  // Windows treats "D:" as the last working directory on that drive by default.
  // A path picker should interpret a bare drive letter as its root instead.
  return path.resolve(
    process.platform === 'win32' && /^[a-z]:$/i.test(input) ? `${input}\\` : input,
  );
}

export function parseStatus(
  raw: string,
): Pick<GitStatus, 'staged' | 'unstaged' | 'untracked' | 'conflicted' | 'clean'> {
  const staged: FileChange[] = [],
    unstaged: FileChange[] = [],
    untracked: FileChange[] = [],
    conflicted: FileChange[] = [];
  const records = raw.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || record.length < 4) continue;
    const code = record.slice(0, 2),
      file = record.slice(3);
    const oldPath = /[RC]/.test(code) ? records[++i] : undefined;
    const change = { path: file, ...(oldPath ? { oldPath } : {}) };
    if (code === '??') untracked.push({ ...change, status: '?' });
    else if (conflictCodes.has(code)) conflicted.push({ ...change, status: 'U' });
    else {
      if (code[0] !== ' ' && code[0] !== '?') staged.push({ ...change, status: code[0] });
      if (code[1] !== ' ' && code[1] !== '?') unstaged.push({ ...change, status: code[1] });
    }
  }
  return {
    staged,
    unstaged,
    untracked,
    conflicted,
    clean: staged.length + unstaged.length + untracked.length + conflicted.length === 0,
  };
}

export function parseCommits(raw: string): Commit[] {
  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, parents, subject, body, author, email, date, refs = ''] =
        record.split(FIELD);
      return {
        hash,
        shortHash,
        parents: parents ? parents.split(' ') : [],
        subject,
        body,
        author,
        email,
        date,
        refs: refs ? refs.split(', ').map((ref) => ref.replace(/^HEAD -> /, '')) : [],
      };
    });
}

function parseNameStatus(raw: string): FileChange[] {
  const result: FileChange[] = [],
    entries = raw.split('\0').filter(Boolean);
  for (let i = 0; i < entries.length;) {
    const status = entries[i++];
    if (/^[RC]/.test(status))
      result.push({ status: status[0], oldPath: entries[i++], path: entries[i++] });
    else result.push({ status: status[0], path: entries[i++] });
  }
  return result.filter((file) => file.path);
}

export class GitService {
  private repositories = new Map<string, Repository>();
  private inFlight = new Set<string>();
  private saveQueue: Promise<void> = Promise.resolve();
  constructor(
    public readonly dataDir: string,
    private readonly demo = true,
  ) {}

  async initialize() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const saved: unknown = JSON.parse(
        await readFile(path.join(this.dataDir, 'repos.json'), 'utf8'),
      );
      if (Array.isArray(saved))
        for (const repo of saved) {
          if (
            repo &&
            typeof repo.id === 'string' &&
            typeof repo.path === 'string' &&
            typeof repo.name === 'string' &&
            (await exists(repo.path))
          )
            this.repositories.set(repo.id, repo as Repository);
        }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
        throw error;
    }
    let demoDismissed = false;
    try {
      await access(path.join(this.dataDir, 'demo-dismissed.json'));
      demoDismissed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (this.demo && !demoDismissed) {
      const demoPath = await ensureDemo(this.dataDir);
      await this.open(demoPath, true);
    }
  }

  list(): Repository[] {
    return [...this.repositories.values()];
  }
  get(id: string): Repository {
    const repo = this.repositories.get(id);
    if (!repo) throw new ApiError(404, '未找到此仓库，请重新打开。');
    return repo;
  }
  private async writeRegistryFile(filename: string, value: unknown) {
    const dest = path.join(this.dataDir, filename),
      temporary = `${dest}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
      await rename(temporary, dest);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }

  private async updateRegistry(change: () => void | Promise<void>) {
    const pending = this.saveQueue.then(async () => {
      const previous = new Map(this.repositories);
      try {
        await change();
        await this.writeRegistryFile('repos.json', this.list());
      } catch (error) {
        this.repositories = previous;
        throw error;
      }
    });
    this.saveQueue = pending.catch(() => {});
    await pending;
  }

  private async acquireMutation(repo: Repository): Promise<() => void> {
    const common = (
      await runGit(repo.path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim();
    const resolved = await realpath(path.resolve(repo.path, common));
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (this.inFlight.has(key)) throw new ApiError(409, '此仓库正在执行另一项操作，请稍后重试。');
    this.inFlight.add(key);
    return () => {
      this.inFlight.delete(key);
    };
  }

  async open(input: unknown, isDemo = false): Promise<Repository> {
    const candidate = localPath(requireString(input, '仓库路径'));
    if (!(await exists(candidate))) throw new ApiError(404, '该目录不存在，请检查路径。');
    const top = (await runGit(candidate, ['rev-parse', '--show-toplevel'])).trim();
    const root = await realpath(top);
    const id = createHash('sha256')
      .update(process.platform === 'win32' ? root.toLowerCase() : root)
      .digest('hex')
      .slice(0, 16);
    let repo: Repository;
    await this.updateRegistry(() => {
      const previous = this.repositories.get(id);
      repo = {
        id,
        name: isDemo ? 'atlas-workspace' : path.basename(root),
        path: root,
        ...(isDemo || previous?.isDemo ? { isDemo: true } : {}),
      };
      this.repositories.set(id, repo);
    });
    return repo!;
  }

  async remove(id: string): Promise<Repository[]> {
    await this.updateRegistry(async () => {
      const repo = this.get(id);
      // Write this first so a crash cannot silently enable automatic creation again.
      // The repository directory and its Git history are deliberately preserved.
      if (repo.isDemo) await this.writeRegistryFile('demo-dismissed.json', { dismissed: true });
      this.repositories.delete(id);
    });
    return this.list();
  }

  async init(input: unknown): Promise<Repository> {
    const root = localPath(requireString(input, '仓库路径'));
    await mkdir(root, { recursive: true });
    await runGit(root, ['init', '-b', 'main']);
    return this.open(root);
  }

  async clone(urlValue: unknown, input: unknown): Promise<Repository> {
    const url = safeRemoteUrl(urlValue),
      root = localPath(requireString(input, '目标路径'));
    if ((await exists(root)) && (await readdir(root)).length > 0)
      throw new ApiError(400, '克隆目标必须是空目录或尚未创建的目录。');
    await mkdir(path.dirname(root), { recursive: true });
    await runGit(path.dirname(root), ['clone', '--', url, root], { timeout: 120_000 });
    return this.open(root);
  }

  private async operation(repo: Repository): Promise<GitStatus['operation']> {
    const markers = [
      'MERGE_HEAD',
      'CHERRY_PICK_HEAD',
      'REVERT_HEAD',
      'rebase-merge',
      'rebase-apply',
      'sequencer/todo',
    ];
    const output = await runGit(repo.path, [
      'rev-parse',
      '--path-format=absolute',
      ...markers.flatMap((marker) => ['--git-path', marker]),
    ]);
    const paths = output
      .trim()
      .split(/\r?\n/)
      .map((file) => path.resolve(repo.path, file));
    const [merge, cherryPick, revert, rebaseMerge, rebaseApply, sequencer] = await Promise.all(
      paths.map(exists),
    );
    // A rebase may also set CHERRY_PICK_HEAD; its own continuation takes priority.
    if (rebaseMerge || rebaseApply) return 'rebase';
    if (merge) return 'merge';
    if (cherryPick) return 'cherry-pick';
    if (revert) return 'revert';
    if (sequencer) {
      const todo = await readFile(paths[5], 'utf8').catch(() => '');
      if (/^pick\s/m.test(todo)) return 'cherry-pick';
      if (/^revert\s/m.test(todo)) return 'revert';
    }
    return undefined;
  }

  async status(repo: Repository): Promise<GitStatus> {
    const [raw, branch, head, upstream, operation] = await Promise.all([
      runGit(repo.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      runGit(repo.path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }),
      runGit(repo.path, ['rev-parse', '--verify', '--short=8', 'HEAD'], { allowFailure: true }),
      runGit(repo.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], {
        allowFailure: true,
      }),
      this.operation(repo),
    ]);
    let ahead = 0,
      behind = 0;
    if (upstream.trim() && head.trim()) {
      const counts = (
        await runGit(
          repo.path,
          ['rev-list', '--left-right', '--count', `HEAD...${upstream.trim()}`],
          { allowFailure: true },
        )
      )
        .trim()
        .split(/\s+/)
        .map(Number);
      ahead = counts[0] || 0;
      behind = counts[1] || 0;
    }
    return {
      ...parseStatus(raw),
      branch: branch.trim() || (head.trim() ? `HEAD (${head.trim()})` : 'main'),
      head: head.trim(),
      ...(upstream.trim() ? { upstream: upstream.trim() } : {}),
      ...(operation ? { operation } : {}),
      ahead,
      behind,
    };
  }

  async snapshot(id: string): Promise<RepoSnapshot> {
    const repo = this.get(id);
    const [status, rawLog, rawBranches, rawStashes, rawTags, rawRemotes, total] = await Promise.all(
      [
        this.status(repo),
        runGit(
          repo.path,
          [
            'log',
            '--exclude=refs/stash',
            '--all',
            '--topo-order',
            '-100',
            `--format=${COMMIT_FORMAT}`,
          ],
          { allowFailure: true },
        ),
        runGit(repo.path, [
          'for-each-ref',
          '--sort=-committerdate',
          '--format=%(refname)%1f%(HEAD)%1f%(objectname)%1f%(subject)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:iso-strict)',
          'refs/heads',
          'refs/remotes',
        ]),
        runGit(repo.path, ['stash', 'list', '--format=%gd%x1f%H%x1f%gs%x1f%cI']),
        runGit(repo.path, [
          'for-each-ref',
          '--sort=-creatordate',
          '--format=%(refname:short)%1f%(*objectname)%1f%(objectname)%1f%(subject)%1f%(creatordate:iso-strict)',
          'refs/tags',
        ]),
        runGit(repo.path, ['remote', '-v']),
        runGit(repo.path, ['rev-list', '--count', '--exclude=refs/stash', '--all'], {
          allowFailure: true,
        }),
      ],
    );
    const branches: Branch[] = rawBranches
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.split(FIELD)[0].endsWith('/HEAD'))
      .map((line) => {
        const [ref, current, hash, subject, upstream, track, date] = line.trim().split(FIELD);
        return {
          name: ref.replace(/^refs\/(heads|remotes)\//, ''),
          current: current === '*',
          remote: ref.startsWith('refs/remotes/'),
          hash,
          subject,
          upstream: upstream || undefined,
          ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
          behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
          date,
        };
      });
    const stashes: Stash[] = rawStashes
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, hash, message, date] = line.split(FIELD);
        return { ref, hash, message, date };
      });
    const tags: Tag[] = rawTags
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, dereferenced, hash, message, date] = line.split(FIELD);
        return { name, hash: dereferenced || hash, message, date };
      });
    const remoteMap = new Map<string, Remote>();
    for (const line of rawRemotes.trim().split('\n')) {
      const match = /^(\S+)\s+(.+) \((fetch|push)\)$/.exec(line.trim());
      if (!match) continue;
      const remote = remoteMap.get(match[1]) ?? { name: match[1], fetchUrl: '', pushUrl: '' };
      if (match[3] === 'fetch') remote.fetchUrl = match[2];
      else remote.pushUrl = match[2];
      remoteMap.set(remote.name, remote);
    }
    return {
      repo,
      status,
      commits: parseCommits(rawLog),
      branches,
      stashes,
      tags,
      remotes: [...remoteMap.values()],
      totalCommits: Number(total.trim()) || 0,
    };
  }

  async diff(id: string, fileValue: unknown, staged: boolean): Promise<{ diff: string }> {
    const repo = this.get(id),
      file = safeRelativePath(fileValue);
    const status = await this.status(repo);
    if (!staged && status.untracked.some((item) => item.path === file)) {
      const absolute = path.resolve(repo.path, file),
        metadata = await lstat(absolute);
      let contents: string;
      if (metadata.isSymbolicLink()) contents = await readlink(absolute);
      else {
        const resolved = await realpath(absolute),
          relative = path.relative(repo.path, resolved);
        if (relative.startsWith('..') || path.isAbsolute(relative))
          throw new ApiError(400, '文件解析后位于仓库之外。');
        if (metadata.size > 1024 * 1024)
          return { diff: `diff --git a/${file} b/${file}\n新文件超过 1 MB，请使用编辑器查看。\n` };
        const buffer = await readFile(absolute);
        if (buffer.includes(0))
          return {
            diff: `diff --git a/${file} b/${file}\nBinary files /dev/null and b/${file} differ\n`,
          };
        contents = buffer.toString('utf8');
      }
      const lines = contents.split('\n');
      if (lines.at(-1) === '') lines.pop();
      return {
        diff: `diff --git a/${file} b/${file}\nnew file mode ${metadata.isSymbolicLink() ? '120000' : '100644'}\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n`,
      };
    }
    const change = (staged ? status.staged : status.unstaged).find((item) => item.path === file);
    return {
      diff: await runGit(repo.path, [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        ...(staged ? ['--cached'] : []),
        '--',
        ...(change?.oldPath ? [change.oldPath] : []),
        file,
      ]),
    };
  }

  async commitDetail(
    id: string,
    hashValue: unknown,
  ): Promise<{ commit: Commit; files: FileChange[]; diff: string }> {
    const repo = this.get(id),
      hash = requireString(hashValue, '提交哈希', 64);
    if (!/^[a-f0-9]{4,64}$/i.test(hash)) throw new ApiError(400, '提交哈希格式无效。');
    await runGit(repo.path, ['rev-parse', '--verify', `${hash}^{commit}`]);
    const [log, names, diff] = await Promise.all([
      runGit(repo.path, ['show', '-s', `--format=${COMMIT_FORMAT}`, hash, '--']),
      runGit(repo.path, [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '--name-status',
        '-r',
        '-m',
        '--first-parent',
        '-M',
        '-z',
        hash,
        '--',
      ]),
      runGit(repo.path, [
        'show',
        '--format=',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '-m',
        '--first-parent',
        '--stat',
        '--patch',
        hash,
        '--',
      ]),
    ]);
    return { commit: parseCommits(log)[0], files: parseNameStatus(names), diff };
  }

  private async branchName(repo: Repository, input: unknown): Promise<string> {
    const name = requireString(input, '分支名称', 240);
    if (name.startsWith('-') || name.startsWith('@') || name === 'HEAD')
      throw new ApiError(400, '分支名称无效。');
    await runGit(repo.path, ['check-ref-format', '--branch', name]);
    return name;
  }

  private async remoteName(repo: Repository, input: unknown): Promise<string> {
    const remotes = (await runGit(repo.path, ['remote'])).trim().split('\n').filter(Boolean);
    if (!remotes.length) throw new ApiError(400, '此仓库尚未配置远程，请先添加远程地址。');
    const name = requireString(
      input ?? (remotes.includes('origin') ? 'origin' : remotes[0]),
      '远程名称',
      120,
    );
    if (!remotes.includes(name) || name.startsWith('-'))
      throw new ApiError(400, '所选远程仓库不存在，请先添加远程。');
    return name;
  }

  async action(id: string, payload: GitAction): Promise<{ message: string }> {
    const repo = this.get(id);
    const release = await this.acquireMutation(repo);
    try {
      const git = (args: string[], remote = false) =>
        runGit(repo.path, args, { timeout: remote ? 120_000 : 30_000 });
      const files = () => {
        if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > 2000)
          throw new ApiError(400, '请选择要操作的文件（最多 2000 个）。');
        return [...new Set(payload.files.map(safeRelativePath))];
      };
      const stashRef = () => {
        const ref = requireString(payload.ref, '储藏引用', 100);
        if (!/^stash@\{\d+\}$/.test(ref)) throw new ApiError(400, '储藏引用无效。');
        return ref;
      };
      const hash = () => {
        const value = requireString(payload.hash, '提交哈希', 64);
        if (!/^[a-f0-9]{4,64}$/i.test(value)) throw new ApiError(400, '提交哈希无效。');
        return value;
      };
      const recovery = /^(merge|cherry-pick|revert|rebase)-(abort|continue)$/.exec(payload.action);
      if (recovery && (await this.operation(repo)) !== recovery[1])
        throw new ApiError(409, '仓库当前没有对应的待处理操作，请刷新状态后重试。');
      switch (payload.action) {
        case 'stage':
          await git(['add', '--', ...files()]);
          break;
        case 'unstage': {
          const selected = files(),
            status = await this.status(repo);
          const paths = [
            ...new Set([
              ...selected,
              ...status.staged
                .filter((file) => selected.includes(file.path) && file.oldPath)
                .map((file) => file.oldPath!),
            ]),
          ];
          await git(
            status.head
              ? ['reset', '-q', 'HEAD', '--', ...paths]
              : ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...paths],
          );
          break;
        }
        case 'discard': {
          const selected = files(),
            status = await this.status(repo);
          const untracked = new Set(status.untracked.map((file) => file.path));
          const tracked = new Set(
            [...status.unstaged, ...status.conflicted].map((file) => file.path),
          );
          if (selected.some((file) => !tracked.has(file) && !untracked.has(file)))
            throw new ApiError(400, '部分文件状态已经改变，请刷新后重试。');
          const trackedFiles = selected.filter((file) => tracked.has(file)),
            newFiles = selected.filter((file) => untracked.has(file));
          if (trackedFiles.length) await git(['restore', '--worktree', '--', ...trackedFiles]);
          if (newFiles.length) await git(['clean', '-f', '--', ...newFiles]);
          break;
        }
        case 'commit':
          await git(['commit', '-m', requireString(payload.message, '提交说明', 20_000)]);
          break;
        case 'fetch':
          await git(['fetch', '--prune', await this.remoteName(repo, payload.remote)], true);
          break;
        case 'pull': {
          const status = await this.status(repo),
            remote = await this.remoteName(repo, payload.remote ?? status.upstream?.split('/')[0]);
          const branch = status.upstream?.startsWith(`${remote}/`)
            ? status.upstream.slice(remote.length + 1)
            : await this.branchName(repo, status.branch);
          await git(['pull', '--ff-only', remote, branch], true);
          break;
        }
        case 'push': {
          const status = await this.status(repo),
            branch = await this.branchName(repo, status.branch);
          await git(
            [
              'push',
              '--set-upstream',
              await this.remoteName(repo, payload.remote ?? status.upstream?.split('/')[0]),
              branch,
            ],
            true,
          );
          break;
        }
        case 'branch-create': {
          const name = await this.branchName(repo, payload.name),
            start = payload.startPoint
              ? await this.branchName(repo, payload.startPoint)
              : undefined;
          await git(['switch', '-c', name, ...(start ? [start] : []), '--']);
          break;
        }
        case 'branch-switch': {
          const name = await this.branchName(repo, payload.name);
          const refs = (
            await git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
          )
            .trim()
            .split('\n');
          if (refs.includes(`refs/heads/${name}`)) await git(['switch', name, '--']);
          else if (refs.includes(`refs/remotes/${name}`)) {
            const localName = name.slice(name.indexOf('/') + 1);
            await git(
              refs.includes(`refs/heads/${localName}`)
                ? ['switch', localName, '--']
                : ['switch', '--track', name, '--'],
            );
          } else await git(['switch', name, '--']);
          break;
        }
        case 'branch-delete':
          await git(['branch', '-d', '--', await this.branchName(repo, payload.name)]);
          break;
        case 'merge':
          await git(['merge', '--no-edit', '--', await this.branchName(repo, payload.name)]);
          break;
        case 'stash-save':
          await git([
            'stash',
            'push',
            ...(payload.includeUntracked ? ['--include-untracked'] : []),
            '-m',
            typeof payload.message === 'string' && payload.message.trim()
              ? requireString(payload.message, '储藏说明', 2000)
              : 'Branchlet 工作进度',
          ]);
          break;
        case 'stash-apply':
          await git(['stash', 'apply', stashRef()]);
          break;
        case 'stash-pop':
          await git(['stash', 'pop', stashRef()]);
          break;
        case 'stash-drop':
          await git(['stash', 'drop', stashRef()]);
          break;
        case 'tag-create': {
          const name = requireString(payload.name, '标签名称', 240);
          if (name.startsWith('-')) throw new ApiError(400, '标签名称无效。');
          await git(['check-ref-format', `refs/tags/${name}`]);
          await git(
            payload.message?.trim()
              ? ['tag', '-a', name, '-m', requireString(payload.message, '标签说明', 2000)]
              : ['tag', '--', name],
          );
          break;
        }
        case 'tag-delete': {
          const name = requireString(payload.name, '标签名称', 240);
          if (name.startsWith('-')) throw new ApiError(400, '标签名称无效。');
          await git(['tag', '-d', '--', name]);
          break;
        }
        case 'tag-push': {
          const name = requireString(payload.name, '标签名称', 240);
          if (name.startsWith('-')) throw new ApiError(400, '标签名称无效。');
          await git(['check-ref-format', `refs/tags/${name}`]);
          await git(['show-ref', '--verify', `refs/tags/${name}`]);
          await git(
            [
              'push',
              await this.remoteName(repo, payload.remote),
              `refs/tags/${name}:refs/tags/${name}`,
            ],
            true,
          );
          break;
        }
        case 'remote-add': {
          const name = requireString(payload.name, '远程名称', 120);
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name))
            throw new ApiError(400, '远程名称仅支持字母、数字、点、下划线与连字符。');
          await git(['remote', 'add', name, safeRemoteUrl(payload.url)]);
          break;
        }
        case 'remote-remove':
          await git(['remote', 'remove', await this.remoteName(repo, payload.name)]);
          break;
        case 'cherry-pick':
          await git(['cherry-pick', hash()]);
          break;
        case 'revert':
          await git(['revert', '--no-edit', hash()]);
          break;
        case 'merge-abort':
          await git(['merge', '--abort']);
          break;
        case 'cherry-pick-abort':
          await git(['cherry-pick', '--abort']);
          break;
        case 'revert-abort':
          await git(['revert', '--abort']);
          break;
        case 'rebase-abort':
          await git(['rebase', '--abort']);
          break;
        case 'merge-continue':
          await git(['commit', '--no-edit']);
          break;
        case 'cherry-pick-continue':
          await git(['-c', 'core.editor=true', 'cherry-pick', '--continue']);
          break;
        case 'revert-continue':
          await git(['-c', 'core.editor=true', 'revert', '--continue']);
          break;
        case 'rebase-continue':
          await git(['-c', 'core.editor=true', 'rebase', '--continue']);
          break;
        default:
          throw new ApiError(400, '不支持的 Git 操作。');
      }
      return { message: '操作已完成' };
    } finally {
      release();
    }
  }

  async config(id: string) {
    const repo = this.get(id);
    const [name, email] = await Promise.all([
      runGit(repo.path, ['config', '--get', 'user.name'], { allowFailure: true }),
      runGit(repo.path, ['config', '--get', 'user.email'], { allowFailure: true }),
    ]);
    return { name: name.trim(), email: email.trim() };
  }

  async setConfig(id: string, input: { name?: unknown; email?: unknown }) {
    const repo = this.get(id),
      name = requireString(input.name, '用户名', 200),
      email = requireString(input.email, '邮箱', 320);
    if (/[\r\n<>]/.test(name) || !/^[^\s<>@]+@[^\s<>@]+$/.test(email))
      throw new ApiError(400, '请输入有效的 Git 用户名和邮箱。');
    const release = await this.acquireMutation(repo);
    try {
      await runGit(repo.path, ['config', '--local', 'user.name', name]);
      await runGit(repo.path, ['config', '--local', 'user.email', email]);
      return { name, email };
    } finally {
      release();
    }
  }

  async filesystem(input?: string): Promise<DirectoryListing> {
    const root = localPath(input ? requireString(input, '目录路径') : os.homedir());
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      throw new ApiError(400, '无法读取该目录，请检查路径与访问权限。');
    }
    const rootCandidates =
      process.platform === 'win32'
        ? Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
        : ['/'];
    const roots = (
      await Promise.all(
        rootCandidates.map(async (candidate) =>
          (await exists(candidate))
            ? {
                name: process.platform === 'win32' ? `磁盘 ${candidate.slice(0, 2)}` : '文件系统',
                path: candidate,
              }
            : null,
        ),
      )
    ).filter((candidate): candidate is { name: string; path: string } => candidate !== null);
    const directories = await Promise.all(
      entries
        .filter(
          (entry) => entry.isDirectory() && entry.name !== '.git' && !entry.name.startsWith('$'),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 500)
        .map(async (entry) => ({
          name: entry.name,
          path: path.join(root, entry.name),
          isRepository: await exists(path.join(root, entry.name, '.git')),
        })),
    );
    return {
      path: root,
      parent: path.dirname(root) === root ? null : path.dirname(root),
      roots,
      directories,
    };
  }
}
