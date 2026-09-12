import { spawn } from 'node:child_process';
import path from 'node:path';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string,
  ) {
    super(message);
  }
}

export function explainGitError(detail: string): string {
  if (/nothing to commit|no changes added to commit/i.test(detail))
    return '没有可提交的暂存更改。请先暂存文件。';
  if (/Author identity unknown|unable to auto-detect email/i.test(detail))
    return '请先在仓库设置中填写 Git 用户名和邮箱。';
  if (/would be overwritten|local changes.*overwritten/i.test(detail))
    return '本地更改会被覆盖。请先提交或储藏更改后重试。';
  if (/CONFLICT|Automatic merge failed|could not revert|could not apply/i.test(detail))
    return '操作产生了冲突。请在工作区处理冲突、暂存文件，再继续操作。';
  if (
    /Authentication failed|Permission denied|could not read Username|terminal prompts disabled/i.test(
      detail,
    )
  )
    return '远程认证失败。请配置 Git 凭据或 SSH 密钥后重试。';
  if (
    /Could not resolve host|Could not resolve hostname|unable to access|Connection refused|Connection timed out/i.test(
      detail,
    )
  )
    return '无法连接远程仓库，请检查网络和远程地址。';
  if (/non-fast-forward|fetch first|rejected/i.test(detail))
    return '远程分支包含本地尚未同步的提交。请先获取并拉取更新。';
  if (/not fully merged/i.test(detail)) return '该分支尚有未合并的提交，不能安全删除。';
  if (/already exists/i.test(detail)) return '同名分支、标签或目标目录已经存在。';
  if (/not a git repository/i.test(detail)) return '所选目录不是 Git 仓库。';
  if (/no upstream branch|no tracking information/i.test(detail))
    return '当前分支尚未设置上游分支，请先推送到远程。';
  if (/dubious ownership/i.test(detail))
    return 'Git 拒绝访问此目录，请检查仓库的所有权与信任设置。';
  if (/unmerged files|unmerged paths|resolve your current index/i.test(detail))
    return '请先处理工作区中的冲突文件。';
  return 'Git 操作未完成，请查看详情。';
}

export async function runGit(
  cwd: string,
  args: string[],
  options: { allowFailure?: boolean; timeout?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Stash invokes internal Git commands using magic pathspecs (:/). Applying
    // --literal-pathspecs globally prevents stash -u from cleaning saved files.
    const literalPaths = [
      'add',
      'reset',
      'rm',
      'restore',
      'clean',
      'diff',
      'diff-tree',
      'show',
      'log',
    ].includes(args[0]);
    const inheritedEnv = { ...process.env };
    // A GUI always targets the chosen repository. Variables inherited from a
    // caller's Git hook or shell must not redirect its worktree or index.
    for (const key of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_LITERAL_PATHSPECS',
      'GIT_GLOB_PATHSPECS',
      'GIT_NOGLOB_PATHSPECS',
      'GIT_ICASE_PATHSPECS',
    ])
      delete inheritedEnv[key];
    const child = spawn(
      'git',
      [
        '-c',
        'core.quotepath=false',
        '-c',
        'protocol.ext.allow=never',
        '-c',
        'core.fsmonitor=false',
        ...(literalPaths ? ['--literal-pathspecs'] : []),
        ...args,
      ],
      {
        cwd,
        shell: false,
        windowsHide: true,
        env: {
          ...inheritedEnv,
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'Never',
          LC_ALL: 'C.UTF-8',
          ...options.env,
        },
      },
    );
    const output: Buffer[] = [],
      error: Buffer[] = [];
    let size = 0,
      stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      child.kill();
      reject(new ApiError(408, 'Git 操作超时，请检查连接后重试。'));
    }, options.timeout ?? 30_000);
    function collect(target: Buffer[], chunk: Buffer) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        stopped = true;
        child.kill();
        clearTimeout(timer);
        reject(new ApiError(413, 'Git 输出超过 4 MB，请缩小文件范围。'));
      } else target.push(chunk);
    }
    child.stdout.on('data', (chunk: Buffer) => collect(output, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(error, chunk));
    child.on('error', (err) => {
      clearTimeout(timer);
      if (!stopped)
        reject(
          new ApiError(
            500,
            '无法启动 Git。请确认仓库目录仍存在，且 Git 已安装并加入 PATH。',
            err.message,
          ),
        );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stopped) return;
      const stdout = Buffer.concat(output).toString('utf8');
      const stderr = Buffer.concat(error).toString('utf8');
      if (code !== 0 && !options.allowFailure)
        reject(
          new ApiError(
            400,
            explainGitError(`${stderr}\n${stdout}`),
            `${stderr}\n${stdout}`.trim().slice(0, 12_000),
          ),
        );
      else resolve(stdout);
    });
  });
}

export function requireString(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > max)
    throw new ApiError(400, `${label}不能为空或包含无效字符。`);
  return value;
}

export function safeRelativePath(value: unknown): string {
  const file = requireString(value, '文件路径');
  if (
    path.isAbsolute(file) ||
    /^[a-z]:/i.test(file) ||
    file
      .split(/[\\/]/)
      .some((part) => part === '..' || part.replace(/[. ]+$/, '').toLowerCase() === '.git') ||
    file === '.'
  )
    throw new ApiError(400, '文件路径必须位于仓库工作区内。');
  return file;
}

export function safeRemoteUrl(value: unknown): string {
  const url = requireString(value, '远程地址');
  if (
    url.startsWith('-') ||
    /[\r\n]/.test(url) ||
    url.includes('::') ||
    (!/^(https?|ssh|git|file):\/\//i.test(url) &&
      !/^[\w.-]+@[\w.-]+:.+/.test(url) &&
      !path.isAbsolute(url))
  )
    throw new ApiError(400, '请输入 HTTPS、SSH 或本地绝对路径形式的 Git 仓库地址。');
  return url;
}
