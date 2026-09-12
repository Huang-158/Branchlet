import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpFromLine,
  Check,
  ExternalLink,
  FileArchive,
  Github,
  KeyRound,
  LoaderCircle,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { ReleaseSummary } from '../../server/releases';
import './releases.css';

interface ReleaseState {
  available: boolean;
  authenticated: boolean;
  owner?: string;
  repository?: string;
  remote?: string;
  login?: string;
  message?: string;
  releases: ReleaseSummary[];
  remotes: { name: string; owner: string; repository: string }[];
}

const MAX_FILE = 100 * 1024 * 1024;
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : '操作未完成，请重试。';
const fileSize = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ''
    : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(
        date,
      );
}

async function uploadAsset(repoId: string, releaseId: number, file: File, remote: string) {
  const session = await fetch('/api/session');
  if (!session.ok) throw new Error('无法连接本地 Git 服务。');
  const { token } = (await session.json()) as { token: string };
  const query = new URLSearchParams({ name: file.name, remote });
  const response = await fetch(`/api/repos/${repoId}/releases/${releaseId}/assets?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Branchlet-Token': token },
    body: file,
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error || '附件上传未完成。');
}

function CreateReleaseDialog({
  target,
  busy,
  onClose,
  onCreate,
}: {
  target: string;
  busy: boolean;
  onClose: () => void;
  onCreate: (values: {
    tag: string;
    title: string;
    notes: string;
    draft: boolean;
    prerelease: boolean;
  }) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [tag, setTag] = useState(''),
    [title, setTitle] = useState(''),
    [notes, setNotes] = useState('');
  const [draft, setDraft] = useState(true),
    [prerelease, setPrerelease] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await onCreate({ tag: tag.trim(), title: title.trim(), notes, draft, prerelease });
    } catch (failure) {
      setError(messageOf(failure));
    }
  }
  return (
    <dialog
      ref={dialog}
      className="release-dialog"
      aria-labelledby="create-release-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="release-dialog-head">
          <div className="release-symbol">
            <Package size={22} />
          </div>
          <button
            type="button"
            className="release-icon-button"
            aria-label="关闭创建 Release"
            disabled={busy}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <h2 id="create-release-title">创建 Release</h2>
        <p className="release-muted">
          发布到 <strong>{target}</strong>
        </p>
        <label className="release-field">
          <span>
            Git 标签 <b>*</b>
          </span>
          <input
            autoFocus
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="例如 v1.2.0"
            maxLength={240}
            required
            disabled={busy}
          />
          <small>使用已推送到 GitHub 的标签。可先在「标签管理」创建并推送。</small>
        </label>
        <label className="release-field">
          <span>版本标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如 Branchlet 1.2 · 全新工作流"
            maxLength={200}
            disabled={busy}
          />
        </label>
        <label className="release-field">
          <span>发布说明</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={'## 新功能\n- 描述此版本的更新内容\n\n## 修复\n- 已解决的问题'}
            maxLength={65536}
            rows={7}
            disabled={busy}
          />
          <small>支持 Markdown，发布后在 GitHub 展示。</small>
        </label>
        <div className="release-options">
          <label>
            <input
              type="checkbox"
              checked={draft}
              onChange={(event) => setDraft(event.target.checked)}
              disabled={busy}
            />
            <span>
              保存为草稿<small>先准备附件，再从当前页面发布</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={prerelease}
              onChange={(event) => setPrerelease(event.target.checked)}
              disabled={busy}
            />
            <span>
              标记为预发布<small>适合 Beta、RC 等测试版本</small>
            </span>
          </label>
        </div>
        {!draft && (
          <p className="release-publish-note">
            点击「发布 Release」后，此版本会立即显示在 GitHub 仓库中。
          </p>
        )}
        {error && (
          <div className="release-error" role="alert">
            {error}
          </div>
        )}
        <div className="release-dialog-footer">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="button primary" type="submit" disabled={busy || !tag.trim()}>
            {busy ? <LoaderCircle size={15} className="release-spinning" /> : <Package size={15} />}
            {busy ? '正在创建…' : draft ? '创建草稿' : '发布 Release'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function PublishReleaseDialog({
  release,
  target,
  busy,
  onClose,
  onPublish,
}: {
  release: ReleaseSummary;
  target: string;
  busy: boolean;
  onClose: () => void;
  onPublish: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="release-dialog"
      aria-labelledby="publish-release-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="release-dialog-head">
        <div className="release-symbol">
          <Package size={22} />
        </div>
        <button
          className="release-icon-button"
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="关闭发布确认"
        >
          <X size={19} />
        </button>
      </div>
      <h2 id="publish-release-title">发布这个版本？</h2>
      <p className="release-muted">
        请确认即将发布到 <strong>{target}</strong> 的内容。
      </p>
      <div className="release-publish-review">
        <strong>{release.title}</strong>
        <span>
          <Tag size={13} />
          {release.tag}
          {release.prerelease ? ' · 预发布' : ' · 正式版本'}
        </span>
        <p>{release.assets.length} 个附件</p>
        {release.assets.map((asset) => (
          <small key={asset.id}>
            {asset.name} · {fileSize(asset.size)}
          </small>
        ))}
      </div>
      <p className="release-publish-note">发布后，版本说明和附件会立即对有权访问仓库的人可见。</p>
      {error && (
        <div className="release-error" role="alert">
          {error}
        </div>
      )}
      <div className="release-dialog-footer">
        <button className="button" type="button" onClick={onClose} disabled={busy}>
          返回检查
        </button>
        <button
          className="button primary"
          type="button"
          disabled={busy}
          onClick={() => {
            setError('');
            void onPublish().catch((failure) => setError(messageOf(failure)));
          }}
        >
          {busy ? <LoaderCircle size={15} className="release-spinning" /> : <Package size={15} />}
          {busy ? '正在发布…' : '确认发布'}
        </button>
      </div>
    </dialog>
  );
}

export function ReleasesPanel({
  repoId,
  onNotice,
}: {
  repoId: string;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [data, setData] = useState<ReleaseState>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [remote, setRemote] = useState(''),
    [accessToken, setAccessToken] = useState(''),
    [busy, setBusy] = useState('');
  const [creating, setCreating] = useState(false),
    [chosen, setChosen] = useState<Record<number, File[]>>({});
  const [publishing, setPublishing] = useState<ReleaseSummary>();
  const [uploadProgress, setUploadProgress] = useState('');
  const sequence = useRef(0),
    activeRepo = useRef(repoId),
    notice = useRef(onNotice);
  activeRepo.current = repoId;
  notice.current = onNotice;
  const load = useCallback(async () => {
    if (activeRepo.current !== repoId) return;
    const request = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const value = await api<ReleaseState>(
        `/repos/${repoId}/releases${remote ? `?remote=${encodeURIComponent(remote)}` : ''}`,
      );
      if (request === sequence.current && activeRepo.current === repoId) setData(value);
    } catch (failure) {
      if (request === sequence.current && activeRepo.current === repoId)
        setError(messageOf(failure));
    } finally {
      if (request === sequence.current && activeRepo.current === repoId) setLoading(false);
    }
  }, [repoId, remote]);
  useEffect(() => {
    setData(undefined);
    setRemote('');
    setAccessToken('');
    setCreating(false);
    setPublishing(undefined);
    setChosen({});
    setBusy('');
  }, [repoId]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy('connect');
    setError('');
    try {
      const result = await api<{ login: string }>(`/repos/${repoId}/releases/auth`, {
        method: 'POST',
        body: JSON.stringify({ token: accessToken.trim() }),
      });
      notice.current(`已连接 GitHub · ${result.login}`);
      await load();
    } catch (failure) {
      if (activeRepo.current === repoId) setError(messageOf(failure));
    } finally {
      if (activeRepo.current === repoId) {
        setAccessToken('');
        setBusy('');
      }
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    try {
      await api(`/repos/${repoId}/releases/auth/clear`, { method: 'POST', body: '{}' });
      setChosen({});
      notice.current('已断开 GitHub，访问令牌已从本次会话清除。');
      await load();
    } catch (failure) {
      notice.current(messageOf(failure), true);
    } finally {
      if (activeRepo.current === repoId) setBusy('');
    }
  }

  async function create(values: {
    tag: string;
    title: string;
    notes: string;
    draft: boolean;
    prerelease: boolean;
  }) {
    setBusy('create');
    try {
      const release = await api<ReleaseSummary>(`/repos/${repoId}/releases`, {
        method: 'POST',
        body: JSON.stringify({ ...values, remote: data?.remote }),
      });
      notice.current(`${release.draft ? '已创建草稿' : '已发布 Release'} · ${release.tag}`);
      if (activeRepo.current === repoId) setCreating(false);
      await load();
    } finally {
      if (activeRepo.current === repoId) setBusy('');
    }
  }

  async function upload(release: ReleaseSummary) {
    const files = chosen[release.id] ?? [];
    if (!files.length) return;
    const destination = data?.remote ?? remote;
    setBusy(`upload-${release.id}`);
    let completed = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (activeRepo.current === repoId)
          setUploadProgress(`正在上传 ${index + 1}/${files.length} · ${file.name}`);
        await uploadAsset(repoId, release.id, file, destination);
        completed += 1;
      }
      notice.current(`已上传 ${completed} 个附件到 ${release.tag}`);
    } catch (failure) {
      notice.current(messageOf(failure), true);
    } finally {
      if (activeRepo.current === repoId) {
        setChosen((previous) => ({ ...previous, [release.id]: files.slice(completed) }));
        setBusy('');
        setUploadProgress('');
      }
      await load();
    }
  }

  async function publish() {
    if (!publishing) return;
    setBusy('publish');
    try {
      const result = await api<ReleaseSummary>(
        `/repos/${repoId}/releases/${publishing.id}/publish`,
        { method: 'POST', body: JSON.stringify({ remote: data?.remote }) },
      );
      notice.current(`已发布 Release · ${result.tag}`);
      if (activeRepo.current === repoId) setPublishing(undefined);
      await load();
    } finally {
      if (activeRepo.current === repoId) setBusy('');
    }
  }

  const tokenUrl = `https://github.com/settings/personal-access-tokens/new?name=Branchlet%20Releases&contents=write&expires_in=30${data?.owner ? `&target_name=${encodeURIComponent(data.owner)}` : ''}`;
  return (
    <section className="releases-page">
      <header className="release-page-heading">
        <div>
          <h2>版本与附件</h2>
          <p>准备说明、上传附件，再发布你的版本。</p>
        </div>
        <div className="release-heading-actions">
          <button
            type="button"
            className="button"
            onClick={() => void load()}
            disabled={loading || Boolean(busy)}
            aria-label="刷新 Release 列表"
          >
            <RefreshCw size={15} className={loading ? 'release-spinning' : ''} />
            刷新
          </button>
          <button
            type="button"
            className="button primary"
            onClick={() => setCreating(true)}
            disabled={!data?.available || !data.authenticated || Boolean(busy)}
          >
            <Plus size={16} />
            创建 Release
          </button>
        </div>
      </header>
      {error && (
        <div className="release-error" role="alert">
          {error}
        </div>
      )}
      {loading && !data ? (
        <div className="release-empty">
          <LoaderCircle size={26} className="release-spinning" />
          <p>正在检查 GitHub 连接…</p>
        </div>
      ) : (
        <>
          <div className="release-connection">
            <div className="release-github-mark">
              <Github size={23} />
            </div>
            <div className="release-connection-info">
              <strong>
                {data?.owner && data.repository
                  ? `${data.owner} / ${data.repository}`
                  : '连接你的 GitHub 仓库'}
              </strong>
              <span>
                {data?.authenticated ? `已连接 · ${data.login}` : 'GitHub.com · 版本与发布附件'}
              </span>
            </div>
            {(data?.remotes.length ?? 0) > 1 && (
              <select
                aria-label="Release 目标远程仓库"
                value={remote || data?.remote || ''}
                onChange={(event) => {
                  setRemote(event.target.value);
                  setChosen({});
                }}
                disabled={Boolean(busy)}
              >
                {data?.remotes.map((item) => (
                  <option value={item.name} key={item.name}>
                    {item.name} · {item.owner}/{item.repository}
                  </option>
                ))}
              </select>
            )}
            {data?.authenticated && (
              <>
                <span className="release-connected">
                  <Check size={13} />
                  已连接
                </span>
                <button
                  type="button"
                  className="release-icon-button"
                  onClick={() => void disconnect()}
                  disabled={Boolean(busy)}
                  aria-label="断开 GitHub 连接"
                  title="断开 GitHub 连接"
                >
                  <LogOut size={17} />
                </button>
              </>
            )}
          </div>
          {!data?.available ? (
            <div className="release-empty release-onboarding">
              <div className="release-empty-icon">
                <Package size={35} />
              </div>
              <h2>从一个 GitHub 仓库开始</h2>
              <p>
                {data?.message || '在「远程仓库」中添加 GitHub.com 地址，即可创建和管理 Release。'}
              </p>
              <div className="release-steps">
                <span>
                  <b>1</b>添加 GitHub 远程
                </span>
                <span>
                  <b>2</b>连接访问令牌
                </span>
                <span>
                  <b>3</b>创建版本与上传附件
                </span>
              </div>
            </div>
          ) : !data.authenticated ? (
            <div className="release-auth-card">
              <div>
                <div className="release-symbol">
                  <KeyRound size={23} />
                </div>
                <h2>连接 GitHub，让版本发布更简单</h2>
                <p>
                  创建一个仅授权{' '}
                  <strong>
                    {data.owner}/{data.repository}
                  </strong>{' '}
                  的 Fine-grained token，并将 <strong>Contents</strong> 权限设为{' '}
                  <strong>Read and write</strong>。
                </p>
                <a className="release-text-link" href={tokenUrl} target="_blank" rel="noreferrer">
                  在 GitHub 创建访问令牌 <ExternalLink size={13} />
                </a>
              </div>
              <form onSubmit={connect}>
                <label className="release-field">
                  <span>GitHub 访问令牌</span>
                  <input
                    type="password"
                    value={accessToken}
                    onChange={(event) => setAccessToken(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="github_pat_…"
                    maxLength={1024}
                    required
                    disabled={Boolean(busy)}
                  />
                </label>
                <button
                  className="button primary"
                  type="submit"
                  disabled={Boolean(busy) || !accessToken.trim()}
                >
                  {busy === 'connect' ? (
                    <LoaderCircle size={15} className="release-spinning" />
                  ) : (
                    <Github size={15} />
                  )}
                  {busy === 'connect' ? '正在连接…' : '连接 GitHub'}
                </button>
                <p className="release-token-note">
                  <ShieldCheck size={15} />
                  令牌仅保存在本地服务内存中；断开连接或退出服务后清除。
                </p>
              </form>
            </div>
          ) : data.releases.length === 0 ? (
            <div className="release-empty">
              <div className="release-empty-icon">
                <Package size={35} />
              </div>
              <h2>下一个版本，从这里出发</h2>
              <p>创建一个 Release 草稿，添加更新说明，再上传你的安装包和资源文件。</p>
              <button
                className="button primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setCreating(true)}
              >
                <Plus size={15} />
                创建第一个 Release
              </button>
            </div>
          ) : (
            <div className="release-list" aria-busy={loading}>
              {data.releases.map((release) => (
                <article className="release-card" key={release.id}>
                  <div className="release-card-top">
                    <div className="release-version-icon">
                      <Tag size={21} />
                    </div>
                    <div className="release-card-heading">
                      <div>
                        <h2>{release.title}</h2>
                        {release.draft ? (
                          <span className="release-badge draft">草稿</span>
                        ) : release.prerelease ? (
                          <span className="release-badge prerelease">预发布</span>
                        ) : (
                          <span className="release-badge published">已发布</span>
                        )}
                      </div>
                      <p>
                        <code>{release.tag}</code>
                        <span>·</span>
                        {dateLabel(release.publishedAt || release.createdAt)}
                        <span>·</span>
                        {release.assets.length} 个附件
                      </p>
                    </div>
                    {release.draft && (
                      <button
                        type="button"
                        className="button primary"
                        disabled={Boolean(busy)}
                        onClick={() => setPublishing(release)}
                      >
                        <Package size={13} />
                        发布草稿
                      </button>
                    )}
                    {release.url && (
                      <a className="button" href={release.url} target="_blank" rel="noreferrer">
                        {release.draft ? '在 GitHub 编辑' : '在 GitHub 查看'}
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                  {release.notes && (
                    <details className="release-notes">
                      <summary>发布说明</summary>
                      <div>{release.notes}</div>
                    </details>
                  )}
                  <div className="release-assets">
                    <h3>
                      <FileArchive size={15} />
                      发布附件 <span>{release.assets.length}</span>
                    </h3>
                    {release.assets.length ? (
                      <div className="release-asset-list">
                        {release.assets.map((asset) => (
                          <div className="release-asset" key={asset.id}>
                            <FileArchive size={16} />
                            <div>
                              {asset.url ? (
                                <a href={asset.url} target="_blank" rel="noreferrer">
                                  {asset.name}
                                  <ExternalLink size={11} />
                                </a>
                              ) : (
                                <span>{asset.name}</span>
                              )}
                              <small>
                                {fileSize(asset.size)} · {asset.downloads} 次下载
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="release-no-assets">
                        尚未添加附件。上传安装包、压缩包或其他交付文件。
                      </p>
                    )}
                    <div className="release-upload-row">
                      <label className={`button release-file-picker${busy ? ' disabled' : ''}`}>
                        <Plus size={14} />
                        选择附件
                        <input
                          type="file"
                          multiple
                          disabled={Boolean(busy)}
                          aria-label={`为 ${release.tag} 选择上传附件`}
                          onChange={(event) => {
                            const files = Array.from(event.target.files ?? []);
                            if (files.some((file) => !file.size || file.size > MAX_FILE)) {
                              notice.current('请选择非空文件，单个附件不超过 100 MB。', true);
                              event.target.value = '';
                              return;
                            }
                            setChosen((previous) => ({ ...previous, [release.id]: files }));
                            event.target.value = '';
                          }}
                        />
                      </label>
                      <span className="release-upload-hint">
                        {(chosen[release.id]?.length ?? 0)
                          ? `已选择 ${chosen[release.id].length} 个文件 · ${fileSize(chosen[release.id].reduce((total, file) => total + file.size, 0))}`
                          : '单个附件最多 100 MB'}
                      </span>
                      <button
                        className="button primary"
                        type="button"
                        onClick={() => void upload(release)}
                        disabled={Boolean(busy) || !chosen[release.id]?.length}
                      >
                        {busy === `upload-${release.id}` ? (
                          <LoaderCircle size={14} className="release-spinning" />
                        ) : (
                          <ArrowUpFromLine size={14} />
                        )}
                        上传附件
                      </button>
                    </div>
                    {Boolean(chosen[release.id]?.length) && (
                      <div className="release-selected-files">
                        {chosen[release.id].map((file, index) => (
                          <span key={`${file.name}-${index}`} title={file.name}>
                            {file.name}
                            <button
                              type="button"
                              aria-label={`移除 ${file.name}`}
                              disabled={Boolean(busy)}
                              onClick={() =>
                                setChosen((previous) => ({
                                  ...previous,
                                  [release.id]: previous[release.id].filter(
                                    (_, item) => item !== index,
                                  ),
                                }))
                              }
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {busy === `upload-${release.id}` && (
                      <p className="release-upload-progress" role="status">
                        {uploadProgress}，请等待 GitHub 确认。
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {data?.authenticated && data.available && (
            <p className="release-footnote">
              <ShieldCheck size={13} />
              显示最近 100 个
              Release。上传前请确认文件和目标版本；已发布版本的附件会立即对有权访问仓库的人可见。
            </p>
          )}
        </>
      )}
      {creating && data?.owner && data.repository && (
        <CreateReleaseDialog
          target={`${data.owner}/${data.repository}`}
          busy={busy === 'create'}
          onClose={() => setCreating(false)}
          onCreate={create}
        />
      )}
      {publishing && data?.owner && data.repository && (
        <PublishReleaseDialog
          release={publishing}
          target={`${data.owner}/${data.repository}`}
          busy={busy === 'publish'}
          onClose={() => setPublishing(undefined)}
          onPublish={publish}
        />
      )}
    </section>
  );
}
