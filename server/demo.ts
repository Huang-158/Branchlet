import { mkdir, access, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { runGit } from './git-command.js';

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** A real disposable example repository. Once created, its working tree is never reset. */
export async function ensureDemo(dataDir: string): Promise<string> {
  const directory = path.join(dataDir, 'demo');
  if (await exists(path.join(directory, '.git'))) return directory;
  await mkdir(directory, { recursive: true });
  const file = async (name: string, value: string) => {
    const dest = path.join(directory, name);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, value, 'utf8');
  };
  let index = 0;
  const commit = async (message: string, author = '林夏', email = 'linxia@example.com') => {
    index += 1;
    const date = `2026-09-${String(Math.min(index + 1, 11)).padStart(2, '0')}T${String(9 + (index % 9)).padStart(2, '0')}:30:00+08:00`;
    await runGit(directory, ['add', '--all']);
    await runGit(directory, ['commit', '-m', message], {
      env: {
        GIT_AUTHOR_NAME: author,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: author,
        GIT_COMMITTER_EMAIL: email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_DATE: date,
      },
    });
  };
  await runGit(directory, ['init', '-b', 'main']);
  await runGit(directory, ['config', '--local', 'user.name', '林夏']);
  await runGit(directory, ['config', '--local', 'user.email', 'linxia@example.com']);
  await file(
    'README.md',
    '# Atlas Workspace\n\n一个为创作者打造的轻量工作空间。\n\n## 开始使用\n\n```bash\nnpm install\nnpm run dev\n```\n\n这是 Branchlet 自动创建的真实 Git 示例仓库，可自由尝试提交、分支和储藏操作。\n',
  );
  await file('.gitignore', 'node_modules/\ndist/\n.env\n');
  await file(
    'package.json',
    JSON.stringify(
      {
        name: 'atlas-workspace',
        version: '1.0.0',
        private: true,
        scripts: { dev: 'vite', build: 'vite build' },
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vite: '^6.0.0' },
      },
      null,
      2,
    ) + '\n',
  );
  await commit('chore: 初始化 Atlas 工作空间');
  await file(
    'src/styles/tokens.css',
    ':root {\n  --color-bg: #f6f7f9;\n  --color-text: #20232b;\n  --color-accent: #6d5ce8;\n  --radius-card: 12px;\n}\n',
  );
  await commit('style: 建立色彩与间距设计规范', '陈墨', 'chenmo@example.com');
  await file(
    'src/components/Sidebar.tsx',
    'export function Sidebar() {\n  return (\n    <aside className="sidebar">\n      <h1>Atlas</h1>\n      <nav>我的工作区</nav>\n    </aside>\n  );\n}\n',
  );
  await commit('feat: 添加工作区侧边导航');
  await file(
    'src/components/ProjectCard.tsx',
    'type Project = { name: string; description: string };\n\nexport function ProjectCard({ name, description }: Project) {\n  return (\n    <article className="project-card">\n      <h2>{name}</h2>\n      <p>{description}</p>\n    </article>\n  );\n}\n',
  );
  await commit('feat: 实现项目卡片与概览布局', '周予', 'zhouyu@example.com');
  await file(
    'src/App.tsx',
    'import { Sidebar } from "./components/Sidebar";\nimport { ProjectCard } from "./components/ProjectCard";\nimport "./styles/tokens.css";\n\nexport default function App() {\n  return (\n    <div className="app-shell">\n      <Sidebar />\n      <main>\n        <h1>Good morning, Alex</h1>\n        <p>让灵感有序生长。</p>\n        <ProjectCard name="Brand refresh" description="用设计讲述新的故事" />\n      </main>\n    </div>\n  );\n}\n',
  );
  await commit('feat: 连接首页组件与项目数据');
  await file(
    'src/hooks/useProjects.ts',
    'export const projects = [\n  { id: "01", name: "Brand refresh", status: "active" },\n  { id: "02", name: "Portfolio 2026", status: "draft" },\n];\n\nexport function useProjects() {\n  return { projects, loading: false };\n}\n',
  );
  await commit('feat: 增加项目数据读取 Hook', '周予', 'zhouyu@example.com');
  await file(
    'docs/design.md',
    '# Design notes\n\n- 清晰的层级与舒适的留白\n- 键盘可访问的交互控件\n- 支持浅色与深色工作环境\n',
  );
  await commit('docs: 补充产品设计说明', '陈墨', 'chenmo@example.com');
  await file(
    'src/utils/format.ts',
    'export function formatDate(date: Date): string {\n  return new Intl.DateTimeFormat("zh-CN", {\n    month: "short", day: "numeric",\n  }).format(date);\n}\n',
  );
  await commit('fix: 统一项目日期显示格式');
  await runGit(directory, ['tag', '-a', 'v1.0.0', '-m', 'Atlas Workspace 第一个稳定版本']);
  await runGit(directory, ['switch', '-c', 'feature/workspace']);
  await file(
    'src/components/WorkspaceHeader.tsx',
    'export function WorkspaceHeader() {\n  return <header className="workspace-header">你的创意，值得一个好空间。</header>;\n}\n',
  );
  await commit('feat: 设计新版工作区头部', '陈墨', 'chenmo@example.com');
  await file(
    'src/components/QuickActions.tsx',
    'export function QuickActions() {\n  return <button type="button">创建新项目</button>;\n}\n',
  );
  await commit('feat: 添加工作区快捷操作入口');
  await runGit(directory, ['switch', 'main']);
  await file(
    'src/utils/search.ts',
    'export function searchProjects<T extends { name: string }>(items: T[], query: string): T[] {\n  const needle = query.trim().toLocaleLowerCase();\n  return items.filter((item) => item.name.toLocaleLowerCase().includes(needle));\n}\n',
  );
  await commit('feat: 支持按名称搜索项目', '周予', 'zhouyu@example.com');
  await runGit(directory, ['branch', 'fix/search-empty-state']);
  const remote = path.join(dataDir, 'demo-origin.git');
  if (!(await exists(remote))) {
    await mkdir(remote, { recursive: true });
    await runGit(remote, ['init', '--bare', '-b', 'main']);
  }
  await runGit(directory, ['remote', 'add', 'origin', remote]);
  await runGit(directory, ['push', '-u', 'origin', '--all']);
  await runGit(directory, ['push', 'origin', '--tags']);
  await file(
    'docs/changelog.md',
    '# 更新记录\n\n## 1.1.0 · 开发中\n\n- 项目快速搜索\n- 更舒适的工作区体验\n\n## 1.0.0\n\n- 全新的项目概览与工作区导航\n',
  );
  await commit('docs: 更新 1.1 版本开发记录');
  await appendFile(
    path.join(directory, 'docs/design.md'),
    '\n## 探索中\n\n尝试增加可自定义的快捷键面板。\n',
  );
  await runGit(directory, ['stash', 'push', '-m', 'WIP: 快捷键面板设计探索']);
  await file(
    'src/App.tsx',
    'import { Sidebar } from "./components/Sidebar";\nimport { ProjectCard } from "./components/ProjectCard";\nimport "./styles/tokens.css";\n\nexport default function App() {\n  return (\n    <div className="app-shell">\n      <Sidebar />\n      <main className="workspace-content">\n        <div className="page-heading">\n          <span className="eyebrow">YOUR WORKSPACE</span>\n          <h1>每一个好想法，都从这里开始。</h1>\n          <p>整理项目，保持专注，让创意自然发生。</p>\n        </div>\n        <ProjectCard name="Brand refresh" description="用设计讲述新的故事" />\n        <ProjectCard name="Portfolio 2026" description="记录值得分享的作品" />\n      </main>\n    </div>\n  );\n}\n',
  );
  await runGit(directory, ['add', '--', 'src/App.tsx']);
  await appendFile(
    path.join(directory, 'src/styles/tokens.css'),
    '\n.page-heading {\n  margin-bottom: 32px;\n  line-height: 1.5;\n}\n\n.eyebrow {\n  color: var(--color-accent);\n  font-size: 11px;\n  letter-spacing: 0.12em;\n}\n',
  );
  await appendFile(
    path.join(directory, 'README.md'),
    '\n## 进行中的改进\n\n- [x] 首页文案与布局\n- [ ] 工作区欢迎横幅\n- [ ] 深色主题\n',
  );
  await file(
    'src/components/WelcomeBanner.tsx',
    'export function WelcomeBanner() {\n  return (\n    <section className="welcome-banner">\n      <span>✦</span>\n      <h2>为新的灵感，留一点空间。</h2>\n      <button type="button">创建项目</button>\n    </section>\n  );\n}\n',
  );
  return directory;
}
