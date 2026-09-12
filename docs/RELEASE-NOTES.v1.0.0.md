# Branchlet v1.0.0

## 简体中文

Branchlet 第一版提供在本机浏览器中运行的 Git 图形工作台，覆盖日常仓库管理、代码审阅和 GitHub Release 发布流程。

### 下载与启动

适用于 **Windows x64**。

1. 安装 [Git for Windows](https://git-scm.com/install/windows)，保留 Git Credential Manager，并让 Git 可供命令行及第三方程序使用。
2. 下载本页附件 [Branchlet-1.0.0-windows-x64.zip](https://github.com/Huang-158/Branchlet/releases/download/v1.0.0/Branchlet-1.0.0-windows-x64.zip)，完整解压到有写权限的文件夹。
3. 双击 `Start-Branchlet.cmd`，浏览器会打开本地工作台。使用完毕后双击 `Stop-Branchlet.cmd` 停止服务。

便携包内置 Node.js 运行时和已构建应用，**无需安装 Node.js 或 npm**。关闭浏览器标签页不会停止后台服务。GitHub 自动生成的 “Source code” 压缩包用于开发，请使用上方命名的 Windows 便携 ZIP 直接运行。

可下载 [SHA-256 校验文件](https://github.com/Huang-158/Branchlet/releases/download/v1.0.0/Branchlet-1.0.0-windows-x64.zip.sha256)，并使用 PowerShell 的 `Get-FileHash -Algorithm SHA256` 核对 ZIP。

### 主要功能

- 打开、初始化、克隆和切换本地 Git 仓库，提供可直接练习的示例仓库。
- 在默认文件列表与可展开目录树之间切换，浏览目录并预览文本文件。
- 查看已暂存、未暂存、未跟踪及冲突文件；暂存、取消暂存、审阅 Diff 并提交更改。
- 查看提交关系图谱和提交详情；搜索历史，执行拣选与撤销提交。
- 创建、切换、合并及安全删除分支；管理储藏和标签，单独推送标签。
- 管理远程地址，获取、快进拉取、推送及设置上游；继续或中止进行中的 Git 操作。
- 在界面连接 GitHub，创建 Release 或草稿、上传附件并发布草稿。
- 中文界面、浅色与深色主题、自适应布局，并提供独立的中文和英文安装、Git 连接与使用指南。

### 使用说明

Git 的 HTTPS 认证使用本机 Git Credential Manager，也可使用配置好的 SSH 密钥。应用内的 GitHub Releases 功能需要单独连接 GitHub token，目标仓库需授予 `Contents: Read and write` 权限；令牌仅保存在本地服务内存中，断开连接或重启后清除。每个上传附件最多 **100 MB（100 × 1024 × 1024 字节）**，使用该功能无需安装 GitHub CLI。

仓库列表、示例工作区和服务日志默认保存在应用目录的 `.branchlet/`；可使用 `BRANCHLET_DATA_DIR` 自定义数据位置。外部仓库仍保存在原位置。服务仅监听本机，Git 操作直接作用于所选仓库。

- [中文入门指南](https://github.com/Huang-158/Branchlet/blob/v1.0.0/docs/GETTING-STARTED.zh-CN.md)
- [中文 Release 指南](https://github.com/Huang-158/Branchlet/blob/v1.0.0/docs/RELEASING.zh-CN.md)

## English

The first release of Branchlet provides a Git workbench in your local browser for everyday repository management, code review, and GitHub Release publishing.

### Download and launch

This package targets **Windows x64**.

1. Install [Git for Windows](https://git-scm.com/install/windows). Keep Git Credential Manager enabled and make Git available to command-line and third-party applications.
2. Download [Branchlet-1.0.0-windows-x64.zip](https://github.com/Huang-158/Branchlet/releases/download/v1.0.0/Branchlet-1.0.0-windows-x64.zip) from the release assets and fully extract it into a writable folder.
3. Double-click `Start-Branchlet.cmd` to open the local workbench in your browser. Double-click `Stop-Branchlet.cmd` when finished to stop the service.

The portable package includes the Node.js runtime and the built application. **No Node.js or npm installation is required.** Closing the browser tab does not stop the background service. GitHub's automatic “Source code” archives are for development; use the named Windows portable ZIP above to run the app directly.

Download the [SHA-256 checksum file](https://github.com/Huang-158/Branchlet/releases/download/v1.0.0/Branchlet-1.0.0-windows-x64.zip.sha256) and use PowerShell's `Get-FileHash -Algorithm SHA256` to verify the ZIP.

### Features

- Open, initialize, clone, and switch local Git repositories, with a working example repository for practice.
- Switch between the default file list and an expandable directory tree, navigate folders, and preview text files.
- Review staged, unstaged, untracked, and conflicted files; stage, unstage, inspect diffs, and commit changes.
- Browse commit graphs and details, search history, cherry-pick commits, and revert commits.
- Create, switch, merge, and safely delete branches; manage stashes and tags, including individual tag pushes.
- Configure remotes, fetch, pull with fast-forward checks, push, and set upstream branches; continue or abort ongoing Git operations.
- Connect to GitHub in the app, create releases or drafts, upload assets, and publish drafts.
- Chinese interface, light/dark themes, responsive layout, and separate Chinese and English guides for installation, Git authentication, and everyday use.

### Usage notes

Git HTTPS authentication uses your system Git Credential Manager; configured SSH keys are also supported. The in-app GitHub Releases feature requires a separate GitHub token with `Contents: Read and write` access to the target repository. Tokens stay only in local service memory and are cleared on disconnect or restart. Each uploaded asset is limited to **100 MB (100 × 1024 × 1024 bytes)**. GitHub CLI is not required.

The repository registry, example workspace, and service logs default to `.branchlet/` in the application folder. Set `BRANCHLET_DATA_DIR` to choose another data location. External repositories remain in their original folders. The service listens only on the local machine, and Git operations affect the selected repository directly.

- [English getting-started guide](https://github.com/Huang-158/Branchlet/blob/v1.0.0/docs/GETTING-STARTED.en.md)
- [English Release guide](https://github.com/Huang-158/Branchlet/blob/v1.0.0/docs/RELEASING.en.md)
