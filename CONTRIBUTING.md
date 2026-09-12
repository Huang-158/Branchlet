# 参与开发

[简体中文](CONTRIBUTING.md) · [English](CONTRIBUTING.en.md) · [返回首页](README.md)

## 开发环境

准备 Node.js 22+、npm 与 Git。在项目根目录执行：

```bash
npm ci
npm run dev
```

Vite 页面位于 `http://127.0.0.1:5173`，Git API 位于 `127.0.0.1:4317`。也可用 Windows 源码启动器准备运行环境；修改源码后使用 `Start-Branchlet.cmd -Rebuild` 重建普通运行版本。便携包面向最终用户，开发源码不需要从发布 ZIP 中反向修改。

## 架构

| 位置                         | 职责                                             |
| ---------------------------- | ------------------------------------------------ |
| `src/App.tsx`                | 页面、活动仓库、Git 操作流程、搜索与偏好         |
| `src/api.ts`                 | 本地 API 和会话令牌                              |
| `src/components/`            | 提交图、Diff、仓库文件、Releases、弹窗及独立样式 |
| `src/styles.css`             | 应用布局、主题和响应式规则                       |
| `shared/types.ts`            | Git 快照等前后端共享类型                         |
| `server/app.ts`              | Express API、安全校验与静态资源                  |
| `server/git-service.ts`      | 仓库注册、快照、Git 操作与并发保护               |
| `server/git-command.ts`      | Git 子进程、参数检查、输出限制与错误转换         |
| `server/demo.ts`             | 初次运行创建真实示例仓库                         |
| `server/repository-files.ts` | 仓库文件列表、目录与文本预览                     |
| `server/releases.ts`         | GitHub Releases API、内存令牌与附件上传          |
| `scripts/`                   | Windows 启停、运行时准备、服务端打包和发布 ZIP   |
| `tests/`                     | 临时真实 Git 仓库和本地 HTTP 集成测试            |

前端使用 React、TypeScript、Vite 和 Lucide；本地服务使用 Express，通过无 shell 的参数数组调用系统 Git。Windows 便携包把构建产物与官方 Node.js 运行时一起分发。

## 修改与验证

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

需要整理格式时运行 `npm run format`。Windows 发布包构建及上传流程见 [发布指南](docs/RELEASING.zh-CN.md)。

测试使用系统临时目录中的真实 Git 工作区与本地裸远程，不应借用个人项目或生产远程。新增 Git 行为时，优先测试真实状态变化和重要失败路径。GitHub API 测试应使用本地模拟响应，避免依赖真实令牌或创建实际 Release。

视觉变更应检查浅色 / 深色、桌面 / 窄屏、加载 / 空状态 / 错误和键盘焦点。现有规范见 [UI 设计说明](docs/UI-DESIGN.md)。

## 配置与数据

- `BRANCHLET_PORT`：普通服务默认 `4317`。开发模式更改此值时同步检查 `vite.config.ts` 的代理。
- `BRANCHLET_DATA_DIR`：本地数据目录；默认位于应用目录的 `.branchlet/`，与调用者当前终端目录分离。
- `BRANCHLET_DEMO=0`：关闭启动时创建示例的流程，便于使用隔离环境做开发验证。
- `.branchlet/`、`.runtime/`、`dist/`、服务端构建输出、`release/` 与 `node_modules/` 属于本地产物，勿提交个人数据或依赖缓存。
- GitHub Releases token 只在服务内存中保存；不要放入源码、日志、截图、测试样例、URL 或配置文件。

Windows 启动器参数：`-NoBrowser` 只启动服务；`-Foreground` 在当前终端运行，按 Ctrl+C 停止；`-Rebuild` 为源码版本重新安装锁定依赖并构建，使用前先停止旧实例。正常后台模式的日志与进程记录位于数据目录，使用 `Stop-Branchlet.cmd` 停止对应实例。

本地服务验证 Host / Origin、跨站标记和会话令牌，写请求使用 JSON 或上传专用的受保护接口。文件路径应保持仓库内约束；不能为了方便预览而暴露 `.git` 或符号链接指向的外部文件。Git 操作仍遵循适用的本机配置与 hooks，接口防护不等同于执行不受信任仓库的沙箱。

## 提交贡献

一次改动围绕一个明确问题，说明改变前后的行为、验证方式和必要限制。功能变化同步修改中英 README 或对应指南。请通过 [项目仓库](https://github.com/Huang-158/Branchlet)提交 Issue 或 Pull Request。

不要提交 `.branchlet` 中的个人仓库位置、真实 GitHub token、凭据、私钥或用户文件。
