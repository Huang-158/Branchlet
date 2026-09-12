import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Globe2,
  Keyboard,
  Loader2,
  X,
} from 'lucide-react';
import type { DirectoryListing, Repository } from '../../shared/types';
import { api } from '../api';
import './dialogs.css';

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Modal({
  title,
  description,
  icon,
  busy = false,
  onClose,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const getFocusable = () =>
      Array.from(panel.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (element) => element.tabIndex >= 0 && element.getClientRects().length > 0,
      );
    const timer = window.setTimeout(() => {
      const initial = panel.current?.querySelector<HTMLElement>('[data-autofocus]');
      (initial ?? getFocusable()[0] ?? panel.current)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        if (!busyRef.current) closeRef.current();
      }
      if (event.key === 'Tab') {
        const elements = getFocusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first) {
          event.preventDefault();
          panel.current?.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || !panel.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !panel.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) {
        (getFocusable()[0] ?? panel.current)?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <div
      className="bl-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panel}
        className={`bl-dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        aria-busy={busy}
        tabIndex={-1}
      >
        <header className="bl-dialog-header">
          {icon && (
            <div className="bl-dialog-heading-icon" aria-hidden="true">
              {icon}
            </div>
          )}
          <div className="bl-dialog-heading-copy">
            <h2 id={`${id}-title`}>{title}</h2>
            {description && <p id={`${id}-description`}>{description}</p>}
          </div>
          <button
            className="bl-dialog-close"
            type="button"
            aria-label="关闭弹窗"
            title="关闭 · Esc"
            onClick={onClose}
            disabled={busy}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

type RepositoryMode = 'open' | 'init' | 'clone';
const repositoryModes: { value: RepositoryMode; label: string; icon: typeof FolderOpen }[] = [
  { value: 'open', label: '打开仓库', icon: FolderOpen },
  { value: 'init', label: '新建仓库', icon: GitBranch },
  { value: 'clone', label: '克隆仓库', icon: Globe2 },
];
const repositoryCopy = {
  open: {
    title: '连接你的代码',
    description: '打开本地 Git 仓库，开始管理每一次变更。',
    path: '本地仓库路径',
    hint: '选择一个已经使用 Git 管理的文件夹。',
    submit: '打开仓库',
  },
  init: {
    title: '开启新的项目',
    description: '在本地文件夹中初始化一个 Git 仓库。',
    path: '新仓库路径',
    hint: '可以选择现有文件夹，也可以输入新文件夹的完整路径。',
    submit: '创建仓库',
  },
  clone: {
    title: '把灵感带到本地',
    description: '从远程地址克隆仓库，接着你的进度继续。',
    path: '克隆到本地路径',
    hint: '请输入一个新的或空的目标文件夹完整路径。',
    submit: '克隆仓库',
  },
};

export function RepositoryDialog({
  initialMode,
  onClose,
  onAdded,
}: {
  initialMode: RepositoryMode;
  onClose: () => void;
  onAdded: (repo: Repository) => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<RepositoryMode>(initialMode);
  const [path, setPath] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [browserOpen, setBrowserOpen] = useState(false);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [listingBusy, setListingBusy] = useState(false);
  const [listingError, setListingError] = useState('');
  const requestId = useRef(0);
  const copy = repositoryCopy[mode];

  useEffect(() => {
    let active = true;
    const initialRequest = requestId.current;
    api<DirectoryListing>('/filesystem')
      .then((result) => {
        if (active && requestId.current === initialRequest) {
          setListing(result);
          setPath((previous) => previous || (initialMode === 'open' ? result.path : ''));
        }
      })
      .catch(() => {
        /* A typed path remains available when listing is unavailable. */
      });
    return () => {
      active = false;
      requestId.current += 1;
    };
  }, [initialMode]);

  async function browse(nextPath?: string) {
    const currentRequest = ++requestId.current;
    setListingBusy(true);
    setListingError('');
    try {
      const result = await api<DirectoryListing>(
        `/filesystem${nextPath ? `?path=${encodeURIComponent(nextPath)}` : ''}`,
      );
      if (currentRequest === requestId.current) setListing(result);
    } catch (cause) {
      if (currentRequest === requestId.current)
        setListingError(cause instanceof Error ? cause.message : '无法读取此文件夹');
    } finally {
      if (currentRequest === requestId.current) setListingBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || listingBusy) return;
    setError('');
    if (!path.trim()) {
      setError('请输入本地文件夹的完整路径。');
      return;
    }
    if (mode === 'clone' && !url.trim()) {
      setError('请输入远程仓库地址。');
      return;
    }
    setBusy(true);
    try {
      const result = await api<Repository>(`/repos/${mode}`, {
        method: 'POST',
        body: JSON.stringify({
          path: path.trim(),
          ...(mode === 'clone' ? { url: url.trim() } : {}),
        }),
      });
      onAdded(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '仓库操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={copy.title}
      description={copy.description}
      icon={<FolderGit2 size={23} />}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit} className="bl-dialog-form">
        <div className="bl-dialog-tabs" role="tablist" aria-label="添加仓库的方式">
          {repositoryModes.map((item, index) => (
            <button
              key={item.value}
              id={`${id}-tab-${item.value}`}
              type="button"
              role="tab"
              aria-selected={mode === item.value}
              aria-controls={`${id}-panel`}
              tabIndex={mode === item.value ? 0 : -1}
              className={mode === item.value ? 'is-active' : ''}
              disabled={busy}
              onClick={() => {
                setMode(item.value);
                setError('');
              }}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % repositoryModes.length;
                else if (event.key === 'ArrowLeft')
                  next = (index + repositoryModes.length - 1) % repositoryModes.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = repositoryModes.length - 1;
                else return;
                event.preventDefault();
                setMode(repositoryModes[next].value);
                setError('');
                document.getElementById(`${id}-tab-${repositoryModes[next].value}`)?.focus();
              }}
            >
              <item.icon size={15} />
              {item.label}
            </button>
          ))}
        </div>
        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${mode}`}
          className="bl-dialog-body"
        >
          {mode === 'clone' && (
            <div className="bl-dialog-field">
              <label htmlFor={`${id}-url`}>
                远程仓库地址 <span aria-hidden="true">*</span>
              </label>
              <input
                id={`${id}-url`}
                className="bl-dialog-input bl-dialog-mono"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/username/project.git"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                required
                data-autofocus
              />
              <p className="bl-dialog-field-hint">支持 HTTPS 和 SSH，使用本机已配置的 Git 凭据。</p>
            </div>
          )}
          <div className="bl-dialog-field">
            <label htmlFor={`${id}-path`}>
              {copy.path} <span aria-hidden="true">*</span>
            </label>
            <div className="bl-dialog-path-row">
              <input
                id={`${id}-path`}
                className="bl-dialog-input bl-dialog-mono"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder={
                  mode === 'open' ? 'D:\\projects\\my-project' : 'D:\\projects\\new-project'
                }
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                required
                data-autofocus={mode !== 'clone' ? true : undefined}
                aria-describedby={`${id}-path-hint`}
              />
              <button
                type="button"
                className={`bl-dialog-browse-button ${browserOpen ? 'is-active' : ''}`}
                aria-expanded={browserOpen}
                aria-controls={`${id}-browser`}
                title="浏览本地文件夹"
                aria-label="浏览本地文件夹"
                disabled={busy}
                onClick={() => {
                  setBrowserOpen(!browserOpen);
                  if (!browserOpen) void browse(path.trim() || listing?.path);
                }}
              >
                <FolderOpen size={18} />
                <ChevronDown size={12} />
              </button>
            </div>
            <p id={`${id}-path-hint`} className="bl-dialog-field-hint">
              {copy.hint}
            </p>
          </div>
          {browserOpen && (
            <section
              id={`${id}-browser`}
              className="bl-dialog-browser"
              aria-label="本地文件夹选择器"
              aria-busy={listingBusy}
            >
              <div className="bl-dialog-browser-header">
                <button
                  type="button"
                  className="bl-dialog-icon-button"
                  disabled={listingBusy || busy || !listing?.parent}
                  aria-label="上一级文件夹"
                  title="上一级文件夹"
                  onClick={() => {
                    if (listing?.parent) void browse(listing.parent);
                  }}
                >
                  <ArrowUp size={16} />
                </button>
                <span className="bl-dialog-browser-path" title={listing?.path}>
                  {listing?.path || '本地文件夹'}
                </span>
                {listingBusy && (
                  <Loader2 size={15} className="bl-dialog-spinner" aria-label="正在读取文件夹" />
                )}
              </div>
              {listingError && (
                <div className="bl-dialog-browser-error" role="alert">
                  <span>{listingError}</span>
                  <button
                    type="button"
                    disabled={listingBusy || busy}
                    onClick={() => void browse()}
                  >
                    返回默认目录
                  </button>
                </div>
              )}
              <div className="bl-dialog-directory-list">
                {!listingBusy && !listingError && listing?.directories.length === 0 && (
                  <div className="bl-dialog-browser-empty">
                    <Folder size={22} />
                    <span>这里没有子文件夹</span>
                  </div>
                )}
                {listing?.directories.map((directory) => (
                  <button
                    key={directory.path}
                    type="button"
                    className="bl-dialog-directory"
                    disabled={listingBusy || busy}
                    onClick={() => void browse(directory.path)}
                  >
                    {directory.isRepository ? (
                      <FolderGit2 size={17} className="bl-dialog-repo-folder" />
                    ) : (
                      <Folder size={17} />
                    )}
                    <span>{directory.name}</span>
                    {directory.isRepository && <small>Git 仓库</small>}
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
              <div className="bl-dialog-browser-footer">
                <span>点击文件夹进入，选择后使用路径</span>
                <button
                  type="button"
                  className="bl-dialog-use-folder"
                  disabled={!listing || listingBusy || busy || !!listingError}
                  onClick={() => {
                    if (listing) {
                      setPath(listing.path);
                      setBrowserOpen(false);
                    }
                  }}
                >
                  <Check size={14} />
                  选择此文件夹
                </button>
              </div>
            </section>
          )}
          {mode === 'init' && (
            <div className="bl-dialog-note">
              <GitBranch size={16} />
              <span>初始化后，可以在「工作区」中暂存文件并创建第一次提交。</span>
            </div>
          )}
          {error && (
            <p className="bl-dialog-error" role="alert">
              {error}
            </p>
          )}
          {busy && mode === 'clone' && (
            <p className="bl-dialog-field-hint" role="status">
              正在克隆仓库，所需时间取决于仓库大小和网络速度…
            </p>
          )}
        </div>
        <footer className="bl-dialog-footer">
          <button type="button" className="bl-dialog-button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            className="bl-dialog-button bl-dialog-primary"
            disabled={busy || listingBusy}
          >
            {busy ? <Loader2 size={15} className="bl-dialog-spinner" /> : <ArrowRight size={15} />}
            {busy ? '正在处理…' : copy.submit}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export interface DialogField {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  defaultValue?: string;
}

export function ActionDialog({
  title,
  description,
  fields,
  submitLabel = '确认',
  danger = false,
  onClose,
  onSubmit,
}: {
  title: string;
  description?: string;
  fields: DialogField[];
  submitLabel?: string;
  danger?: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.defaultValue ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const missing = fields.find((field) => field.required && !values[field.name]?.trim());
    if (missing) {
      setError(`请填写${missing.label}。`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(values);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试。');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      description={description}
      icon={<GitBranch size={22} />}
      busy={busy}
      onClose={onClose}
      className={danger ? 'bl-dialog-danger' : ''}
    >
      <form onSubmit={submit} className="bl-dialog-form">
        {(fields.length > 0 || error) && (
          <div className="bl-dialog-body">
            {fields.map((field, index) => (
              <div className="bl-dialog-field" key={field.name}>
                <label htmlFor={`${id}-${field.name}`}>
                  {field.label}
                  {field.required && (
                    <>
                      {' '}
                      <span aria-hidden="true">*</span>
                    </>
                  )}
                </label>
                {field.multiline ? (
                  <textarea
                    id={`${id}-${field.name}`}
                    className="bl-dialog-input bl-dialog-textarea"
                    value={values[field.name] ?? ''}
                    onChange={(event) =>
                      setValues((previous) => ({ ...previous, [field.name]: event.target.value }))
                    }
                    placeholder={field.placeholder}
                    required={field.required}
                    disabled={busy}
                    rows={4}
                    data-autofocus={index === 0 ? true : undefined}
                  />
                ) : (
                  <input
                    id={`${id}-${field.name}`}
                    className="bl-dialog-input"
                    value={values[field.name] ?? ''}
                    onChange={(event) =>
                      setValues((previous) => ({ ...previous, [field.name]: event.target.value }))
                    }
                    placeholder={field.placeholder}
                    required={field.required}
                    disabled={busy}
                    autoComplete="off"
                    spellCheck={false}
                    data-autofocus={index === 0 ? true : undefined}
                  />
                )}
              </div>
            ))}
            {error && (
              <p className="bl-dialog-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
        <footer className="bl-dialog-footer">
          <button
            type="button"
            className="bl-dialog-button"
            onClick={onClose}
            disabled={busy}
            data-autofocus={fields.length === 0 && danger ? true : undefined}
          >
            取消
          </button>
          <button
            type="submit"
            className={`bl-dialog-button ${danger ? 'bl-dialog-destructive' : 'bl-dialog-primary'}`}
            disabled={busy}
          >
            {busy && <Loader2 size={15} className="bl-dialog-spinner" />}
            {busy ? '正在执行…' : submitLabel}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="让 Git 操作更直观"
      description="从第一次提交，到和团队同步代码。"
      icon={<GitBranch size={23} />}
      onClose={onClose}
      className="bl-dialog-help"
    >
      <div className="bl-dialog-body">
        <div className="bl-dialog-help-section">
          <div className="bl-dialog-help-icon">
            <FolderGit2 size={20} />
          </div>
          <div>
            <h3>01 · 打开你的仓库</h3>
            <p>连接已有本地仓库、新建仓库，或通过 HTTPS / SSH 克隆远程项目。</p>
          </div>
        </div>
        <div className="bl-dialog-help-section">
          <div className="bl-dialog-help-icon">
            <GitCommitHorizontal size={20} />
          </div>
          <div>
            <h3>02 · 检查、暂存、提交</h3>
            <p>
              在工作区查看文件差异，选择需要暂存的文件，填写提交信息，把一个完整的改动保存到历史。
            </p>
          </div>
        </div>
        <div className="bl-dialog-help-section">
          <div className="bl-dialog-help-icon">
            <GitBranch size={20} />
          </div>
          <div>
            <h3>03 · 用分支组织开发</h3>
            <p>查看提交图谱，创建和切换分支，管理标签与储藏。开始合并前，先提交或储藏当前改动。</p>
          </div>
        </div>
        <div className="bl-dialog-help-section">
          <div className="bl-dialog-help-icon">
            <GitPullRequest size={20} />
          </div>
          <div>
            <h3>04 · 同步远程进度</h3>
            <p>
              「获取」更新远程信息，「拉取」快进到远程提交，「推送」发布本地提交。远程操作沿用本机
              Git 的身份和凭据。
            </p>
          </div>
        </div>
        <div className="bl-dialog-help-keyboard">
          <div>
            <Keyboard size={16} />
            <span>键盘也很顺手</span>
          </div>
          <p>
            <kbd>Tab</kbd>切换控件<span>·</span>
            <kbd>Enter</kbd>确认表单<span>·</span>
            <kbd>Esc</kbd>关闭弹窗
          </p>
        </div>
        <p className="bl-dialog-help-footnote">
          Branchlet 通过本机 Git
          执行操作。遇到合并冲突时，可在编辑器中解决冲突，再回到工作区暂存并提交。
        </p>
        <div className="help-document-links">
          <a href="/help/GETTING-STARTED.zh-CN.md" target="_blank" rel="noreferrer">
            中文安装与使用指南 ↗
          </a>
          <a href="/help/GETTING-STARTED.en.md" target="_blank" rel="noreferrer">
            English getting started ↗
          </a>
          <a href="/help/RELEASING.zh-CN.md" target="_blank" rel="noreferrer">
            Release 发布与附件上传 ↗
          </a>
          <a href="/help/RELEASING.en.md" target="_blank" rel="noreferrer">
            English release guide ↗
          </a>
        </div>
      </div>
      <footer className="bl-dialog-footer">
        <button
          type="button"
          className="bl-dialog-button bl-dialog-primary"
          onClick={onClose}
          data-autofocus
        >
          开始探索
          <ArrowRight size={15} />
        </button>
      </footer>
    </Modal>
  );
}
