import express, { type ErrorRequestHandler } from 'express';
import { ApiError, requireString, runGit } from './git-command.js';
import type { GitService } from './git-service.js';

const MAX_ASSET_SIZE = 100 * 1024 * 1024;
const API_VERSION = '2026-03-10';
export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
  downloads: number;
  url: string;
}
export interface ReleaseSummary {
  id: number;
  tag: string;
  title: string;
  notes: string;
  draft: boolean;
  prerelease: boolean;
  createdAt: string;
  publishedAt: string | null;
  url: string;
  assets: ReleaseAsset[];
}
interface GitHubTarget {
  name: string;
  owner: string;
  repository: string;
}
interface Credentials {
  token: string;
  login: string;
}
interface ReleaseDependencies {
  fetch?: typeof fetch;
  git?: typeof runGit;
}
type GitHubObject = Record<string, unknown>;

export function parseGitHubRemote(value: string): Omit<GitHubTarget, 'name'> | null {
  let pathname = '';
  const scp = /^git@github\.com:(.+)$/i.exec(value);
  if (scp) pathname = scp[1];
  else {
    try {
      const url = new URL(value);
      if (
        url.hostname.toLowerCase() !== 'github.com' ||
        !['https:', 'ssh:'].includes(url.protocol) ||
        url.port ||
        url.search ||
        url.hash
      )
        return null;
      pathname = url.pathname.replace(/^\//, '');
    } catch {
      return null;
    }
  }
  const parts = pathname
    .replace(/\/$/, '')
    .replace(/\.git$/i, '')
    .split('/');
  if (
    parts.length !== 2 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(parts[0]) ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(parts[1]) ||
    ['.', '..'].includes(parts[1])
  )
    return null;
  return { owner: parts[0], repository: parts[1] };
}

function githubLink(input: unknown): string {
  if (typeof input !== 'string') return '';
  try {
    const url = new URL(input);
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      !url.username &&
      !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function toAsset(raw: GitHubObject): ReleaseAsset {
  return {
    id: Number(raw.id),
    name: String(raw.name ?? ''),
    size: Number(raw.size ?? 0),
    downloads: Number(raw.download_count ?? 0),
    url: githubLink(raw.browser_download_url),
  };
}

function toRelease(raw: GitHubObject): ReleaseSummary {
  return {
    id: Number(raw.id),
    tag: String(raw.tag_name ?? ''),
    title: String(raw.name || raw.tag_name || ''),
    notes: String(raw.body ?? ''),
    draft: raw.draft === true,
    prerelease: raw.prerelease === true,
    createdAt: String(raw.created_at ?? ''),
    publishedAt: typeof raw.published_at === 'string' ? raw.published_at : null,
    url: githubLink(raw.html_url),
    assets: Array.isArray(raw.assets)
      ? raw.assets.map((asset) => toAsset(asset as GitHubObject))
      : [],
  };
}

function positiveId(input: unknown): number {
  const value = typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : input;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new ApiError(400, 'Release ID 无效。');
  return value;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) return {};
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 8 * 1024 * 1024) {
      await reader.cancel();
      throw new ApiError(502, 'GitHub 返回内容过大，请在 GitHub 页面查看。');
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new ApiError(502, 'GitHub 返回了无法读取的响应，请稍后重试。');
  }
}

/** Tokens live only in this service instance and never enter a file, URL, or response. */
export class ReleasesService {
  private credentials = new Map<string, Credentials>();
  private mutations = new Set<string>();
  private fetcher: typeof fetch;
  private git: typeof runGit;
  constructor(
    private repositories: Pick<GitService, 'get'>,
    dependencies: ReleaseDependencies = {},
  ) {
    this.fetcher = dependencies.fetch ?? fetch;
    this.git = dependencies.git ?? runGit;
  }

  private async targets(id: string): Promise<GitHubTarget[]> {
    const repo = this.repositories.get(id);
    const output = await this.git(repo.path, ['remote', '-v']);
    const targets: GitHubTarget[] = [];
    for (const line of output.split(/\r?\n/)) {
      const match = /^(\S+)\s+(.+) \(fetch\)$/.exec(line.trim());
      if (!match) continue;
      const target = parseGitHubRemote(match[2]);
      if (target) targets.push({ name: match[1], ...target });
    }
    return targets.sort((a, b) => Number(b.name === 'origin') - Number(a.name === 'origin'));
  }

  private async target(id: string, remote?: unknown): Promise<GitHubTarget> {
    const targets = await this.targets(id);
    const target =
      remote === undefined || remote === ''
        ? targets[0]
        : targets.find((item) => item.name === remote);
    if (!target)
      throw new ApiError(400, '当前仓库没有可用的 GitHub.com 远程，请先在远程仓库页面添加。');
    return target;
  }

  private token(id: string): string {
    const auth = this.credentials.get(id);
    if (!auth) throw new ApiError(401, '请先连接 GitHub 访问令牌。');
    return auth.token;
  }

  private async request(
    token: string,
    endpoint: string,
    options: { method?: 'GET' | 'POST' | 'PATCH'; body?: string | Buffer; upload?: boolean } = {},
  ): Promise<unknown> {
    const host = options.upload ? 'uploads.github.com' : 'api.github.com';
    if (!endpoint.startsWith('/') || endpoint.startsWith('//') || /[\r\n]/.test(endpoint))
      throw new ApiError(400, 'GitHub 请求路径无效。');
    let response: Response;
    try {
      response = await this.fetcher(`https://${host}${endpoint}`, {
        method: options.method ?? 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': 'Branchlet-Git-GUI',
          ...(options.body !== undefined
            ? { 'Content-Type': options.upload ? 'application/octet-stream' : 'application/json' }
            : {}),
        },
        ...(options.body !== undefined
          ? { body: typeof options.body === 'string' ? options.body : new Uint8Array(options.body) }
          : {}),
        signal: AbortSignal.timeout(options.upload ? 180_000 : 30_000),
      });
    } catch {
      throw new ApiError(
        502,
        options.method && options.method !== 'GET'
          ? 'GitHub 操作结果尚未确认。请刷新列表检查结果后再决定是否重试。'
          : '无法连接 GitHub，请检查网络后重试。',
      );
    }
    const data = await boundedJson(response);
    if (!response.ok) {
      if (response.status === 401) throw new ApiError(401, 'GitHub 令牌无效或已过期，请重新连接。');
      if (response.status === 403 || response.status === 429)
        throw new ApiError(
          403,
          response.headers.get('x-ratelimit-remaining') === '0'
            ? 'GitHub API 请求额度已用完，请稍后重试。'
            : 'GitHub 拒绝此操作。请确认令牌已授权当前仓库，且 Contents 权限为读写；组织令牌可能需要管理员批准。',
        );
      if (response.status === 404)
        throw new ApiError(404, '未找到 GitHub 仓库、标签或 Release，或当前令牌没有访问权限。');
      if (response.status === 422)
        throw new ApiError(
          422,
          'GitHub 未接受此请求。请检查标签是否有效、Release 或同名附件是否已存在。',
        );
      throw new ApiError(
        502,
        options.method && options.method !== 'GET'
          ? 'GitHub 暂未确认操作完成，请刷新列表检查结果。'
          : 'GitHub 服务暂时不可用，请稍后重试。',
      );
    }
    return data;
  }

  async connect(id: string, input: unknown) {
    this.repositories.get(id);
    const token = requireString(input, '访问令牌', 1024).trim();
    if (/\s/.test(token)) throw new ApiError(400, '访问令牌不能包含空格或换行。');
    const user = (await this.request(token, '/user')) as GitHubObject;
    if (typeof user.login !== 'string' || !user.login)
      throw new ApiError(502, '无法验证 GitHub 用户身份。');
    this.credentials.set(id, { token, login: user.login });
    return { authenticated: true, login: user.login };
  }

  clear(id: string) {
    this.repositories.get(id);
    return this.forgetRepository(id);
  }

  forgetRepository(id: string) {
    this.credentials.delete(id);
    return { authenticated: false };
  }

  async list(id: string, remote?: unknown) {
    const remotes = await this.targets(id);
    const target =
      remote === undefined || remote === ''
        ? remotes[0]
        : remotes.find((item) => item.name === remote);
    const auth = this.credentials.get(id);
    if (!target)
      return {
        available: false,
        authenticated: Boolean(auth),
        login: auth?.login,
        remotes,
        releases: [],
        message: '请先添加 GitHub.com 远程仓库。示例仓库的本地 origin 不支持 Releases。',
      };
    const base = {
      available: true,
      authenticated: Boolean(auth),
      login: auth?.login,
      owner: target.owner,
      repository: target.repository,
      remote: target.name,
      remotes,
    };
    if (!auth)
      return {
        ...base,
        releases: [],
        message: '连接 GitHub 后，可在这里创建 Release 并上传安装包、压缩包等附件。',
      };
    try {
      const data = await this.request(
        auth.token,
        `/repos/${target.owner}/${target.repository}/releases?per_page=100`,
      );
      if (!Array.isArray(data)) throw new ApiError(502, 'GitHub Release 列表格式无效。');
      return { ...base, releases: data.map((item) => toRelease(item as GitHubObject)) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.credentials.delete(id);
        return { ...base, authenticated: false, releases: [], message: error.message };
      }
      throw error;
    }
  }

  private async mutate<T>(target: GitHubTarget, task: () => Promise<T>): Promise<T> {
    const key = `${target.owner}/${target.repository}`.toLowerCase();
    if (this.mutations.has(key))
      throw new ApiError(409, '此 GitHub 仓库正在创建 Release 或上传附件，请稍后重试。');
    this.mutations.add(key);
    try {
      return await task();
    } finally {
      this.mutations.delete(key);
    }
  }

  async create(
    id: string,
    input: {
      tag?: unknown;
      title?: unknown;
      notes?: unknown;
      draft?: unknown;
      prerelease?: unknown;
      remote?: unknown;
    },
  ) {
    const target = await this.target(id, input.remote),
      token = this.token(id);
    const tag = requireString(input.tag, '标签', 240).trim();
    await this.git(this.repositories.get(id).path, ['check-ref-format', `refs/tags/${tag}`]);
    const title =
      input.title === undefined || input.title === ''
        ? tag
        : requireString(input.title, 'Release 标题', 200);
    if (
      input.notes !== undefined &&
      (typeof input.notes !== 'string' || input.notes.includes('\0') || input.notes.length > 65_536)
    )
      throw new ApiError(400, '发布说明必须是最多 65536 字符的文本。');
    for (const field of ['draft', 'prerelease'] as const)
      if (input[field] !== undefined && typeof input[field] !== 'boolean')
        throw new ApiError(400, '草稿与预发布设置必须是布尔值。');
    return this.mutate(target, async () => {
      try {
        await this.request(
          token,
          `/repos/${target.owner}/${target.repository}/git/ref/tags/${encodeURIComponent(tag)}`,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404)
          throw new ApiError(
            400,
            'GitHub 上尚无此标签或令牌无权访问。请先推送该标签，并确认令牌已授权此仓库。',
          );
        throw error;
      }
      const body = JSON.stringify({
        tag_name: tag,
        name: title,
        body: input.notes ?? '',
        draft: input.draft ?? true,
        prerelease: input.prerelease ?? false,
      });
      return toRelease(
        (await this.request(token, `/repos/${target.owner}/${target.repository}/releases`, {
          method: 'POST',
          body,
        })) as GitHubObject,
      );
    });
  }

  async upload(
    id: string,
    releaseValue: unknown,
    nameValue: unknown,
    body: unknown,
    remote?: unknown,
  ) {
    const releaseId = positiveId(releaseValue),
      name = requireString(nameValue, '附件名称', 255);
    if (/[\\/\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..')
      throw new ApiError(400, '附件名称不能包含路径或控制字符。');
    if (!Buffer.isBuffer(body) || !body.length) throw new ApiError(400, '请选择非空附件。');
    if (body.length > MAX_ASSET_SIZE) throw new ApiError(413, '单个附件不能超过 100 MB。');
    const target = await this.target(id, remote),
      token = this.token(id);
    return this.mutate(target, async () => {
      const release = (await this.request(
        token,
        `/repos/${target.owner}/${target.repository}/releases/${releaseId}`,
      )) as GitHubObject;
      if (release.id !== releaseId) throw new ApiError(404, '未找到当前仓库中的此 Release。');
      if (release.immutable === true) throw new ApiError(409, '此 Release 已锁定，不能添加附件。');
      if (
        Array.isArray(release.assets) &&
        release.assets.some((asset) => (asset as GitHubObject).name === name)
      )
        throw new ApiError(409, '同名附件已存在，请更换文件名或先在 GitHub 删除原附件。');
      const expectedPath = `/repos/${target.owner}/${target.repository}/releases/${releaseId}/assets`;
      let uploadUrl: URL;
      try {
        uploadUrl = new URL(String(release.upload_url ?? '').replace(/\{.*\}$/, ''));
      } catch {
        throw new ApiError(502, 'GitHub 未提供有效的附件上传地址。');
      }
      if (
        uploadUrl.protocol !== 'https:' ||
        uploadUrl.hostname !== 'uploads.github.com' ||
        uploadUrl.port ||
        uploadUrl.username ||
        uploadUrl.password ||
        uploadUrl.pathname.toLowerCase() !== expectedPath.toLowerCase()
      )
        throw new ApiError(502, 'GitHub 上传地址未通过安全校验。');
      return toAsset(
        (await this.request(token, `${expectedPath}?name=${encodeURIComponent(name)}`, {
          method: 'POST',
          body,
          upload: true,
        })) as GitHubObject,
      );
    });
  }

  async publish(id: string, releaseValue: unknown, remote?: unknown) {
    const releaseId = positiveId(releaseValue),
      target = await this.target(id, remote),
      token = this.token(id);
    return this.mutate(target, async () => {
      const release = (await this.request(
        token,
        `/repos/${target.owner}/${target.repository}/releases/${releaseId}`,
      )) as GitHubObject;
      if (release.id !== releaseId) throw new ApiError(404, '未找到当前仓库中的此 Release。');
      if (release.draft !== true) return toRelease(release);
      return toRelease(
        (await this.request(
          token,
          `/repos/${target.owner}/${target.repository}/releases/${releaseId}`,
          { method: 'PATCH', body: JSON.stringify({ draft: false }) },
        )) as GitHubObject,
      );
    });
  }
}

/** Mount at /api, before the application's /api 404 handler. */
export function createReleasesRouter(
  service: Pick<GitService, 'get'>,
  dependencies: ReleaseDependencies = {},
) {
  const router = express.Router(),
    releases = new ReleasesService(service, dependencies);
  router.get('/repos/:id/releases', async (req, res) =>
    res.json(await releases.list(String(req.params.id), req.query.remote)),
  );
  router.post('/repos/:id/releases/auth', async (req, res) =>
    res.json(await releases.connect(String(req.params.id), req.body?.token)),
  );
  router.post('/repos/:id/releases/auth/clear', (req, res) =>
    res.json(releases.clear(String(req.params.id))),
  );
  router.post('/repos/:id/releases', async (req, res) =>
    res.status(201).json(await releases.create(String(req.params.id), req.body ?? {})),
  );
  router.post('/repos/:id/releases/:releaseId/publish', async (req, res) =>
    res.json(await releases.publish(String(req.params.id), req.params.releaseId, req.body?.remote)),
  );
  router.post(
    '/repos/:id/releases/:releaseId/assets',
    express.raw({ type: 'application/octet-stream', limit: '100mb', inflate: false }),
    async (req, res) => {
      if (!req.is('application/octet-stream'))
        throw new ApiError(415, '附件上传必须使用 application/octet-stream。');
      res
        .status(201)
        .json(
          await releases.upload(
            String(req.params.id),
            req.params.releaseId,
            req.query.name,
            req.body,
            req.query.remote,
          ),
        );
    },
  );
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if ((error as { type?: string })?.type === 'entity.too.large')
      return res.status(413).json({ error: '单个附件不能超过 100 MB。' });
    if ((error as { type?: string })?.type === 'encoding.unsupported')
      return res.status(415).json({ error: '请使用未经压缩的二进制上传内容。' });
    res.status(500).json({ error: 'Release 操作未完成，请刷新状态后重试。' });
  };
  router.use(errorHandler);
  return Object.assign(router, {
    forgetRepository: (id: string) => releases.forgetRepository(id),
  });
}
