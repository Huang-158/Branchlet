# GitHub Releases：连接、创建版本与上传附件

[简体中文](RELEASING.zh-CN.md) · [English](RELEASING.en.md) · [返回首页](../README.md)

本指南区分两项工作：**在 Branchlet 界面中为你的项目创建 GitHub Release**，以及**把 Branchlet 自身打包成 Windows 便携 ZIP**。发布页面直接调用 GitHub API，不要求安装 GitHub CLI（`gh`）。

## 1. 准备仓库和连接

1. 在 Branchlet 打开要发布的实际项目。
2. 在「远程仓库」中配置指向 `github.com` 的 HTTPS 或 SSH 远程地址。示例项目的本地 `origin` 无法提供 GitHub Releases。
3. 打开「GitHub Releases」，核对选择的远程和 `OWNER/REPOSITORY`。
4. 使用 GitHub fine-grained personal access token 连接，按下文仅授权需要发布的仓库。

当前集成针对 GitHub.com，不用于 GitLab、普通 Git 服务器或 GitHub Enterprise 自建域名。应用的 Releases 连接需要令牌；Git 的 HTTPS / SSH 凭据与这份令牌独立。

### 创建访问令牌

在 GitHub 的 **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 中创建令牌，选择正确的资源拥有者和目标仓库，设置有效期，并授予仓库权限 **Contents: Read and write**。组织仓库可能需要管理员审批。详见 [GitHub 令牌管理说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。

点击「连接 GitHub」，将令牌粘贴到「GitHub 访问令牌」输入框并连接。它用于创建版本、读取发布状态和上传附件，不用于修改提交作者或配置系统 Git 登录。令牌只由本地服务按仓库保存在内存中，不写入 `.branchlet`、浏览器持久存储或 Git 配置；点击断开或重启服务后，需要重新连接。当前应用读取公开仓库的 Releases 也需要先连接令牌。

创建 Release 与上传附件通常需要 `Contents` 写权限，官方接口要求见 [创建 Release](https://docs.github.com/en/rest/releases/releases#create-a-release) 和 [上传附件](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset)。

## 2. 先推送代码和标签

Release 用标签标识版本。应用要求目标标签已存在于选定的 GitHub 远程，避免在错误的提交上隐式生成标签。

1. 完成更改并提交，核对当前分支和提交内容。
2. 推送分支，使需要发布的提交到达 GitHub。
3. 打开「标签」，在正确提交上创建标签，例如 `v1.0.0`。
4. 使用标签卡片上的「推送标签」，将该标签发送到目标远程。
5. 返回「GitHub Releases」创建版本。

本地创建标签不会自动发布；分支推送也不等于推送所有标签。若同一仓库配置多个远程，应确保代码、标签与 Release 使用的是同一个目标。

## 3. 创建 Release

点击创建 Release，填写「Git 标签」「版本标题」「发布说明」（Markdown），按需要勾选「保存为草稿」「标记为预发布」。标签例如 `v1.0.0`，标题例如 `Branchlet 1.0.0`，说明可包含更新内容、安装方式和已知限制。

「保存为草稿」默认选中，此时提交按钮为「创建草稿」；取消草稿后为「发布 Release」。需要先上传文件并检查页面时，保持草稿状态创建。草稿尚未成为对读者公开的正式发布；预发布则用于测试版 / 候选版标记，不等于草稿。

核对目标仓库、标签与内容后提交。创建成功会在列表中显示版本和状态；创建失败时读取页面错误详情。相同标签已有 Release 时，应使用现有 Release 上传附件，避免重复创建。

## 4. 上传本地文件

1. 在目标 Release 卡片中点击「选择附件」。
2. 选择一个或多个已经准备好的本地文件，例如 ZIP、校验和、说明文档或安装程序。
3. 核对文件后点击「上传附件」，等待完成，检查附件名称与大小；可打开 GitHub 页面确认下载条目。

应用要求附件非空，**单个附件最多 100 MB（100 × 1024 × 1024 字节）**。上传是把所选文件内容发送给 GitHub，不是把文件提交进 Git 仓库。相同名称的附件冲突会由 GitHub 拒绝，应用不会自动替换现有附件；可使用不同名称，或在 GitHub 页面先处理旧附件。

上传请求有独立超时，较大文件受本机网络速度影响；超时或网络中断后，先刷新并查看附件列表，再决定是否重试，避免重复上传。

## 5. 发布草稿

附件准备完成后，点击草稿卡片的「发布草稿」，核对提示并确认；也可通过卡片链接在 GitHub 页面审阅。发布会改变该 Release 的可见状态，读者可按仓库权限访问版本及附件。

Release 页面不提供通用 GitHub 仓库管理，也不会帮你初始化 GitHub 远程仓库。发布说明编辑、附件重命名 / 删除等未提供的管理动作可在 GitHub 页面完成。

## 6. 为 Branchlet 构建 Windows 便携包

此部分面向维护者。请在 Windows x64 或 Windows CI runner 上操作，准备 Node.js 22+、npm、Git 以及联网下载运行时的能力。

```bash
npm ci
npm run typecheck
npm test
npm run package:windows
```

打包命令会构建前端和服务端、准备固定版本的官方 Node.js Windows 运行时，并校验其 SHA-256，然后生成：

```text
release/
├── Branchlet-1.0.0-windows-x64.zip
└── Branchlet-1.0.0-windows-x64.zip.sha256
```

文件名版本取自 `package.json`，上面以 `1.0.0` 为例。ZIP 包含 `Start-Branchlet.cmd`、`Stop-Branchlet.cmd`、运行时、构建产物、中英文文档和第三方许可证说明。用户完整解压后，只需安装 Git for Windows 即可运行。

发布前在独立文件夹完整解压并启动一次，检查页面、示例仓库、仓库文件预览及停止脚本。不要把自己的 `.branchlet/`、令牌或项目代码打进包。可用 PowerShell 核对 ZIP 的 SHA-256 与 `.sha256` 文件：

```powershell
Get-FileHash -LiteralPath '.\release\Branchlet-1.0.0-windows-x64.zip' -Algorithm SHA256
Get-Content -LiteralPath '.\release\Branchlet-1.0.0-windows-x64.zip.sha256'
```

随后在 [Huang-158/Branchlet](https://github.com/Huang-158/Branchlet/releases) 创建对应 Release，上传 ZIP 和 `.sha256`，在发布说明中提供「安装 Git for Windows → 解压 → 双击 Start」三步说明。

项目另提供手动触发的 `.github/workflows/windows-portable.yml`。Actions 可用时，可在 [Windows 便携包工作流](https://github.com/Huang-158/Branchlet/actions/workflows/windows-portable.yml)页面手动运行；它执行检查、测试、打包并保存工作流产物，**不会自动创建公开 Release**。下载工作流产物后，仍需选择实际 Release 并上传。

## 常见问题

| 提示 / 现象                 | 检查内容                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 没有可用的 GitHub 远程      | 添加实际 `github.com` 仓库地址；示例本地 `origin` 不支持 Releases                                          |
| 401 / token 失效            | 令牌是否过期、撤销或输入错误；重新连接                                                                     |
| 403 / 404                   | 账号是否有目标仓库权限、token 是否选择该仓库及 Contents 读写、组织是否批准                                 |
| 标签不存在                  | 先把对应本地标签推送到当前选定的 GitHub 远程                                                               |
| 创建版本涉及工作流权限      | 若目标提交修改 `.github/workflows`，GitHub 可能要求额外 `Workflows: write`；仅在确有此需求时按官方错误处理 |
| 标签已有 Release / 附件重名 | 使用已有版本或调整文件名；需要替换时在 GitHub 页面处理旧附件                                               |
| 文件超过限制                | 每个附件需不超过 100 MB；将构建内容合理拆分或使用其他分发方式                                              |
| 重启后需要重新输入 token    | 属于预期行为；令牌仅在本次服务进程内保存                                                                   |
| 用户解压后无法运行          | 确认分发完整 ZIP、Git 已安装、目录可写，并检查 `.branchlet/server-error.log`                               |

Git 的克隆 / 推送登录问题见 [Git 连接指南](GETTING-STARTED.zh-CN.md)，它与 Release token 分开配置。
