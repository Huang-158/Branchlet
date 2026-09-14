import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpFromLine,
  Bell,
  BookOpen,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Cloud,
  Code2,
  Command,
  Copy,
  Ellipsis,
  File,
  FileCode2,
  FileDiff,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitCommitHorizontal,
  GitFork,
  GitMerge,
  Globe2,
  History,
  Info,
  Layers,
  LayoutDashboard,
  LoaderCircle,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  Branch,
  Commit,
  FileChange,
  GitAction,
  Repository,
  RepoSnapshot,
} from '../shared/types';
import { api, getRepos, getSnapshot, runAction } from './api';
import { ActionDialog, HelpDialog, RepositoryDialog } from './components/Dialogs';
import { CommitGraph, DiffViewer } from './components/GitVisuals';
import { RepositoryFiles } from './components/RepositoryFiles';
import { ReleasesPanel } from './components/ReleasesPanel';
import './components/dialogs.css';
import './components/git-visuals.css';

type Page =
  | 'overview'
  | 'files'
  | 'changes'
  | 'history'
  | 'branches'
  | 'stashes'
  | 'tags'
  | 'releases'
  | 'remotes'
  | 'settings';
type Dialog = {
  title: string;
  description?: string;
  fields: {
    name: string;
    label: string;
    placeholder?: string;
    required?: boolean;
    multiline?: boolean;
    defaultValue?: string;
  }[];
  submitLabel?: string;
  danger?: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void>;
};
type Notice = { id: number; message: string; error?: boolean; time: string };
const navItems: { id: Page; label: string; icon: typeof GitBranch }[] = [
  { id: 'overview', label: '仓库概览', icon: LayoutDashboard },
  { id: 'files', label: '仓库文件', icon: FolderTree },
  { id: 'changes', label: '工作区更改', icon: FileDiff },
  { id: 'history', label: '提交历史', icon: History },
  { id: 'branches', label: '分支管理', icon: GitBranch },
  { id: 'stashes', label: '储藏区', icon: Layers },
  { id: 'tags', label: '标签', icon: Tag },
  { id: 'releases', label: 'GitHub Releases', icon: Rocket },
  { id: 'remotes', label: '远程仓库', icon: Cloud },
];
const actionLabels: Record<string, string> = {
  stage: '文件已暂存',
  unstage: '文件已取消暂存',
  discard: '已丢弃所选更改',
  commit: '提交成功',
  fetch: '已获取远程更新',
  pull: '拉取完成',
  push: '推送完成',
  'branch-create': '分支已创建',
  'branch-switch': '分支已切换',
  'branch-delete': '分支已删除',
  merge: '合并完成',
  'stash-save': '工作区已储藏',
  'stash-apply': '储藏已应用',
  'stash-pop': '储藏已弹出',
  'stash-drop': '储藏已删除',
  'tag-create': '标签已创建',
  'tag-delete': '标签已删除',
  'tag-push': '标签已推送到远程',
  'remote-add': '远程仓库已添加',
  'remote-remove': '远程仓库已移除',
  'cherry-pick': '提交已拣选',
  revert: '已创建撤销提交',
};
function relative(date?: string) {
  if (!date) return '最近';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 60_000) return '刚刚';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  if (ms < 604_800_000) return `${Math.floor(ms / 86_400_000)} 天前`;
  return new Date(date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
function uniqueFiles(snapshot: RepoSnapshot) {
  return [
    ...new Map(
      [
        ...snapshot.status.staged,
        ...snapshot.status.unstaged,
        ...snapshot.status.untracked,
        ...snapshot.status.conflicted,
      ].map((f) => [f.path, f]),
    ).values(),
  ];
}
function FileIcon({ path }: { path: string }) {
  return /\.(tsx?|jsx?|css|html|json|vue)$/.test(path) ? (
    <FileCode2 size={16} />
  ) : (
    <File size={16} />
  );
}
function Empty({
  icon: Icon = Box,
  title,
  description,
  children,
}: {
  icon?: typeof Box;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={27} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = '',
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      className={`button ${primary ? 'primary' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [activeId, setActiveId] = useState(localStorage.getItem('branchlet.repo') || '');
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [page, setPage] = useState<Page>('overview');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [repoDialog, setRepoDialog] = useState<'open' | 'init' | 'clone' | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [help, setHelp] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<Notice | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [showNotices, setShowNotices] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('branchlet.theme') || 'light');
  const [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ file: FileChange; staged: boolean } | null>(
    null,
  );
  const [diff, setDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitDetail, setCommitDetail] = useState<{
    commit: Commit;
    files: FileChange[];
    diff: string;
  } | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [filter, setFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState<'all' | 'local' | 'remote'>('all');
  const [identity, setIdentity] = useState({ name: '', email: '' });
  const [identityReady, setIdentityReady] = useState(false);
  const requestId = useRef(0);
  const lock = useRef(false);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const activeRepo = repos.find((repo) => repo.id === activeId);
  const searchRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string, error = false) => {
    const notice = {
      id: Date.now(),
      message,
      error,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    };
    setToast(notice);
    setNotices((old) => [notice, ...old].slice(0, 30));
  }, []);
  const refresh = useCallback(async (id = activeRef.current) => {
    if (!id || id !== activeRef.current) return;
    const seq = ++requestId.current;
    try {
      const data = await getSnapshot(id);
      if (seq === requestId.current && id === activeRef.current) {
        setSnapshot(data);
        setSnapshotRevision((value) => value + 1);
        setLoadError('');
      }
    } catch (e) {
      if (seq === requestId.current && id === activeRef.current) setLoadError((e as Error).message);
    } finally {
      if (seq === requestId.current && id === activeRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    getRepos()
      .then((data) => {
        setRepos(data);
        setActiveId((old) => (data.some((r) => r.id === old) ? old : data[0]?.id || ''));
        if (!data.length) setLoading(false);
      })
      .catch((e) => {
        setLoadError(e.message);
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    requestId.current++;
    setLoading(!!activeId);
    setSnapshot(null);
    setLoadError('');
    setSelectedFile(null);
    setSelectedCommit(null);
    setCommitDetail(null);
    setCommitMessage('');
    setFilter('');
    if (!activeId) {
      localStorage.removeItem('branchlet.repo');
      return;
    }
    localStorage.setItem('branchlet.repo', activeId);
    void refresh(activeId);
  }, [activeId, refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('branchlet.theme', theme);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 8500 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((old) => !old);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setShowNotices(false);
        setSidebarOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        void refresh();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [refresh]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
    else setSearch('');
  }, [searchOpen]);
  useEffect(() => {
    let live = true;
    if (!selectedFile || !activeId) {
      setDiff('');
      return;
    }
    setDiffLoading(true);
    api<{ diff: string }>(
      `/repos/${activeId}/diff?path=${encodeURIComponent(selectedFile.file.path)}&staged=${selectedFile.staged}`,
    )
      .then((data) => {
        if (live) setDiff(data.diff);
      })
      .catch((e) => {
        if (live) {
          setDiff('');
          notify(e.message, true);
        }
      })
      .finally(() => {
        if (live) setDiffLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selectedFile, activeId, snapshot, notify]);
  useEffect(() => {
    let live = true;
    if (!selectedCommit || !activeId) {
      setCommitDetail(null);
      return;
    }
    setDiffLoading(true);
    setCommitDetail(null);
    api<{ commit: Commit; files: FileChange[]; diff: string }>(
      `/repos/${activeId}/commit/${selectedCommit.hash}`,
    )
      .then((data) => {
        if (live) setCommitDetail(data);
      })
      .catch((e) => {
        if (live) notify(e.message, true);
      })
      .finally(() => {
        if (live) setDiffLoading(false);
      });
    return () => {
      live = false;
    };
  }, [selectedCommit, activeId, notify]);
  useEffect(() => {
    let live = true;
    if (page !== 'settings' || !activeId) return;
    setIdentityReady(false);
    api<{ name: string; email: string }>(`/repos/${activeId}/config`)
      .then((data) => {
        if (live) {
          setIdentity(data);
          setIdentityReady(true);
        }
      })
      .catch((e) => {
        if (live) notify(e.message, true);
      });
    return () => {
      live = false;
    };
  }, [page, activeId, notify]);

  async function execute(action: GitAction) {
    if (lock.current) throw new Error('请等待当前 Git 操作完成');
    lock.current = true;
    setBusy(action.action);
    const id = activeRef.current;
    try {
      await runAction(id, action);
      notify(
        actionLabels[action.action] ||
          (action.action.endsWith('-abort')
            ? '已中止当前操作'
            : action.action.endsWith('-continue')
              ? '已继续并完成当前操作'
              : '操作成功'),
      );
      if (id === activeRef.current) {
        if (action.action === 'commit') {
          setCommitMessage('');
          setSelectedFile(null);
        } else if (['stage', 'unstage'].includes(action.action)) {
          setSelectedFile((old) =>
            old && action.files?.includes(old.file.path)
              ? { ...old, staged: action.action === 'stage' }
              : old,
          );
        } else if (
          [
            'discard',
            'branch-switch',
            'branch-create',
            'stash-save',
            'stash-pop',
            'stash-apply',
          ].includes(action.action)
        ) {
          setSelectedFile(null);
        }
      }
    } catch (e) {
      notify((e as Error).message, true);
      throw e;
    } finally {
      await refresh(id);
      lock.current = false;
      setBusy('');
    }
  }
  function perform(action: GitAction) {
    void execute(action).catch(() => {});
  }
  function go(next: Page) {
    setPage(next);
    setFilter('');
    setSidebarOpen(false);
  }
  async function added(repo: Repository) {
    setRepos((previous) => {
      const exists = previous.some((item) => item.id === repo.id);
      return exists
        ? previous.map((item) => (item.id === repo.id ? repo : item))
        : [...previous, repo];
    });
    setActiveId(repo.id);
    if (repo.id === activeRef.current) await refresh(repo.id);
    setRepoDialog(null);
    setPage('overview');
    notify(`已打开 ${repo.name}`);
  }
  function removeRepository(repo: Repository) {
    setDialog({
      title: repo.isDemo ? '移除示例仓库' : '移除仓库',
      description: `将「${repo.name}」从仓库列表中移除，本地文件和 Git 历史会保留。${repo.isDemo ? '移除后，重启应用也不会自动添加此示例。' : '需要时可以通过原路径重新打开。'}`,
      fields: [],
      submitLabel: '确认移除',
      danger: true,
      onSubmit: async () => {
        if (lock.current) throw new Error('请等待当前 Git 操作完成');
        lock.current = true;
        setBusy('repo-remove');
        try {
          const remaining = await api<Repository[]>(`/repos/${repo.id}/remove`, {
            method: 'POST',
            body: '{}',
          });
          setRepos(remaining);
          if (activeRef.current === repo.id) {
            requestId.current++;
            const nextId = remaining[0]?.id || '';
            activeRef.current = nextId;
            setActiveId(nextId);
            setSnapshot(null);
            setPage('overview');
          }
          notify(
            repo.isDemo
              ? '示例仓库已移除，重启后不会自动添加'
              : `已移除 ${repo.name}，本地文件已保留`,
          );
        } finally {
          lock.current = false;
          setBusy('');
        }
      },
    });
  }
  function confirm(title: string, description: string, action: GitAction, danger = false) {
    setDialog({
      title,
      description,
      fields: [],
      submitLabel: danger ? '确认操作' : '确认',
      danger,
      onSubmit: async () => {
        await execute(action);
        setDialog(null);
      },
    });
  }
  function newBranch() {
    setDialog({
      title: '创建新分支',
      description: `从 ${snapshot?.status.branch || '当前 HEAD'} 开始，让新的想法拥有自己的空间。`,
      fields: [
        { name: 'name', label: '分支名称', placeholder: 'feature/my-new-idea', required: true },
      ],
      submitLabel: '创建分支',
      onSubmit: async (v) => {
        await execute({ action: 'branch-create', name: v.name });
        setDialog(null);
      },
    });
  }
  function saveStash() {
    setDialog({
      title: '储藏工作区',
      description: '保存已跟踪文件和未跟踪文件的更改，并将工作区还原为当前提交。',
      fields: [{ name: 'message', label: '储藏说明', placeholder: '例如：暂存正在进行的导航重构' }],
      submitLabel: '储藏更改',
      onSubmit: async (v) => {
        await execute({ action: 'stash-save', message: v.message, includeUntracked: true });
        setSelectedFile(null);
        setDialog(null);
      },
    });
  }
  function newTag() {
    setDialog({
      title: '创建标签',
      description: '在当前提交上创建版本标记，方便随时回到这个里程碑。',
      fields: [
        { name: 'name', label: '标签名称', placeholder: 'v1.1.0', required: true },
        {
          name: 'message',
          label: '标签说明（可选）',
          placeholder: '这个版本带来了什么？',
          multiline: true,
        },
      ],
      submitLabel: '创建标签',
      onSubmit: async (v) => {
        await execute({ action: 'tag-create', name: v.name, message: v.message });
        setDialog(null);
      },
    });
  }
  function newRemote() {
    setDialog({
      title: '添加远程仓库',
      description: '连接 GitHub、GitLab 或其他 Git 服务上的仓库。',
      fields: [
        { name: 'name', label: '远程名称', placeholder: 'origin', required: true },
        {
          name: 'url',
          label: '仓库地址',
          placeholder: 'https://github.com/username/repository.git',
          required: true,
        },
      ],
      submitLabel: '添加远程',
      onSubmit: async (v) => {
        await execute({ action: 'remote-add', name: v.name, url: v.url });
        setDialog(null);
      },
    });
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify('已复制到剪贴板');
    } catch {
      notify('当前浏览器无法访问剪贴板', true);
    }
  }
  const changed = snapshot ? uniqueFiles(snapshot) : [];
  const currentTitle = navItems.find((n) => n.id === page)?.label || '仓库设置';
  const localBranches = snapshot?.branches.filter((b) => !b.remote) || [];
  const operation = snapshot?.status.operation;
  const operationName = operation
    ? { merge: '合并', 'cherry-pick': '拣选', revert: '撤销', rebase: '变基' }[operation]
    : '';
  const defaultRemote =
    snapshot?.remotes.find((r) => r.name === (snapshot.status.upstream?.split('/')[0] || 'origin'))
      ?.name ||
    snapshot?.remotes.find((r) => r.name === 'origin')?.name ||
    snapshot?.remotes[0]?.name;
  const isClean = snapshot?.status.clean;
  const matchingCommits =
    snapshot?.commits.filter((c) =>
      `${c.subject} ${c.hash} ${c.author}`.toLowerCase().includes(filter.toLowerCase()),
    ) || [];
  const fileRows = (files: FileChange[], staged: boolean) =>
    files
      .filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
      .map((file) => (
        <div
          className={`file-row ${selectedFile?.file.path === file.path && selectedFile.staged === staged ? 'selected' : ''}`}
          key={`${staged}-${file.path}`}
        >
          <button className="file-select" onClick={() => setSelectedFile({ file, staged })}>
            <span
              className={`file-type ${file.status === 'A' || file.status === '?' ? 'added' : ''}`}
            >
              <FileIcon path={file.path} />
            </span>
            <span className="file-path" title={file.path}>
              {file.path.split('/').pop()}
              <small>
                {file.path.includes('/')
                  ? file.path.slice(0, file.path.lastIndexOf('/')) + '/'
                  : '根目录'}
              </small>
            </span>
            <span className={`status-letter status-${file.status}`}>
              {file.status === '?' ? 'U' : file.status}
            </span>
          </button>
          <button
            className="icon-button small"
            title={staged ? '取消暂存' : '暂存文件'}
            aria-label={`${staged ? '取消暂存' : '暂存'} ${file.path}`}
            disabled={!!busy}
            onClick={() => perform({ action: staged ? 'unstage' : 'stage', files: [file.path] })}
          >
            {staged ? <Undo2 size={14} /> : <Plus size={15} />}
          </button>
          {!staged && (
            <button
              className="icon-button small danger-hover"
              title="丢弃更改"
              aria-label={`丢弃 ${file.path}`}
              disabled={!!busy}
              onClick={() =>
                confirm(
                  '丢弃文件更改',
                  `将丢弃 ${file.path} 中的未提交更改。未跟踪文件将被删除，此操作无法撤销。`,
                  { action: 'discard', files: [file.path] },
                  true,
                )
              }
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ));

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go('overview');
          }}
        >
          <span className="brand-symbol">
            <GitFork size={23} />
          </span>
          <span>
            Branchlet<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">
          个人工作空间 <span>LOCAL</span>
        </div>
        <div className="repo-switcher">
          <div className="repo-symbol">
            <FolderGit2 size={21} />
          </div>
          <div className="repo-switch-text">
            <strong>{snapshot?.repo.name || '选择仓库'}</strong>
            <span>{snapshot?.repo.isDemo ? '示例项目 · 本地仓库' : '本地 Git 仓库'}</span>
          </div>
          <button
            className="icon-button small"
            title="打开其他仓库"
            onClick={() => setRepoDialog('open')}
          >
            <ChevronDown size={15} />
          </button>
        </div>
        <div className="nav-section-label">工作台</div>
        <nav aria-label="主导航">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => go(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === 'changes' && changed.length > 0 && (
                <span className="nav-count">{changed.length}</span>
              )}
              {id === 'stashes' && (snapshot?.stashes.length || 0) > 0 && (
                <span className="nav-count neutral">{snapshot?.stashes.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-section-label repositories-label">
          仓库{' '}
          <button
            className="icon-button small"
            title="添加仓库"
            onClick={() => setRepoDialog('open')}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="repo-list">
          {repos.map((repo) => (
            <div
              className={`repo-list-row ${repo.id === activeId ? 'selected' : ''}`}
              key={repo.id}
            >
              <button
                className="repo-list-item"
                title={repo.path}
                aria-current={repo.id === activeId ? 'true' : undefined}
                onClick={() => setActiveId(repo.id)}
              >
                <span className={`repo-dot ${repo.id === activeId ? 'on' : ''}`} />
                <span>{repo.name}</span>
                {repo.isDemo && <span className="demo-mini">示例</span>}
              </button>
              <button
                className="repo-remove"
                title={repo.isDemo ? '移除示例仓库' : `移除仓库 ${repo.name}`}
                aria-label={repo.isDemo ? '移除示例仓库' : `移除仓库 ${repo.name}`}
                disabled={!!busy}
                onClick={() => removeRepository(repo)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button className="add-repo" onClick={() => setRepoDialog('open')}>
            <Plus size={15} />
            添加本地仓库
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-status-dot" />
            <div>
              <strong>你的代码，留在本地</strong>
              <p>直接连接本机 Git，安心创作。</p>
            </div>
            <ShieldCheck size={19} />
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => go('settings')}
          >
            <Settings2 size={18} />
            <span>设置</span>
          </button>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <BookOpen size={18} />
            <span>帮助与快捷键</span>
            <span className="shortcut">?</span>
          </button>
          <div className="profile">
            <span className="profile-avatar">L</span>
            <div>
              <strong>本地开发者</strong>
              <span>Personal workspace</span>
            </div>
            <span className="version">v1.0</span>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开导航"
            >
              <Menu size={20} />
            </button>
            <Folder size={16} />
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>{snapshot?.repo.name || 'Branchlet'}</strong>
          </div>
          <div className="topbar-tools">
            <button
              className="search-trigger"
              aria-label="搜索提交、分支和操作"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={15} />
              <span>搜索提交、分支、操作…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="topbar-divider" />
            <button
              className="icon-button"
              title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <div className="notice-anchor">
              <button
                className="icon-button"
                title="操作记录"
                onClick={() => setShowNotices(!showNotices)}
              >
                <Bell size={18} />
                {notices.length > 0 && <span className="notification-dot" />}
              </button>
              {showNotices && (
                <div className="notice-popover">
                  <h3>
                    操作记录 <span>{notices.length}</span>
                  </h3>
                  {notices.length ? (
                    notices.map((n) => (
                      <div className={`notice-item ${n.error ? 'error' : ''}`} key={n.id}>
                        {n.error ? <Info size={16} /> : <CheckCheck size={16} />}
                        <p>
                          {n.message}
                          <small>{n.time}</small>
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="muted">还没有操作记录，开始一次新的改变吧。</p>
                  )}
                </div>
              )}
            </div>
            <span className="top-avatar">L</span>
          </div>
        </header>
        {busy && <div className="operation-progress" />}
        <main className="main-content">
          <div className="page-heading">
            <div className="eyebrow">
              <span className="green-dot" />{' '}
              {snapshot?.repo.isDemo ? 'EXAMPLE REPOSITORY' : 'YOUR LOCAL REPOSITORY'}
            </div>
            <div className="heading-line">
              <div>
                <h1>{page === 'overview' ? '每一次改变，都清晰可见。' : currentTitle}</h1>
                <p>
                  {page === 'overview'
                    ? '从灵感到提交，专注于创造。这里是你的代码全景。'
                    : {
                        changes: '审阅每一行改动，将想法整理成一次有意义的提交。',
                        files: '从文件夹到每一行代码，用你习惯的方式浏览整个仓库。',
                        releases: '创建版本发布、上传构建附件，把你的作品交付给使用者。',
                        history: '沿着时间与分支，回顾项目的每一步演进。',
                        branches: '让不同的想法并行生长，在合适的时候汇合。',
                        stashes: '暂时收起未完成的灵感，随时回来继续。',
                        tags: '标记重要的里程碑，让每个版本都有迹可循。',
                        remotes: '连接远方的协作，让本地与团队保持同步。',
                        settings: '把工作台调整成你习惯的样子。',
                      }[page]}
                </p>
              </div>
              <div className="heading-actions">
                <Button
                  onClick={() => {
                    setLoading(true);
                    void refresh();
                  }}
                  disabled={!activeId || !!busy}
                  title="刷新仓库 · Ctrl R"
                >
                  <RefreshCw size={15} className={loading ? 'spin' : ''} />
                  刷新
                </Button>
                <Button onClick={() => setRepoDialog('open')} primary>
                  <Plus size={16} />
                  打开仓库
                </Button>
              </div>
            </div>
          </div>
          {loadError && (
            <div className="error-banner">
              <Info size={18} />
              <div>
                <strong>无法读取仓库</strong>
                <p>{loadError}</p>
              </div>
              <Button
                onClick={() => {
                  if (activeId) void refresh();
                  else window.location.reload();
                }}
              >
                重试
              </Button>
            </div>
          )}
          {loading && !snapshot ? (
            <div className="loading-view">
              <LoaderCircle className="spin" size={28} />
              <h3>正在连接你的代码世界</h3>
              <p>读取本地仓库与提交记录…</p>
            </div>
          ) : !snapshot ? (
            <div className="panel">
              {activeRepo && loadError ? (
                <Empty
                  icon={Info}
                  title="仓库已打开，但暂时无法读取"
                  description={`当前目录：${activeRepo.path}。请检查上方错误及所选路径。`}
                >
                  <div className="inline-actions">
                    <Button onClick={() => setRepoDialog('open')} primary>
                      选择其他仓库
                    </Button>
                    <Button onClick={() => removeRepository(activeRepo)} disabled={!!busy}>
                      移除此仓库
                    </Button>
                  </div>
                </Empty>
              ) : (
                <Empty
                  icon={FolderGit2}
                  title="从一个仓库开始"
                  description="打开已有项目，或新建你的第一个 Git 仓库。"
                >
                  <div className="inline-actions">
                    <Button onClick={() => setRepoDialog('open')} primary>
                      打开仓库
                    </Button>
                    <Button onClick={() => setRepoDialog('init')}>新建仓库</Button>
                    <Button onClick={() => setRepoDialog('clone')}>克隆仓库</Button>
                  </div>
                </Empty>
              )}
            </div>
          ) : (
            <>
              <section className="repo-toolbar">
                <div className="repo-path">
                  <FolderGit2 size={18} />
                  <strong>{snapshot.repo.name}</strong>
                  <span className="toolbar-slash">/</span>
                  <code title={snapshot.repo.path}>{snapshot.repo.path.replace(/\\/g, '/')}</code>
                  <button
                    className="icon-button small"
                    title="复制仓库路径"
                    onClick={() => void copy(snapshot.repo.path)}
                  >
                    <Copy size={13} />
                  </button>
                </div>
                <div className="repo-actions">
                  <div className="branch-select">
                    <GitBranch size={15} />
                    <select
                      aria-label="切换分支"
                      value={snapshot.status.branch}
                      disabled={!!busy}
                      onChange={(e) => perform({ action: 'branch-switch', name: e.target.value })}
                    >
                      {!localBranches.some((b) => b.name === snapshot.status.branch) && (
                        <option value={snapshot.status.branch}>
                          {snapshot.status.branch || 'HEAD'}
                        </option>
                      )}
                      {localBranches.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} />
                  </div>
                  <span className="toolbar-divider" />
                  <Button
                    onClick={() => perform({ action: 'fetch' })}
                    disabled={!!busy || !snapshot.remotes.length}
                    title="获取远程引用"
                  >
                    <RefreshCw size={14} />
                    获取
                  </Button>
                  <Button
                    onClick={() => perform({ action: 'pull' })}
                    disabled={!!busy || !snapshot.remotes.length}
                    title="以 fast-forward 方式拉取更新"
                  >
                    <ArrowDownToLine size={14} />
                    拉取
                    {snapshot.status.behind > 0 && (
                      <span className="button-count">{snapshot.status.behind}</span>
                    )}
                  </Button>
                  <Button
                    onClick={() =>
                      confirm(
                        '推送到远程',
                        `将分支 ${snapshot.status.branch} 的本地提交推送到 ${defaultRemote || 'origin'}。`,
                        { action: 'push', remote: defaultRemote },
                      )
                    }
                    disabled={!!busy || !snapshot.remotes.length}
                  >
                    <ArrowUpFromLine size={14} />
                    推送
                    {snapshot.status.ahead > 0 && (
                      <span className="button-count">{snapshot.status.ahead}</span>
                    )}
                  </Button>
                </div>
              </section>

              {operation && (
                <div className="operation-banner">
                  <GitMerge size={20} />
                  <div>
                    <strong>{operationName}进行中</strong>
                    <p>
                      {snapshot.status.conflicted.length
                        ? `还有 ${snapshot.status.conflicted.length} 个冲突文件，请在编辑器中解决后暂存。`
                        : '解决的文件暂存后，点击继续完成此操作。'}
                    </p>
                  </div>
                  <div className="inline-actions">
                    <Button onClick={() => go('changes')}>查看工作区</Button>
                    <Button
                      disabled={!!busy}
                      onClick={() =>
                        confirm(
                          `中止${operationName}`,
                          `中止当前${operationName}并恢复到操作开始前的状态。本次冲突处理中的修改可能被撤销。`,
                          { action: `${operation}-abort` },
                          true,
                        )
                      }
                    >
                      中止操作
                    </Button>
                    <Button
                      primary
                      disabled={!!busy || snapshot.status.conflicted.length > 0}
                      onClick={() => perform({ action: `${operation}-continue` })}
                    >
                      <Check size={15} />
                      继续{operationName}
                    </Button>
                  </div>
                </div>
              )}
              {page === 'files' && (
                <RepositoryFiles
                  key={activeId}
                  repoId={activeId}
                  refreshKey={snapshotRevision}
                  onNotice={notify}
                />
              )}
              {page === 'releases' && (
                <ReleasesPanel key={activeId} repoId={activeId} onNotice={notify} />
              )}
              {page === 'overview' && (
                <>
                  <section className="stat-grid">
                    <button className="stat-card" onClick={() => go('changes')}>
                      <div className="stat-top">
                        <span>工作区更改</span>
                        <span className="stat-icon amber">
                          <FileDiff size={17} />
                        </span>
                      </div>
                      <div className="stat-value">
                        {changed.length}
                        <span>个文件</span>
                        <div className="mini-bars amber-bars">
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                      </div>
                      <div className="stat-bottom">
                        <span className={`tiny-dot ${isClean ? 'green' : 'amber-dot'}`} />
                        {isClean
                          ? '工作区干净，随时开始'
                          : `${snapshot.status.staged.length} 个已暂存 · ${new Set([...snapshot.status.unstaged, ...snapshot.status.untracked].map((f) => f.path)).size} 个未暂存`}
                      </div>
                    </button>
                    <button className="stat-card" onClick={() => go('history')}>
                      <div className="stat-top">
                        <span>提交记录</span>
                        <span className="stat-icon green-bg">
                          <GitCommitHorizontal size={18} />
                        </span>
                      </div>
                      <div className="stat-value">
                        {snapshot.totalCommits}
                        <span>次提交</span>
                        <svg className="stat-spark" viewBox="0 0 100 32">
                          <path d="M0 29 L15 24 L28 25 L42 15 L55 19 L70 8 L83 12 L100 2" />
                        </svg>
                      </div>
                      <div className="stat-bottom">
                        {snapshot.commits.length
                          ? '最近提交于 ' + relative(snapshot.commits[0]?.date)
                          : '等待第一次提交'}
                      </div>
                    </button>
                    <button className="stat-card" onClick={() => go('branches')}>
                      <div className="stat-top">
                        <span>活跃分支</span>
                        <span className="stat-icon purple">
                          <GitBranch size={17} />
                        </span>
                      </div>
                      <div className="stat-value">
                        {localBranches.length}
                        <span>个本地分支</span>
                        <GitFork className="stat-branch-art" size={42} strokeWidth={1.3} />
                      </div>
                      <div className="stat-bottom">
                        <span className="tiny-dot purple-dot" />
                        当前位于 <code>{snapshot.status.branch}</code>
                      </div>
                    </button>
                    <button className="stat-card" onClick={() => go('remotes')}>
                      <div className="stat-top">
                        <span>远程同步</span>
                        <span className="stat-icon blue">
                          <ArrowLeftRight size={17} />
                        </span>
                      </div>
                      <div className="sync-values">
                        <span>
                          <ArrowUp size={19} />
                          <strong>{snapshot.status.ahead}</strong>
                          <small>待推送</small>
                        </span>
                        <span className="sync-divider" />
                        <span>
                          <ArrowDown size={19} />
                          <strong>{snapshot.status.behind}</strong>
                          <small>待拉取</small>
                        </span>
                      </div>
                      <div className="stat-bottom">
                        <span className="tiny-dot green" />
                        {snapshot.status.upstream
                          ? `跟踪 ${snapshot.status.upstream}`
                          : '尚未设置上游分支'}
                      </div>
                    </button>
                  </section>
                  <div className="overview-grid">
                    <section className="panel history-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="heading-icon">
                            <GitCommitHorizontal size={18} />
                          </span>
                          <h2>最近提交</h2>
                          <span className="subtle-badge">{snapshot.totalCommits}</span>
                        </div>
                        <button className="text-button muted-button" onClick={() => go('history')}>
                          查看全部
                          <ArrowRight size={14} />
                        </button>
                      </div>
                      <div className="graph-caption">
                        <span>提交图</span>
                        <span>提交信息</span>
                        <span>版本</span>
                      </div>
                      <CommitGraph
                        commits={snapshot.commits.slice(0, 7)}
                        compact
                        onSelect={(commit) => {
                          setSelectedCommit(commit);
                          go('history');
                        }}
                      />
                      <div className="panel-foot">
                        <span>
                          <span className="tiny-dot green" />
                          提交主线
                        </span>
                        <span>
                          <span className="tiny-dot purple-dot" />
                          其他分支
                        </span>
                        <span className="graph-note">每个节点，都是一次进步</span>
                      </div>
                    </section>
                    <section className="panel overview-changes">
                      <div className="panel-heading">
                        <div>
                          <span className="heading-icon">
                            <FileDiff size={17} />
                          </span>
                          <h2>工作区</h2>
                          <span className="subtle-badge">{changed.length}</span>
                        </div>
                        <button
                          className="icon-button small"
                          title="查看工作区"
                          onClick={() => go('changes')}
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                      <div className={`workspace-status ${isClean ? 'clean' : ''}`}>
                        <span className={`tiny-dot ${isClean ? 'green' : 'amber-dot'}`} />
                        {isClean ? '所有更改均已提交' : '有新的改变，等待被记录'}
                        <span>{isClean ? <Check size={14} /> : <Sparkles size={14} />}</span>
                      </div>
                      <div className="overview-file-list">
                        {changed.length ? (
                          changed.slice(0, 5).map((file) => (
                            <button
                              className="overview-file"
                              key={file.path}
                              onClick={() => {
                                setSelectedFile({
                                  file,
                                  staged:
                                    snapshot.status.staged.some((f) => f.path === file.path) &&
                                    !snapshot.status.unstaged.some((f) => f.path === file.path),
                                });
                                go('changes');
                              }}
                            >
                              <span
                                className={`file-type ${file.status === '?' || file.status === 'A' ? 'added' : ''}`}
                              >
                                <FileIcon path={file.path} />
                              </span>
                              <span>
                                {file.path.split('/').pop()}
                                <small>
                                  {file.path.includes('/')
                                    ? file.path.slice(0, file.path.lastIndexOf('/'))
                                    : '项目根目录'}
                                </small>
                              </span>
                              <span
                                className={`file-badge ${file.status === '?' || file.status === 'A' ? 'new' : ''}`}
                              >
                                {file.status === '?'
                                  ? '未跟踪'
                                  : file.status === 'A'
                                    ? '新增'
                                    : file.status === 'D'
                                      ? '删除'
                                      : '修改'}
                              </span>
                            </button>
                          ))
                        ) : (
                          <Empty
                            icon={CheckCheck}
                            title="一切井然有序"
                            description="新的改动会显示在这里。"
                          />
                        )}
                      </div>
                      <div className="overview-commit">
                        <div className="commit-ready">
                          <span>
                            <CircleDot size={14} />
                            准备好记录这次进步了吗？
                          </span>
                          <kbd>Ctrl ↵</kbd>
                        </div>
                        <Button primary onClick={() => go('changes')}>
                          <GitCommitHorizontal size={17} />
                          查看更改并提交
                          <ArrowRight size={16} />
                        </Button>
                        <button
                          className="text-button stash-link"
                          onClick={saveStash}
                          disabled={!changed.length || !!busy}
                        >
                          <Layers size={14} />
                          暂时储藏更改
                        </button>
                      </div>
                    </section>
                  </div>
                  <section className="panel branches-overview">
                    <div className="panel-heading">
                      <div>
                        <span className="heading-icon">
                          <GitBranch size={17} />
                        </span>
                        <h2>分支动态</h2>
                      </div>
                      <button className="text-button muted-button" onClick={newBranch}>
                        <Plus size={15} />
                        新建分支
                      </button>
                    </div>
                    <div className="branch-card-grid">
                      {localBranches.slice(0, 3).map((branch, i) => (
                        <button
                          className={`branch-card branch-color-${i}`}
                          key={branch.name}
                          onClick={() => go('branches')}
                        >
                          <div className="branch-card-title">
                            <span className="branch-card-icon">
                              <GitBranch size={17} />
                            </span>
                            <strong>{branch.name}</strong>
                            {branch.current ? (
                              <span className="current-badge">当前分支</span>
                            ) : (
                              <ChevronRight size={15} />
                            )}
                          </div>
                          <p>{branch.subject || '还没有提交'}</p>
                          <div>
                            <span className="mini-avatar">
                              {(
                                snapshot.commits.find((c) => c.hash === branch.hash)?.author || 'L'
                              ).slice(0, 1)}
                            </span>
                            <span>{branch.hash.slice(0, 7)}</span>
                            <span className="branch-time">{relative(branch.date)}</span>
                          </div>
                        </button>
                      ))}
                      {!localBranches.length && (
                        <p className="muted">创建第一次提交后，这里将显示你的分支。</p>
                      )}
                    </div>
                  </section>
                  <div className="bottom-note">
                    <span>
                      <ShieldCheck size={14} />
                      本地运行 · 代码始终由你掌控
                    </span>
                    <span>
                      让改变发生，让记录清晰。<span className="leaf-mark">✳</span>
                    </span>
                  </div>
                </>
              )}

              {page === 'changes' && (
                <>
                  <div className="section-toolbar">
                    <div className="section-title">
                      <h2>所有更改</h2>
                      <span className="subtle-badge">{changed.length}</span>
                      {snapshot.status.conflicted.length > 0 && (
                        <span className="conflict-badge">
                          {snapshot.status.conflicted.length} 个冲突待解决
                        </span>
                      )}
                    </div>
                    <div className="inline-actions">
                      <label className="filter-input">
                        <Search size={15} />
                        <input
                          placeholder="筛选文件…"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                      </label>
                      <Button onClick={saveStash} disabled={!changed.length || !!busy}>
                        <Layers size={15} />
                        储藏更改
                      </Button>
                    </div>
                  </div>
                  {snapshot.status.conflicted.length > 0 && (
                    <div className="conflict-notice">
                      <Info size={17} />
                      <span>
                        请在编辑器中解决文件里的冲突标记，再暂存已解决的文件并提交。Git
                        错误详情会显示在操作记录中。
                      </span>
                    </div>
                  )}
                  <div className="changes-layout">
                    <div className="changes-left">
                      <section className="panel files-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>未暂存</h2>
                            <span className="subtle-badge">
                              {
                                new Set(
                                  [
                                    ...snapshot.status.unstaged,
                                    ...snapshot.status.untracked,
                                    ...snapshot.status.conflicted,
                                  ].map((f) => f.path),
                                ).size
                              }
                            </span>
                          </div>
                          <button
                            className="text-button"
                            disabled={
                              !!busy ||
                              !(
                                snapshot.status.unstaged.length +
                                snapshot.status.untracked.length +
                                snapshot.status.conflicted.length
                              )
                            }
                            onClick={() =>
                              perform({
                                action: 'stage',
                                files: [
                                  ...new Set(
                                    [
                                      ...snapshot.status.unstaged,
                                      ...snapshot.status.untracked,
                                      ...snapshot.status.conflicted,
                                    ].map((f) => f.path),
                                  ),
                                ],
                              })
                            }
                          >
                            <Plus size={14} />
                            全部暂存
                          </button>
                        </div>
                        {fileRows(
                          [
                            ...new Map(
                              [
                                ...snapshot.status.unstaged,
                                ...snapshot.status.untracked,
                                ...snapshot.status.conflicted,
                              ].map((f) => [f.path, f]),
                            ).values(),
                          ],
                          false,
                        )}
                        {!snapshot.status.unstaged.length &&
                          !snapshot.status.untracked.length &&
                          !snapshot.status.conflicted.length && (
                            <p className="list-empty">
                              <Check size={15} />
                              没有未暂存的更改
                            </p>
                          )}
                      </section>
                      <section className="panel files-panel">
                        <div className="panel-heading">
                          <div>
                            <h2>已暂存</h2>
                            <span className="subtle-badge green-badge">
                              {snapshot.status.staged.length}
                            </span>
                          </div>
                          <button
                            className="text-button muted-button"
                            disabled={!!busy || !snapshot.status.staged.length}
                            onClick={() =>
                              perform({
                                action: 'unstage',
                                files: snapshot.status.staged.map((f) => f.path),
                              })
                            }
                          >
                            <Undo2 size={14} />
                            全部取消
                          </button>
                        </div>
                        {fileRows(snapshot.status.staged, true)}
                        {!snapshot.status.staged.length && (
                          <p className="list-empty">点击文件右侧的 + 暂存更改</p>
                        )}
                      </section>
                      <section className="panel commit-form">
                        <div className="panel-heading">
                          <div>
                            <GitCommitHorizontal size={17} />
                            <h2>创建提交</h2>
                          </div>
                          <span className="branch-pill">
                            <GitBranch size={12} />
                            {snapshot.status.branch}
                          </span>
                        </div>
                        <label htmlFor="commit-message">提交说明</label>
                        <textarea
                          id="commit-message"
                          placeholder="为这次改变写一句说明…&#10;&#10;例如：feat: 添加用户偏好设置"
                          value={commitMessage}
                          onChange={(e) => setCommitMessage(e.target.value)}
                          onKeyDown={(e) => {
                            if (
                              (e.ctrlKey || e.metaKey) &&
                              e.key === 'Enter' &&
                              commitMessage.trim() &&
                              snapshot.status.staged.length &&
                              !busy
                            )
                              perform({ action: 'commit', message: commitMessage });
                          }}
                        />
                        <div className="commit-form-foot">
                          <span>{snapshot.status.staged.length} 个文件待提交</span>
                          <kbd>Ctrl ↵</kbd>
                        </div>
                        <Button
                          primary
                          disabled={
                            !!busy ||
                            !commitMessage.trim() ||
                            !snapshot.status.staged.length ||
                            snapshot.status.conflicted.length > 0
                          }
                          onClick={() => perform({ action: 'commit', message: commitMessage })}
                        >
                          {busy === 'commit' ? (
                            <LoaderCircle className="spin" size={16} />
                          ) : (
                            <Check size={16} />
                          )}
                          提交到 {snapshot.status.branch}
                        </Button>
                      </section>
                    </div>
                    <section className="panel changes-diff">
                      {selectedFile ? (
                        <>
                          <div className="panel-heading">
                            <div>
                              <FileIcon path={selectedFile.file.path} />
                              <h2 title={selectedFile.file.path}>{selectedFile.file.path}</h2>
                            </div>
                            <span className="subtle-badge">
                              {selectedFile.staged ? '已暂存' : '工作区'}
                            </span>
                          </div>
                          <DiffViewer
                            diff={diff}
                            filename={selectedFile.file.path}
                            loading={diffLoading}
                          />
                        </>
                      ) : (
                        <Empty
                          icon={FileDiff}
                          title="每一行改变，都值得被看见"
                          description="选择左侧文件，查看修改前后的差异。"
                        />
                      )}
                    </section>
                  </div>
                </>
              )}

              {page === 'history' && (
                <>
                  <div className="section-toolbar">
                    <div className="section-title">
                      <h2>提交时间线</h2>
                      <span className="subtle-badge">{snapshot.totalCommits}</span>
                      <span className="muted">最近 {snapshot.commits.length} 条 · 所有分支</span>
                    </div>
                    <label className="filter-input">
                      <Search size={15} />
                      <input
                        placeholder="搜索提交信息、作者或哈希…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className={`history-layout ${selectedCommit ? 'with-detail' : ''}`}>
                    <section className="panel full-history">
                      <CommitGraph
                        commits={matchingCommits}
                        selectedHash={selectedCommit?.hash}
                        onSelect={setSelectedCommit}
                      />
                    </section>
                    {selectedCommit && (
                      <section className="panel commit-detail">
                        <div className="panel-heading">
                          <div>
                            <GitCommitHorizontal size={18} />
                            <h2>提交详情</h2>
                          </div>
                          <button
                            className="icon-button small"
                            aria-label="关闭提交详情"
                            onClick={() => setSelectedCommit(null)}
                          >
                            <X size={17} />
                          </button>
                        </div>
                        <div className="commit-meta">
                          <h3>{selectedCommit.subject}</h3>
                          <div className="commit-author">
                            <span className="mini-avatar">{selectedCommit.author.slice(0, 1)}</span>
                            <strong>{selectedCommit.author}</strong>
                            <time>{new Date(selectedCommit.date).toLocaleString('zh-CN')}</time>
                          </div>
                          <button
                            className="hash-copy"
                            onClick={() => void copy(selectedCommit.hash)}
                          >
                            <code>{selectedCommit.shortHash}</code>
                            <Copy size={13} />
                          </button>
                          {selectedCommit.body && (
                            <p className="commit-body">{selectedCommit.body}</p>
                          )}
                          <div className="inline-actions">
                            <Button
                              disabled={!!busy}
                              onClick={() =>
                                confirm(
                                  '拣选提交',
                                  `将 ${selectedCommit.shortHash} 的改动应用到当前分支并创建提交。建议先提交或储藏工作区更改。`,
                                  { action: 'cherry-pick', hash: selectedCommit.hash },
                                )
                              }
                            >
                              <GitCommitHorizontal size={14} />
                              拣选
                            </Button>
                            <Button
                              disabled={!!busy}
                              onClick={() =>
                                confirm(
                                  '撤销这次提交',
                                  `创建一个新的提交来撤销 ${selectedCommit.shortHash} 的改动。现有历史会保留。`,
                                  { action: 'revert', hash: selectedCommit.hash },
                                  true,
                                )
                              }
                            >
                              <Undo2 size={14} />
                              撤销提交
                            </Button>
                          </div>
                        </div>
                        <div className="detail-files-title">
                          <FileDiff size={14} />
                          {commitDetail?.files.length || 0} 个文件变更
                        </div>
                        <DiffViewer diff={commitDetail?.diff || ''} loading={diffLoading} />
                      </section>
                    )}
                  </div>
                </>
              )}

              {page === 'branches' && (
                <>
                  <div className="section-toolbar">
                    <div className="segmented">
                      {(['all', 'local', 'remote'] as const).map((value) => (
                        <button
                          className={branchFilter === value ? 'active' : ''}
                          key={value}
                          onClick={() => setBranchFilter(value)}
                        >
                          {{ all: '全部分支', local: '本地分支', remote: '远程分支' }[value]}
                          <span>
                            {value === 'all'
                              ? snapshot.branches.length
                              : snapshot.branches.filter((b) => b.remote === (value === 'remote'))
                                  .length}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="inline-actions">
                      <label className="filter-input">
                        <Search size={15} />
                        <input
                          placeholder="搜索分支…"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                      </label>
                      <Button primary onClick={newBranch}>
                        <Plus size={15} />
                        新建分支
                      </Button>
                    </div>
                  </div>
                  <section className="panel branch-table">
                    <div className="table-header">
                      <span>分支名称</span>
                      <span>最近提交</span>
                      <span>同步状态</span>
                      <span>操作</span>
                    </div>
                    {snapshot.branches
                      .filter(
                        (b) =>
                          (branchFilter === 'all' || b.remote === (branchFilter === 'remote')) &&
                          b.name.toLowerCase().includes(filter.toLowerCase()),
                      )
                      .map((branch) => (
                        <div
                          className={`branch-table-row ${branch.current ? 'current' : ''}`}
                          key={branch.name}
                        >
                          <div className="branch-name">
                            <span className={`branch-row-icon ${branch.remote ? 'remote' : ''}`}>
                              <GitBranch size={19} />
                            </span>
                            <div>
                              <strong>{branch.name}</strong>
                              <small>
                                {branch.remote ? '远程跟踪分支' : branch.upstream || '本地分支'}
                              </small>
                            </div>
                            {branch.current && <span className="current-badge">当前</span>}
                          </div>
                          <div className="branch-last">
                            <p>{branch.subject}</p>
                            <code>{branch.hash.slice(0, 7)}</code>
                            <span>{relative(branch.date)}</span>
                          </div>
                          <div className="branch-sync">
                            {branch.upstream ? (
                              <>
                                <span>
                                  <ArrowUp size={13} />
                                  {branch.ahead || 0}
                                </span>
                                <span>
                                  <ArrowDown size={13} />
                                  {branch.behind || 0}
                                </span>
                              </>
                            ) : (
                              <span className="muted">
                                {branch.remote ? '远程引用' : '未设置上游'}
                              </span>
                            )}
                          </div>
                          <div className="branch-row-actions">
                            {!branch.remote && !branch.current && (
                              <>
                                <button
                                  className="text-button"
                                  disabled={!!busy}
                                  onClick={() =>
                                    perform({ action: 'branch-switch', name: branch.name })
                                  }
                                >
                                  切换
                                </button>
                                <button
                                  className="icon-button small"
                                  disabled={!!busy}
                                  title={`合并 ${branch.name} 到当前分支`}
                                  onClick={() =>
                                    confirm(
                                      '合并分支',
                                      `将 ${branch.name} 合并到当前分支 ${snapshot.status.branch}。请先处理工作区中的更改。`,
                                      { action: 'merge', name: branch.name },
                                    )
                                  }
                                >
                                  <GitMerge size={16} />
                                </button>
                                <button
                                  className="icon-button small danger-hover"
                                  disabled={!!busy}
                                  title={`删除分支 ${branch.name}`}
                                  onClick={() =>
                                    confirm(
                                      '删除本地分支',
                                      `删除 ${branch.name}。为保护未合并的提交，Git 会拒绝删除尚未合并的分支。`,
                                      { action: 'branch-delete', name: branch.name },
                                      true,
                                    )
                                  }
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                            {branch.current && (
                              <span className="current-here">
                                <CircleDot size={14} />
                                正在此处工作
                              </span>
                            )}
                            {branch.remote && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  setDialog({
                                    title: '从远程创建本地分支',
                                    description: `基于 ${branch.name} 创建一个本地分支。`,
                                    fields: [
                                      {
                                        name: 'name',
                                        label: '本地分支名称',
                                        defaultValue: branch.name.split('/').slice(1).join('/'),
                                        required: true,
                                      },
                                    ],
                                    submitLabel: '创建分支',
                                    onSubmit: async (v) => {
                                      await execute({
                                        action: 'branch-create',
                                        name: v.name,
                                        startPoint: branch.name,
                                      });
                                      setDialog(null);
                                    },
                                  })
                                }
                              >
                                创建本地分支
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    {!snapshot.branches.length && (
                      <Empty
                        icon={GitBranch}
                        title="分支即将生长"
                        description="先创建一次提交，再开始探索分支。"
                      />
                    )}
                  </section>
                  <div className="info-note">
                    <Info size={15} />
                    切换分支会更新工作区文件。建议在切换前提交或储藏当前更改。
                  </div>
                </>
              )}

              {page === 'stashes' && (
                <>
                  <div className="section-toolbar">
                    <div className="section-title">
                      <h2>已保存的工作</h2>
                      <span className="subtle-badge">{snapshot.stashes.length}</span>
                    </div>
                    <Button primary onClick={saveStash} disabled={!changed.length || !!busy}>
                      <Plus size={15} />
                      储藏当前更改
                    </Button>
                  </div>
                  <div className="collection-list">
                    {snapshot.stashes.map((stash) => (
                      <section className="panel collection-card" key={stash.ref}>
                        <span className="collection-icon purple">
                          <Layers size={23} />
                        </span>
                        <div className="collection-info">
                          <div>
                            <h3>{stash.message}</h3>
                            <code className="subtle-badge">{stash.ref}</code>
                          </div>
                          <p>
                            <Clock3 size={13} />
                            {relative(stash.date)}
                            <span>·</span>
                            <code>{stash.hash.slice(0, 7)}</code>
                          </p>
                        </div>
                        <div className="inline-actions">
                          <Button
                            disabled={!!busy}
                            onClick={() =>
                              confirm('应用储藏', `将 ${stash.ref} 应用到工作区，保留储藏记录。`, {
                                action: 'stash-apply',
                                ref: stash.ref,
                              })
                            }
                          >
                            <ArrowDownToLine size={14} />
                            应用
                          </Button>
                          <Button
                            disabled={!!busy}
                            onClick={() =>
                              confirm('弹出储藏', `应用 ${stash.ref}，成功后删除该储藏记录。`, {
                                action: 'stash-pop',
                                ref: stash.ref,
                              })
                            }
                          >
                            弹出
                          </Button>
                          <button
                            className="icon-button danger-hover"
                            disabled={!!busy}
                            title="删除储藏"
                            onClick={() =>
                              confirm(
                                '删除储藏',
                                `永久删除 ${stash.ref}，其中尚未应用的更改将丢失。`,
                                { action: 'stash-drop', ref: stash.ref },
                                true,
                              )
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </section>
                    ))}
                    {!snapshot.stashes.length && (
                      <section className="panel">
                        <Empty
                          icon={Layers}
                          title="灵感可以稍后继续"
                          description="储藏当前更改，腾出干净的工作区，随时恢复。"
                        >
                          <Button onClick={saveStash} disabled={!changed.length} primary>
                            储藏当前更改
                          </Button>
                        </Empty>
                      </section>
                    )}
                  </div>
                  <div className="info-note">
                    <Info size={15} />
                    「应用」保留储藏；「弹出」在应用成功后移除记录。发生冲突时，请先解决文件中的冲突。
                  </div>
                </>
              )}

              {page === 'tags' && (
                <>
                  <div className="section-toolbar">
                    <div className="section-title">
                      <h2>版本里程碑</h2>
                      <span className="subtle-badge">{snapshot.tags.length}</span>
                    </div>
                    <Button primary onClick={newTag} disabled={!snapshot.commits.length}>
                      <Plus size={15} />
                      创建标签
                    </Button>
                  </div>
                  <div className="collection-list">
                    {snapshot.tags.map((tag) => (
                      <section className="panel collection-card" key={tag.name}>
                        <span className="collection-icon green-bg">
                          <Tag size={23} />
                        </span>
                        <div className="collection-info">
                          <div>
                            <h3>{tag.name}</h3>
                            <span className="subtle-badge">本地标签</span>
                          </div>
                          <p>
                            {tag.message || '轻量标签'}
                            <span>·</span>
                            <code>{tag.hash.slice(0, 7)}</code>
                            {tag.date && <span>{relative(tag.date)}</span>}
                          </p>
                        </div>
                        <div className="inline-actions">
                          <Button
                            onClick={() => {
                              const commit = snapshot.commits.find((c) => c.hash === tag.hash);
                              if (commit) {
                                setSelectedCommit(commit);
                                go('history');
                              } else {
                                api<{ commit: Commit }>(`/repos/${activeId}/commit/${tag.hash}`)
                                  .then((d) => {
                                    setSelectedCommit(d.commit);
                                    go('history');
                                  })
                                  .catch((e) => notify(e.message, true));
                              }
                            }}
                          >
                            <GitCommitHorizontal size={14} />
                            查看提交
                          </Button>
                          <Button
                            disabled={!!busy || !defaultRemote}
                            onClick={() =>
                              confirm(
                                '推送标签',
                                `将本地标签 ${tag.name} 推送到 ${defaultRemote}，供远程 Release 使用。`,
                                { action: 'tag-push', name: tag.name, remote: defaultRemote },
                              )
                            }
                          >
                            <ArrowUpFromLine size={14} />
                            推送标签
                          </Button>
                          <button
                            className="icon-button danger-hover"
                            disabled={!!busy}
                            title="删除标签"
                            onClick={() =>
                              confirm(
                                '删除本地标签',
                                `删除标签 ${tag.name}。提交记录和远程标签不会被删除。`,
                                { action: 'tag-delete', name: tag.name },
                                true,
                              )
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </section>
                    ))}
                    {!snapshot.tags.length && (
                      <section className="panel">
                        <Empty
                          icon={Tag}
                          title="为重要时刻留下标记"
                          description="给当前提交添加版本号，建立清晰的发布记录。"
                        >
                          <Button primary onClick={newTag} disabled={!snapshot.commits.length}>
                            创建第一个标签
                          </Button>
                        </Empty>
                      </section>
                    )}
                  </div>
                </>
              )}

              {page === 'remotes' && (
                <>
                  <div className="section-toolbar">
                    <div className="section-title">
                      <h2>已连接的远程仓库</h2>
                      <span className="subtle-badge">{snapshot.remotes.length}</span>
                    </div>
                    <Button primary onClick={newRemote}>
                      <Plus size={15} />
                      添加远程
                    </Button>
                  </div>
                  <div className="remote-grid">
                    {snapshot.remotes.map((remote) => (
                      <section className="panel remote-card" key={remote.name}>
                        <div className="remote-card-heading">
                          <span className="collection-icon blue">
                            <Globe2 size={25} />
                          </span>
                          <div>
                            <h3>{remote.name}</h3>
                            <span>
                              <span className="tiny-dot green" />
                              已配置
                            </span>
                          </div>
                          <button
                            className="icon-button danger-hover"
                            title="移除远程仓库"
                            onClick={() =>
                              confirm(
                                '移除远程配置',
                                `从当前仓库移除 ${remote.name} 的本地连接配置。远程服务器上的仓库不会被删除。`,
                                { action: 'remote-remove', name: remote.name },
                                true,
                              )
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <label>获取地址</label>
                        <div className="remote-url">
                          <code>{remote.fetchUrl}</code>
                          <button
                            className="icon-button small"
                            title="复制获取地址"
                            onClick={() => void copy(remote.fetchUrl)}
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                        <label>推送地址</label>
                        <div className="remote-url">
                          <code>{remote.pushUrl}</code>
                          <button
                            className="icon-button small"
                            title="复制推送地址"
                            onClick={() => void copy(remote.pushUrl)}
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                        <div className="remote-card-footer">
                          <Button
                            disabled={!!busy}
                            onClick={() => perform({ action: 'fetch', remote: remote.name })}
                          >
                            <RefreshCw size={14} />
                            获取更新
                          </Button>
                          <Button
                            disabled={!!busy}
                            primary
                            onClick={() =>
                              confirm(
                                '推送当前分支',
                                `推送 ${snapshot.status.branch} 到远程 ${remote.name}。`,
                                { action: 'push', remote: remote.name },
                              )
                            }
                          >
                            <ArrowUpFromLine size={14} />
                            推送
                          </Button>
                        </div>
                      </section>
                    ))}
                  </div>
                  {!snapshot.remotes.length && (
                    <section className="panel">
                      <Empty
                        icon={Globe2}
                        title="让协作从这里开始"
                        description="添加远程仓库，获取更新或分享你的提交。"
                      >
                        <Button primary onClick={newRemote}>
                          添加远程仓库
                        </Button>
                      </Empty>
                    </section>
                  )}
                  <div className="info-note">
                    <ShieldCheck size={15} />
                    认证沿用本机 Git 的凭据管理器与 SSH 配置。拉取采用
                    fast-forward，避免自动产生意外的合并。
                  </div>
                </>
              )}

              {page === 'settings' && (
                <div className="settings-layout">
                  <section className="panel settings-card">
                    <div className="panel-heading">
                      <div>
                        <Settings2 size={18} />
                        <h2>提交身份</h2>
                      </div>
                      <span className="subtle-badge">仅当前仓库</span>
                    </div>
                    <div className="settings-body">
                      <p>这些信息会出现在新提交的作者记录中。</p>
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (lock.current) return;
                          lock.current = true;
                          setBusy('config');
                          try {
                            await api(`/repos/${activeId}/config`, {
                              method: 'POST',
                              body: JSON.stringify(identity),
                            });
                            notify('仓库提交身份已保存');
                          } catch (err) {
                            notify((err as Error).message, true);
                          } finally {
                            lock.current = false;
                            setBusy('');
                          }
                        }}
                      >
                        <label>
                          作者名称
                          <input
                            required
                            disabled={!identityReady || !!busy}
                            value={identity.name}
                            onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
                            placeholder="你的名字"
                          />
                        </label>
                        <label>
                          电子邮箱
                          <input
                            type="email"
                            required
                            disabled={!identityReady || !!busy}
                            value={identity.email}
                            onChange={(e) => setIdentity({ ...identity, email: e.target.value })}
                            placeholder="you@example.com"
                          />
                        </label>
                        <button
                          className="button primary"
                          disabled={!!busy || !identityReady}
                          type="submit"
                        >
                          <Check size={15} />
                          保存身份
                        </button>
                      </form>
                    </div>
                  </section>
                  <section className="panel settings-card">
                    <div className="panel-heading">
                      <div>
                        <Sun size={18} />
                        <h2>外观与偏好</h2>
                      </div>
                    </div>
                    <div className="settings-body">
                      <div className="setting-row">
                        <div>
                          <strong>界面主题</strong>
                          <p>为你的工作环境选择舒适的配色。</p>
                        </div>
                        <div className="segmented">
                          <button
                            className={theme === 'light' ? 'active' : ''}
                            onClick={() => setTheme('light')}
                          >
                            <Sun size={15} />
                            浅色
                          </button>
                          <button
                            className={theme === 'dark' ? 'active' : ''}
                            onClick={() => setTheme('dark')}
                          >
                            <Moon size={15} />
                            深色
                          </button>
                        </div>
                      </div>
                      <div className="setting-row">
                        <div>
                          <strong>界面语言</strong>
                          <p>中文界面，保留熟悉的 Git 术语。</p>
                        </div>
                        <span className="subtle-badge">简体中文</span>
                      </div>
                      <div className="setting-row">
                        <div>
                          <strong>工作方式</strong>
                          <p>本地服务连接本机 Git，无需账号。</p>
                        </div>
                        <span className="connection-status">
                          <span className="tiny-dot green" />
                          本地运行
                        </span>
                      </div>
                    </div>
                  </section>
                  <section className="panel about-card">
                    <span className="brand-symbol">
                      <GitFork size={24} />
                    </span>
                    <h3>
                      Branchlet <span>1.0.0</span>
                    </h3>
                    <p>为每一次改变，留下一条清晰的来路。</p>
                    <button className="text-button" onClick={() => setHelp(true)}>
                      使用指南与快捷键
                      <ArrowRight size={14} />
                    </button>
                  </section>
                </div>
              )}
            </>
          )}
        </main>
        <footer className="statusbar">
          <span>
            <span className={`tiny-dot ${loadError ? 'amber-dot' : 'green'}`} />
            {busy ? (
              <>
                <LoaderCircle className="spin" size={12} />
                正在执行 {busy}…
              </>
            ) : loadError ? (
              '连接异常'
            ) : (
              'Git 已连接'
            )}
            {snapshot && (
              <>
                <span className="footer-divider" />
                <GitBranch size={12} />
                {snapshot.status.branch}
              </>
            )}
          </span>
          <span>
            {snapshot?.repo.isDemo && (
              <>
                <Sparkles size={12} />
                独立示例仓库
                <span className="footer-divider" />
              </>
            )}
            UTF-8
            <span className="footer-divider" />
            <span>Branchlet 1.0</span>
          </span>
        </footer>
      </div>
      {repoDialog && (
        <RepositoryDialog
          initialMode={repoDialog}
          onClose={() => setRepoDialog(null)}
          onAdded={added}
        />
      )}
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} />}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {searchOpen && (
        <div
          className="command-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSearchOpen(false);
          }}
        >
          <div
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="全局搜索"
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                const elements = e.currentTarget.querySelectorAll<HTMLElement>('button,input');
                const first = elements[0],
                  last = elements[elements.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <div className="command-input">
              <Search size={20} />
              <input
                ref={searchRef}
                placeholder="搜索提交、分支，或跳转到…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button onClick={() => setSearchOpen(false)}>Esc</button>
            </div>
            <div className="command-results">
              <span className="command-group-label">快速操作</span>
              {[
                ...navItems,
                { id: 'open', label: '打开本地仓库', icon: FolderOpen },
                { id: 'init', label: '创建新仓库', icon: Plus },
                { id: 'clone', label: '克隆远程仓库', icon: Cloud },
              ]
                .filter((n) => n.label.includes(search))
                .map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (['open', 'init', 'clone'].includes(n.id))
                        setRepoDialog(n.id as 'open' | 'init' | 'clone');
                      else go(n.id as Page);
                      setSearchOpen(false);
                    }}
                  >
                    <n.icon size={17} />
                    {n.label}
                    <ArrowRight size={14} />
                  </button>
                ))}
              {search && (
                <>
                  <span className="command-group-label">提交</span>
                  {snapshot?.commits
                    .filter((c) =>
                      `${c.subject} ${c.author} ${c.hash}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .slice(0, 5)
                    .map((c) => (
                      <button
                        key={c.hash}
                        onClick={() => {
                          setSelectedCommit(c);
                          go('history');
                          setSearchOpen(false);
                        }}
                      >
                        <GitCommitHorizontal size={17} />
                        <span>{c.subject}</span>
                        <code>{c.shortHash}</code>
                      </button>
                    ))}
                  <span className="command-group-label">分支</span>
                  {localBranches
                    .filter((b) => b.name.includes(search))
                    .slice(0, 4)
                    .map((b) => (
                      <button
                        key={b.name}
                        onClick={() => {
                          go('branches');
                          setFilter(b.name);
                          setSearchOpen(false);
                        }}
                      >
                        <GitBranch size={17} />
                        {b.name}
                        <ArrowRight size={14} />
                      </button>
                    ))}
                </>
              )}
            </div>
            <div className="command-footer">
              <Command size={13} />
              用关键词找到你的下一步<span>Ctrl K 打开 / 关闭</span>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <Info size={19} /> : <CheckCheck size={19} />}
          <span>{toast.message}</span>
          <button
            className="icon-button small"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
