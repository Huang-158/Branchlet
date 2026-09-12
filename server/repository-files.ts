import { Router } from 'express';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Repository } from '../shared/types.js';
import { ApiError, runGit, safeRelativePath } from './git-command.js';
import type { GitService } from './git-service.js';

const MAX_ENTRIES = 1000;
const MAX_PREVIEW_BYTES = 1024 * 1024;
interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  status?: string;
  size?: number;
}
export interface RepositoryDirectory {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  truncated: boolean;
}
export interface RepositoryPreview {
  path: string;
  content?: string;
  binary: boolean;
  truncated: boolean;
  size: number;
}

function normalizedPath(value: unknown, allowRoot: boolean): string {
  if (allowRoot && (value === undefined || value === '')) return '';
  const input = safeRelativePath(value);
  const normalized = input.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/');
  if (
    normalized.startsWith('/') ||
    parts.some((part) => !part || part === '.' || part.includes(':'))
  )
    throw new ApiError(400, '文件路径必须是仓库内的相对路径。');
  if (parts.some((part) => part.replace(/[. ]+$/, '').toLowerCase() === 'node_modules'))
    throw new ApiError(403, '依赖目录默认不在仓库文件浏览范围内。');
  return normalized;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

async function resolveWorkspacePath(repo: Repository, relative: string, allowFinalSymlink = false) {
  const root = await realpath(repo.path);
  const target = path.resolve(root, relative || '.');
  if (!inside(root, target)) throw new ApiError(400, '路径超出了仓库范围。');
  let cursor = root;
  const parts = relative.split('/').filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    cursor = path.join(cursor, parts[index]);
    const info = await lstat(cursor);
    if (info.isSymbolicLink()) {
      if (allowFinalSymlink && index === parts.length - 1) return { root, target, info };
      throw new ApiError(403, '不跟随符号链接读取文件或文件夹。');
    }
  }
  const canonical = await realpath(target);
  if (!inside(root, canonical)) throw new ApiError(403, '真实文件路径超出了仓库范围。');
  return { root, target, info: await lstat(target) };
}

async function visiblePaths(cwd: string, file?: string, directory = false) {
  return (
    await runGit(
      cwd,
      [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--exclude=node_modules/',
        ...(file && !directory ? [] : ['--directory']),
        '-z',
        ...(file ? ['--', file] : []),
      ],
      { env: { GIT_LITERAL_PATHSPECS: '1' } },
    )
  )
    .split('\0')
    .filter(Boolean);
}

function entryStatus(
  filePath: string,
  changes: Array<{ path: string; status: string }>,
  directory: boolean,
): string | undefined {
  const direct = changes.find((change) => change.path === filePath);
  if (direct) return direct.status;
  if (!directory) return undefined;
  const nested = changes.filter((change) => change.path.startsWith(`${filePath}/`));
  if (!nested.length) return undefined;
  if (nested.some((change) => change.status === 'U')) return 'U';
  if (nested.every((change) => change.status === '?')) return '?';
  return 'M';
}

export async function listRepositoryDirectory(
  service: GitService,
  id: string,
  input?: unknown,
): Promise<RepositoryDirectory> {
  const repo = service.get(id);
  const relative = normalizedPath(input, true);
  const { target, info } = await resolveWorkspacePath(repo, relative);
  if (!info.isDirectory()) throw new ApiError(400, '所选路径不是文件夹。');
  if (relative) {
    const paths = await visiblePaths(path.dirname(target), path.basename(target), true);
    if (!paths.length) throw new ApiError(404, '此文件夹不存在于可浏览的仓库文件中。');
  }
  const [children, visible, status] = await Promise.all([
    readdir(target, { withFileTypes: true }),
    visiblePaths(target),
    service.status(repo),
  ]);
  const visibleNames = new Set(visible.map((file) => file.replace(/\\/g, '/').split('/')[0]));
  const changes = [
    ...status.conflicted.map((file) => ({ path: file.path, status: 'U' })),
    ...status.unstaged,
    ...status.untracked,
    ...status.staged,
  ];
  const filtered = children
    .filter((entry) => {
      const name = entry.name.replace(/[. ]+$/, '').toLowerCase();
      return name !== '.git' && name !== 'node_modules' && visibleNames.has(entry.name);
    })
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }),
    );
  const entries: FileEntry[] = [];
  // A bounded loop avoids opening thousands of file descriptors simultaneously.
  for (const child of filtered.slice(0, MAX_ENTRIES)) {
    const filePath = relative ? `${relative}/${child.name}` : child.name;
    const type = child.isSymbolicLink() ? 'symlink' : child.isDirectory() ? 'directory' : 'file';
    if (type === 'file' && !child.isFile()) continue;
    try {
      const stat = await lstat(path.join(target, child.name));
      entries.push({
        name: child.name,
        path: filePath,
        type,
        status: entryStatus(filePath, changes, type === 'directory'),
        ...(type !== 'directory' ? { size: stat.size } : {}),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return {
    path: relative,
    parent: relative ? relative.split('/').slice(0, -1).join('/') : null,
    entries,
    truncated: filtered.length > MAX_ENTRIES,
  };
}

export async function previewRepositoryFile(
  service: GitService,
  id: string,
  input: unknown,
): Promise<RepositoryPreview> {
  const repo = service.get(id);
  const relative = normalizedPath(input, false);
  const { target, info, root } = await resolveWorkspacePath(repo, relative);
  if (!info.isFile()) throw new ApiError(400, '仅支持预览普通文件。');
  const allowed = await visiblePaths(path.dirname(target), path.basename(target));
  if (!allowed.some((file) => file.replace(/\\/g, '/') === path.basename(target)))
    throw new ApiError(404, '此文件已被 Git 忽略，或不在可浏览的仓库文件中。');
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const current = await handle.stat();
    const canonical = await realpath(target);
    const afterOpen = await lstat(target);
    if (
      !inside(root, canonical) ||
      afterOpen.isSymbolicLink() ||
      !current.isFile() ||
      current.ino !== afterOpen.ino ||
      current.dev !== afterOpen.dev
    )
      throw new ApiError(403, '文件路径发生变化，请刷新后重试。');
    const buffer = Buffer.alloc(Math.min(current.size, MAX_PREVIEW_BYTES));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const bytes = buffer.subarray(0, offset);
    const truncated = current.size > MAX_PREVIEW_BYTES;
    let content = '';
    let binary = bytes.includes(0);
    if (!binary) {
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated });
      } catch {
        binary = true;
      }
    }
    if (!binary && bytes.length) {
      let controls = 0;
      for (const byte of bytes)
        if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12) controls++;
      binary = controls / bytes.length > 0.02;
    }
    return {
      path: relative,
      ...(binary ? {} : { content }),
      binary,
      truncated,
      size: current.size,
    };
  } finally {
    await handle.close();
  }
}

function fileError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT' || code === 'ENOTDIR')
    throw new ApiError(404, '文件或文件夹已不存在，请刷新后重试。');
  if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP')
    throw new ApiError(403, '无法读取此路径，请检查本机文件访问权限。');
  throw error;
}

export function createRepositoryFilesRouter(service: GitService) {
  const router = Router();
  router.get('/repos/:id/files', async (req, res) => {
    try {
      res.json(await listRepositoryDirectory(service, req.params.id, req.query.path));
    } catch (error) {
      fileError(error);
    }
  });
  router.get('/repos/:id/file', async (req, res) => {
    try {
      res.json(await previewRepositoryFile(service, req.params.id, req.query.path));
    } catch (error) {
      fileError(error);
    }
  });
  return router;
}
