import { useMemo, type CSSProperties, type KeyboardEvent } from 'react';
import { FileCode2, GitBranch, GitCommitHorizontal, LoaderCircle, Tag } from 'lucide-react';
import type { Commit } from '../../shared/types';
import './git-visuals.css';

const GRAPH_COLORS = ['#16866b', '#8b6dd7', '#548ac7', '#d99442', '#cb728f', '#52a5a0'];
const ROW_HEIGHT = 66;
const LANE_WIDTH = 19;
const LEFT_INSET = 24;

interface GraphNode {
  commit: Commit;
  row: number;
  lane: number;
}
interface GraphEdge {
  from: GraphNode;
  parent: string;
  lane: number;
}

/** Pending parent hashes retain their lanes until their actual commit is visited. */
function layoutGraph(commits: Commit[]) {
  const visibleHashes = new Set(commits.map((commit) => commit.hash));
  const pending: Array<string | null> = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let maxLane = 0;
  const freeLane = () => {
    const index = pending.indexOf(null);
    return index < 0 ? pending.length : index;
  };

  commits.forEach((commit, row) => {
    let lane = pending.indexOf(commit.hash);
    if (lane < 0) lane = freeLane();
    pending[lane] = null;
    const node = { commit, row, lane };
    nodes.push(node);
    maxLane = Math.max(maxLane, lane);

    [...new Set(commit.parents)].forEach((parent, parentIndex) => {
      let parentLane = pending.indexOf(parent);
      if (parentLane < 0) {
        parentLane = parentIndex === 0 ? lane : freeLane();
        // A filtered-out parent gets a continuation marker, but must not reserve
        // an ever-growing lane for a node that will never appear in this list.
        if (visibleHashes.has(parent)) pending[parentLane] = parent;
      }
      maxLane = Math.max(maxLane, parentLane);
      edges.push({ from: node, parent, lane: parentLane });
    });
  });

  return { nodes, edges, width: Math.max(86, LEFT_INSET * 2 + maxLane * LANE_WIDTH) };
}

function initials(author: string) {
  const words = author.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (/[^\x00-\x7F]/.test(words[0])) return Array.from(words[0])[0];
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

function relativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '日期未知';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes >= 0 && minutes < 1) return '刚刚';
  if (minutes >= 1 && minutes < 60) return `${minutes} 分钟前`;
  if (minutes >= 60 && minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  if (minutes >= 1440 && minutes < 43200) return `${Math.floor(minutes / 1440)} 天前`;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  }).format(date);
}

function readableRef(ref: string) {
  return ref
    .replace(/^refs\/(heads|remotes|tags)\//, '')
    .replace(/^HEAD\s*->\s*/, '')
    .replace(/^tag:\s*/, '');
}

export function CommitGraph({
  commits,
  selectedHash,
  onSelect,
  compact = false,
}: {
  commits: Commit[];
  selectedHash?: string;
  onSelect: (commit: Commit) => void;
  compact?: boolean;
}) {
  const visible = useMemo(() => (compact ? commits.slice(0, 7) : commits), [commits, compact]);
  const graph = useMemo(() => layoutGraph(visible), [visible]);
  const nodeByHash = useMemo(
    () => new Map(graph.nodes.map((node) => [node.commit.hash, node])),
    [graph],
  );

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowDown') next = Math.min(index + 1, visible.length - 1);
    else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visible.length - 1;
    else return;
    event.preventDefault();
    const list = event.currentTarget.closest('.bl-graph');
    list?.querySelectorAll<HTMLButtonElement>('.bl-graph-row')[next]?.focus();
    onSelect(visible[next]);
  };

  if (!visible.length)
    return (
      <div className="bl-graph-empty">
        <span className="bl-graph-empty-icon">
          <GitCommitHorizontal size={26} strokeWidth={1.5} />
        </span>
        <strong>故事从第一次提交开始</strong>
        <p>将文件添加到暂存区并提交，历史记录就会显示在这里。</p>
      </div>
    );

  return (
    <div
      className={`bl-graph${compact ? ' bl-graph-compact' : ''}`}
      style={
        {
          '--bl-graph-width': `${graph.width}px`,
          '--bl-graph-row-height': `${ROW_HEIGHT}px`,
        } as CSSProperties
      }
      aria-label="Git 提交历史"
    >
      <svg
        className="bl-graph-lines"
        width={graph.width}
        height={visible.length * ROW_HEIGHT}
        aria-hidden="true"
      >
        {graph.edges.map((edge) => {
          const target = nodeByHash.get(edge.parent);
          const x1 = LEFT_INSET + edge.from.lane * LANE_WIDTH;
          const y1 = edge.from.row * ROW_HEIGHT + ROW_HEIGHT / 2;
          const x2 = LEFT_INSET + (target?.lane ?? edge.lane) * LANE_WIDTH;
          // Only actual parent relationships are drawn; clipped parents get a short continuation.
          const y2 = target ? target.row * ROW_HEIGHT + ROW_HEIGHT / 2 : y1 + ROW_HEIGHT / 2;
          const direction = y2 >= y1 ? 1 : -1;
          const bend = Math.min(Math.abs(y2 - y1) / 2, 27) * direction;
          const d =
            x1 === x2
              ? `M ${x1} ${y1} L ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y1 + bend}, ${x2} ${y1 + bend * 2} L ${x2} ${y2}`;
          return (
            <path
              key={`${edge.from.commit.hash}-${edge.parent}`}
              d={d}
              fill="none"
              stroke={GRAPH_COLORS[edge.lane % GRAPH_COLORS.length]}
              strokeWidth="2"
              strokeLinecap="round"
              opacity={target ? 0.78 : 0.4}
              strokeDasharray={target ? undefined : '3 4'}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const color = GRAPH_COLORS[node.lane % GRAPH_COLORS.length];
          const selected = node.commit.hash === selectedHash;
          return (
            <g key={node.commit.hash}>
              {selected && (
                <circle
                  cx={LEFT_INSET + node.lane * LANE_WIDTH}
                  cy={node.row * ROW_HEIGHT + ROW_HEIGHT / 2}
                  r="10"
                  fill={color}
                  opacity="0.12"
                />
              )}
              <circle
                cx={LEFT_INSET + node.lane * LANE_WIDTH}
                cy={node.row * ROW_HEIGHT + ROW_HEIGHT / 2}
                r={node.commit.parents.length > 1 ? 5.1 : 4.4}
                fill={selected ? color : 'var(--bl-graph-node-fill, #fff)'}
                stroke={color}
                strokeWidth="2.1"
              />
            </g>
          );
        })}
      </svg>
      <div role="list">
        {visible.map((commit, index) => (
          <div role="listitem" key={commit.hash}>
            <button
              type="button"
              className={`bl-graph-row${commit.hash === selectedHash ? ' bl-graph-row-selected' : ''}`}
              onClick={() => onSelect(commit)}
              onKeyDown={(event) => navigate(event, index)}
              aria-pressed={commit.hash === selectedHash}
              aria-label={`${commit.subject}，${commit.author}，提交 ${commit.shortHash}`}
            >
              <span className="bl-graph-content">
                <span className="bl-graph-headline">
                  <span className="bl-graph-subject" title={commit.subject}>
                    {commit.subject}
                  </span>
                  {commit.refs
                    .filter(Boolean)
                    .slice(0, compact ? 2 : 3)
                    .map((ref) => {
                      const isTag = /^(tag:|refs\/tags\/)/.test(ref);
                      const isRemote = /(^refs\/remotes\/|^origin\/|^upstream\/)/.test(ref);
                      return (
                        <span
                          key={ref}
                          className={`bl-graph-ref${isTag || isRemote ? ' bl-graph-ref-purple' : ''}`}
                          title={ref}
                        >
                          {isTag ? <Tag size={10} /> : <GitBranch size={10} />}
                          {readableRef(ref)}
                        </span>
                      );
                    })}
                  {commit.refs.length > (compact ? 2 : 3) && (
                    <span className="bl-graph-more-refs" title={commit.refs.join(', ')}>
                      +{commit.refs.length - (compact ? 2 : 3)}
                    </span>
                  )}
                </span>
                <span className="bl-graph-meta">
                  <span
                    className={`bl-graph-avatar bl-graph-avatar-${index % 4}`}
                    aria-hidden="true"
                  >
                    {initials(commit.author)}
                  </span>
                  <span className="bl-graph-author">{commit.author}</span>
                  <span className="bl-graph-meta-dot" aria-hidden="true">
                    ·
                  </span>
                  <time dateTime={commit.date} title={commit.date}>
                    {relativeDate(commit.date)}
                  </time>
                </span>
              </span>
              <code className="bl-graph-hash">{commit.shortHash || commit.hash.slice(0, 7)}</code>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

type DiffLineKind = 'context' | 'addition' | 'deletion' | 'hunk' | 'metadata';
interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLine?: number;
  newLine?: number;
}

function parseDiff(diff: string) {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  let additions = 0;
  let deletions = 0;
  const source = diff.replace(/\r\n/g, '\n').split('\n');
  if (source[source.length - 1] === '') source.pop();

  for (const content of source) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(content);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      lines.push({ kind: 'hunk', content });
    } else if (
      content.startsWith('diff --git ') ||
      content.startsWith('diff --cc ') ||
      content.startsWith('diff --combined ')
    ) {
      inHunk = false;
      lines.push({ kind: 'metadata', content });
    } else if (inHunk && content.startsWith('+')) {
      lines.push({ kind: 'addition', content: content.slice(1), newLine: newLine++ });
      additions++;
    } else if (inHunk && content.startsWith('-')) {
      lines.push({ kind: 'deletion', content: content.slice(1), oldLine: oldLine++ });
      deletions++;
    } else if (inHunk && content.startsWith(' ')) {
      lines.push({
        kind: 'context',
        content: content.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    } else {
      lines.push({ kind: 'metadata', content });
    }
  }
  return { lines, additions, deletions };
}

export function DiffViewer({
  diff,
  filename,
  loading = false,
}: {
  diff: string;
  filename?: string;
  loading?: boolean;
}) {
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  return (
    <section
      className="bl-diff"
      aria-label={filename ? `${filename} 文件差异` : '文件差异'}
      aria-busy={loading}
    >
      <div className="bl-diff-header">
        <span className="bl-diff-file">
          <FileCode2 size={15} />
          <span title={filename}>{filename || '文件差异'}</span>
        </span>
        <div
          className="bl-diff-stats"
          aria-label={`新增 ${parsed.additions} 行，删除 ${parsed.deletions} 行`}
        >
          <span className="bl-diff-add-stat">+{parsed.additions}</span>
          <span className="bl-diff-del-stat">−{parsed.deletions}</span>
          <span className="bl-diff-unified">统一视图</span>
        </div>
      </div>
      {loading ? (
        <div className="bl-diff-empty" role="status">
          <LoaderCircle className="bl-diff-spinner" size={23} />
          <span>正在读取文件差异…</span>
        </div>
      ) : !diff.trim() ? (
        <div className="bl-diff-empty">
          <FileCode2 size={30} strokeWidth={1.4} />
          <strong>{filename ? '没有可显示的文本差异' : '每一处改变，清晰可见'}</strong>
          <span>
            {filename ? '文件可能没有更改，或内容为空。' : '选择一个文件，查看本次修改的具体内容。'}
          </span>
        </div>
      ) : (
        <div
          className="bl-diff-scroll"
          tabIndex={0}
          role="region"
          aria-label="差异代码，可横向滚动"
        >
          <table className="bl-diff-table" aria-label="统一文件差异">
            <thead className="bl-diff-sr-only">
              <tr>
                <th>原行号</th>
                <th>新行号</th>
                <th>修改类型</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {parsed.lines.map((line, index) => (
                <tr className={`bl-diff-line bl-diff-line-${line.kind}`} key={index}>
                  <td className="bl-diff-line-number">{line.oldLine}</td>
                  <td className="bl-diff-line-number">{line.newLine}</td>
                  <td
                    className="bl-diff-sign"
                    aria-label={
                      line.kind === 'addition'
                        ? '新增'
                        : line.kind === 'deletion'
                          ? '删除'
                          : undefined
                    }
                  >
                    {line.kind === 'addition'
                      ? '+'
                      : line.kind === 'deletion'
                        ? '−'
                        : line.kind === 'hunk'
                          ? '⋯'
                          : ''}
                  </td>
                  <td className="bl-diff-code">
                    <code>{line.content || ' '}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
