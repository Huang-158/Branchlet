import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Braces,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  Home,
  Image,
  Info,
  Link2,
  List,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import './repository-files.css';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  status?: string;
  size?: number;
}
interface DirectoryData {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  truncated: boolean;
}
interface PreviewData {
  path: string;
  content?: string;
  binary: boolean;
  truncated: boolean;
  size: number;
}
type ViewMode = 'list' | 'tree';
const VIEW_KEY = 'branchlet.files.view';

function formatSize(size?: number) {
  if (size === undefined) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function statusInfo(status?: string) {
  if (!status) return null;
  if (status.includes('?')) return { label: '未跟踪', kind: 'new', letter: 'U' };
  if (status === 'U' || /^(DD|AU|UD|UA|DU|AA|UU)$/.test(status))
    return { label: '冲突', kind: 'conflict', letter: '!' };
  if (status.includes('A')) return { label: '新增', kind: 'new', letter: 'A' };
  if (status.includes('D')) return { label: '删除', kind: 'deleted', letter: 'D' };
  if (status.includes('R')) return { label: '重命名', kind: 'changed', letter: 'R' };
  return { label: '已修改', kind: 'changed', letter: 'M' };
}

function EntryIcon({ entry, expanded = false }: { entry: FileEntry; expanded?: boolean }) {
  if (entry.type === 'directory') return expanded ? <FolderOpen size={16} /> : <Folder size={16} />;
  if (entry.type === 'symlink') return <Link2 size={15} />;
  if (/\.(png|jpe?g|gif|webp|ico|svg|avif)$/i.test(entry.name)) return <Image size={15} />;
  if (/\.(json|ya?ml|toml)$/i.test(entry.name)) return <Braces size={15} />;
  if (/\.(tsx?|jsx?|py|go|rs|java|c(pp)?|h|css|html|vue|sh|ps1)$/i.test(entry.name))
    return <FileCode2 size={15} />;
  if (/\.(md|txt|rst|log|csv)$/i.test(entry.name)) return <FileText size={15} />;
  return <File size={15} />;
}

function StatusBadge({ status, small = false }: { status?: string; small?: boolean }) {
  const info = statusInfo(status);
  return info ? (
    <span
      className={`rf-status rf-status-${info.kind}${small ? ' rf-status-small' : ''}`}
      title={info.label}
      aria-label={info.label}
    >
      {small ? info.letter : info.label}
    </span>
  ) : null;
}

export function RepositoryFiles({
  repoId,
  onNotice,
  refreshKey,
}: {
  repoId: string;
  onNotice?: (message: string, error?: boolean) => void;
  refreshKey?: number;
}) {
  const [view, setView] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'list';
    } catch {
      return 'list';
    }
  });
  const [currentPath, setCurrentPath] = useState('');
  const [directories, setDirectories] = useState<Record<string, DirectoryData>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [directoryErrors, setDirectoryErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [revision, setRevision] = useState(0);
  const cache = useRef<Record<string, DirectoryData>>({});
  const requests = useRef(new Map<string, Promise<DirectoryData | undefined>>());
  const generation = useRef(0);
  const lastRefreshKey = useRef(refreshKey);
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  const loadDirectory = useCallback(
    (path: string, force = false): Promise<DirectoryData | undefined> => {
      if (!force && cache.current[path]) return Promise.resolve(cache.current[path]);
      const existing = requests.current.get(path);
      if (existing) return existing;
      const epoch = generation.current;
      setPending((old) => new Set(old).add(path));
      setDirectoryErrors((old) => {
        const next = { ...old };
        delete next[path];
        return next;
      });
      const request = api<DirectoryData>(
        `/repos/${encodeURIComponent(repoId)}/files?path=${encodeURIComponent(path)}`,
      )
        .then((data) => {
          if (epoch === generation.current) {
            cache.current[path] = data;
            setDirectories((old) => ({ ...old, [path]: data }));
          }
          return data;
        })
        .catch((error: Error) => {
          if (epoch === generation.current) {
            setDirectoryErrors((old) => ({ ...old, [path]: error.message }));
            noticeRef.current?.(error.message, true);
          }
          return undefined;
        })
        .finally(() => {
          if (epoch === generation.current) {
            requests.current.delete(path);
            setPending((old) => {
              const next = new Set(old);
              next.delete(path);
              return next;
            });
          }
        });
      requests.current.set(path, request);
      return request;
    },
    [repoId],
  );

  useEffect(() => {
    generation.current++;
    cache.current = {};
    requests.current = new Map();
    setDirectories({});
    setDirectoryErrors({});
    setPending(new Set());
    setCurrentPath('');
    setExpanded(new Set(['']));
    setSelectedFile(null);
    setPreview(null);
    void loadDirectory('');
    return () => {
      generation.current++;
    };
  }, [repoId, loadDirectory]);

  useEffect(() => {
    if (!selectedFile) {
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    if (selectedFile.type === 'symlink') {
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError('符号链接仅显示名称，不跟随链接读取文件。');
      return;
    }
    const controller = new AbortController();
    setPreviewLoading(true);
    setPreview(null);
    setPreviewError('');
    api<PreviewData>(
      `/repos/${encodeURIComponent(repoId)}/file?path=${encodeURIComponent(selectedFile.path)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setPreview(data);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) {
          setPreviewError(error.message);
          noticeRef.current?.(error.message, true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
  }, [repoId, selectedFile, revision]);

  const navigate = (path: string) => {
    setCurrentPath(path);
    const ancestors = [''];
    path
      .split('/')
      .filter(Boolean)
      .forEach((_, index, pieces) => ancestors.push(pieces.slice(0, index + 1).join('/')));
    setExpanded((old) => new Set([...old, ...ancestors]));
    for (const ancestor of ancestors) void loadDirectory(ancestor);
  };

  const chooseFile = (entry: FileEntry) => {
    setSelectedFile(entry);
    const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    setCurrentPath(parent);
  };

  const toggleFolder = (entry: FileEntry) => {
    setCurrentPath(entry.path);
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    void loadDirectory(entry.path);
  };

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* Browsing remains usable without persistence. */
    }
    if (next === 'tree') navigate(currentPath);
  };

  const refresh = () => {
    const paths = new Set(['', currentPath, ...(view === 'tree' ? expanded : [])]);
    cache.current = {};
    for (const path of paths) void loadDirectory(path, true);
    setRevision((old) => old + 1);
  };

  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return;
    lastRefreshKey.current = refreshKey;
    refresh();
  }, [refreshKey]);

  const treeKeyboard = (event: KeyboardEvent<HTMLButtonElement>, entry: FileEntry) => {
    const buttons = Array.from(
      event.currentTarget
        .closest('.rf-tree')
        ?.querySelectorAll<HTMLButtonElement>('.rf-tree-row') ?? [],
    );
    const index = buttons.indexOf(event.currentTarget);
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? buttons.length - 1
            : Math.min(
                buttons.length - 1,
                Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)),
              );
      buttons[next]?.focus();
    } else if (event.key === 'ArrowRight' && entry.type === 'directory') {
      event.preventDefault();
      if (!expanded.has(entry.path)) toggleFolder(entry);
      else buttons[index + 1]?.focus();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (entry.type === 'directory' && expanded.has(entry.path)) toggleFolder(entry);
      else {
        const parent = entry.path.includes('/')
          ? entry.path.slice(0, entry.path.lastIndexOf('/'))
          : '';
        buttons.find((button) => button.dataset.path === parent)?.focus();
      }
    }
  };

  const renderDirectory = (path: string, depth: number) => {
    const data = directories[path];
    if (pending.has(path) && !data)
      return (
        <div className="rf-tree-message" style={{ paddingLeft: 22 + depth * 17 }} role="status">
          <LoaderCircle size={13} className="rf-spin" />
          正在读取…
        </div>
      );
    if (directoryErrors[path])
      return (
        <div className="rf-tree-error" style={{ paddingLeft: 22 + depth * 17 }}>
          {directoryErrors[path]}
          <button onClick={() => void loadDirectory(path, true)}>重试</button>
        </div>
      );
    if (!data) return null;
    return (
      <>
        {data.entries.map((entry) => (
          <div className="rf-tree-node" key={entry.path}>
            <button
              className={`rf-tree-row ${entry.type === 'directory' ? 'rf-directory' : ''}${(entry.type === 'directory' ? currentPath === entry.path : selectedFile?.path === entry.path) ? ' rf-selected' : ''}`}
              type="button"
              data-path={entry.path}
              style={{ paddingLeft: 10 + depth * 17 }}
              onClick={() => (entry.type === 'directory' ? toggleFolder(entry) : chooseFile(entry))}
              onKeyDown={(event) => treeKeyboard(event, entry)}
              aria-expanded={entry.type === 'directory' ? expanded.has(entry.path) : undefined}
              aria-label={`${entry.type === 'directory' ? '文件夹' : entry.type === 'symlink' ? '符号链接' : '文件'} ${entry.name}${entry.status ? `，${statusInfo(entry.status)?.label}` : ''}`}
              title={entry.path}
            >
              <span className="rf-chevron">
                {entry.type === 'directory' &&
                  (expanded.has(entry.path) ? (
                    <ChevronDown size={13} />
                  ) : (
                    <ChevronRight size={13} />
                  ))}
              </span>
              <EntryIcon entry={entry} expanded={expanded.has(entry.path)} />
              <span className="rf-entry-name">{entry.name}</span>
              <StatusBadge status={entry.status} small />
            </button>
            {entry.type === 'directory' && expanded.has(entry.path) && (
              <div className="rf-tree-children">{renderDirectory(entry.path, depth + 1)}</div>
            )}
          </div>
        ))}
        {!data.entries.length && (
          <div className="rf-tree-message" style={{ paddingLeft: 28 + depth * 17 }}>
            空文件夹
          </div>
        )}
        {data.truncated && (
          <div className="rf-tree-message" style={{ paddingLeft: 22 + depth * 17 }}>
            文件较多，仅显示当前目录的前 1,000 项。
          </div>
        )}
      </>
    );
  };

  const current = directories[currentPath];
  const selectedParent = selectedFile?.path.includes('/')
    ? selectedFile.path.slice(0, selectedFile.path.lastIndexOf('/'))
    : '';
  const refreshedSelectedFile = directories[selectedParent]?.entries.find(
    (entry) => entry.path === selectedFile?.path,
  );
  const selectedStatus = refreshedSelectedFile
    ? refreshedSelectedFile.status
    : selectedFile?.status;
  const breadcrumbs = currentPath.split('/').filter(Boolean);
  const code = useMemo(() => {
    const lines = (preview?.content ?? '').replace(/\r\n/g, '\n').split('\n');
    const limited = lines.slice(0, 20000);
    return {
      content: limited.join('\n'),
      numbers: limited.map((_, index) => index + 1).join('\n'),
      lines: limited.length,
      clipped: lines.length > limited.length,
    };
  }, [preview]);

  return (
    <section className="rf-browser" aria-label="仓库文件浏览器">
      <div className="rf-toolbar">
        <div className="rf-title">
          <FolderTree size={18} />
          <strong>仓库文件</strong>
          <span>浏览项目的每一层</span>
        </div>
        <div className="rf-toolbar-actions">
          <div className="rf-view-toggle" role="group" aria-label="文件显示方式">
            <button
              type="button"
              className={view === 'list' ? 'rf-active' : ''}
              aria-pressed={view === 'list'}
              onClick={() => changeView('list')}
            >
              <List size={14} />
              默认列表
            </button>
            <button
              type="button"
              className={view === 'tree' ? 'rf-active' : ''}
              aria-pressed={view === 'tree'}
              onClick={() => changeView('tree')}
            >
              <FolderTree size={14} />
              树状结构
            </button>
          </div>
          <button
            className="rf-icon-button"
            type="button"
            title="刷新文件"
            aria-label="刷新文件"
            onClick={refresh}
            disabled={pending.size > 0}
          >
            <RefreshCw size={15} className={pending.size > 0 ? 'rf-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="rf-breadcrumbs" aria-label="当前文件夹路径">
        <button type="button" onClick={() => navigate('')} title="仓库根目录">
          <Home size={13} />
          根目录
        </button>
        {breadcrumbs.map((name, index) => (
          <span key={index}>
            <ChevronRight size={12} />
            <button
              type="button"
              onClick={() => navigate(breadcrumbs.slice(0, index + 1).join('/'))}
              aria-current={index === breadcrumbs.length - 1 ? 'location' : undefined}
            >
              {name}
            </button>
          </span>
        ))}
        <span className="rf-current-count">
          {current ? `${current.entries.length}${current.truncated ? '+' : ''} 项` : '正在读取'}
        </span>
      </div>
      <div className="rf-workspace">
        <div className="rf-explorer">
          <div className="rf-explorer-heading">
            <span>{view === 'tree' ? '项目结构' : '名称'}</span>
            {view === 'tree' ? (
              <button
                type="button"
                className="rf-icon-button"
                title="折叠所有文件夹"
                aria-label="折叠所有文件夹"
                onClick={() => {
                  setExpanded(new Set(['']));
                  setCurrentPath('');
                }}
              >
                <ChevronsDownUp size={14} />
              </button>
            ) : (
              <span>状态 / 大小</span>
            )}
          </div>
          {view === 'tree' ? (
            <div className="rf-tree" aria-label="文件夹树">
              {renderDirectory('', 0)}
            </div>
          ) : (
            <div className="rf-list">
              {currentPath && (
                <button
                  type="button"
                  className="rf-list-row rf-parent-row"
                  onClick={() =>
                    navigate(current?.parent ?? currentPath.split('/').slice(0, -1).join('/'))
                  }
                >
                  <FolderOpen size={16} />
                  <span>..</span>
                  <span className="rf-parent-label">返回上一级</span>
                </button>
              )}
              {pending.has(currentPath) && !current ? (
                <div className="rf-empty" role="status">
                  <LoaderCircle className="rf-spin" size={23} />
                  <span>正在读取文件…</span>
                </div>
              ) : directoryErrors[currentPath] ? (
                <div className="rf-empty rf-error">
                  <Info size={24} />
                  <span>{directoryErrors[currentPath]}</span>
                  <button type="button" onClick={() => void loadDirectory(currentPath, true)}>
                    重新读取
                  </button>
                </div>
              ) : current?.entries.length ? (
                current.entries.map((entry) => (
                  <button
                    type="button"
                    key={entry.path}
                    className={`rf-list-row${entry.type === 'directory' ? ' rf-directory' : ''}${selectedFile?.path === entry.path ? ' rf-selected' : ''}`}
                    onClick={() =>
                      entry.type === 'directory' ? navigate(entry.path) : chooseFile(entry)
                    }
                    title={entry.path}
                  >
                    <EntryIcon entry={entry} />
                    <span className="rf-entry-name">{entry.name}</span>
                    <StatusBadge status={entry.status} />
                    <span className="rf-entry-size">
                      {entry.type === 'directory' ? (
                        <ChevronRight size={13} />
                      ) : (
                        formatSize(entry.size)
                      )}
                    </span>
                  </button>
                ))
              ) : (
                <div className="rf-empty">
                  <FolderOpen size={27} strokeWidth={1.5} />
                  <strong>这个文件夹很安静</strong>
                  <span>这里还没有可显示的文件。</span>
                </div>
              )}
              {current?.truncated && (
                <p className="rf-limit-note">当前目录仅显示前 1,000 项，请进入子目录继续浏览。</p>
              )}
            </div>
          )}
          <div className="rf-explorer-foot">
            <span className="rf-small-dot" />
            已隐藏 .git 与 Git 忽略文件
          </div>
        </div>
        <div className="rf-preview">
          <div className="rf-preview-heading">
            <span>
              <FileText size={15} />
              <strong title={selectedFile?.path}>{selectedFile?.path || '文件预览'}</strong>
            </span>
            <span className="rf-readonly">只读</span>
          </div>
          {!selectedFile ? (
            <div className="rf-preview-empty">
              <div className="rf-preview-art">
                <FileCode2 size={34} strokeWidth={1.2} />
                <span />
              </div>
              <h3>打开文件，看见项目全貌</h3>
              <p>
                从左侧选择文件，直接查看内容。
                <br />
                切换树状结构，按文件夹层级探索仓库。
              </p>
              <div className="rf-preview-hints">
                <span>
                  <List size={13} />
                  列表逐层浏览
                </span>
                <span>
                  <FolderTree size={13} />
                  树状展开结构
                </span>
              </div>
            </div>
          ) : previewLoading ? (
            <div className="rf-preview-empty" role="status">
              <LoaderCircle className="rf-spin" size={25} />
              <p>正在读取文件内容…</p>
            </div>
          ) : previewError ? (
            <div className="rf-preview-empty rf-error">
              <Info size={28} />
              <h3>无法预览这个文件</h3>
              <p>{previewError}</p>
              {selectedFile.type !== 'symlink' && (
                <button type="button" onClick={() => setRevision((old) => old + 1)}>
                  重新读取
                </button>
              )}
            </div>
          ) : preview?.binary ? (
            <div className="rf-preview-empty">
              <File size={35} strokeWidth={1.3} />
              <h3>二进制文件</h3>
              <p>
                这个文件适合使用对应的应用打开。
                <br />
                {formatSize(preview.size)} · 文本预览不可用
              </p>
            </div>
          ) : preview ? (
            <>
              {(preview.truncated || code.clipped) && (
                <div className="rf-preview-warning">
                  <Info size={14} />
                  {code.clipped
                    ? '文件行数较多，显示前 20,000 行。'
                    : '文件较大，显示前 1 MB 内容。'}
                </div>
              )}
              <div
                className="rf-code-scroll"
                tabIndex={0}
                role="region"
                aria-label={`${selectedFile.name} 只读文件内容，可横向滚动`}
              >
                <pre className="rf-line-numbers" aria-hidden="true">
                  {code.numbers}
                </pre>
                <pre className="rf-code">
                  <code>{code.content || '\n'}</code>
                </pre>
              </div>
              <div className="rf-preview-foot">
                <span>
                  {formatSize(preview.size)}
                  <span>·</span>
                  {code.lines.toLocaleString()} 行
                  {preview.truncated || code.clipped ? '（部分）' : ''}
                </span>
                <span>
                  <StatusBadge status={selectedStatus} />
                  UTF-8
                </span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
