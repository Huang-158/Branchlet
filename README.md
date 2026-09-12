# Branchlet

[简体中文](README.md) · [English](README.en.md)

**每一次改变，都清晰可见。** Branchlet 是一个在本机运行的 Git 图形工作台：浏览仓库文件和提交图谱、审阅差异、管理分支，并在应用中创建 GitHub Release、上传发布附件。

## Windows：只需安装 Git

1. 安装 [Git for Windows](https://git-scm.com/install/windows)，保留 Git Credential Manager，并让 Git 可供命令行及第三方程序使用。
2. 从 [v1.0.0 发布页面](https://github.com/Huang-158/Branchlet/releases/tag/v1.0.0)下载 [Branchlet-1.0.0-windows-x64.zip](https://github.com/Huang-158/Branchlet/releases/download/v1.0.0/Branchlet-1.0.0-windows-x64.zip)，并完整解压到有写权限的文件夹。
3. 双击解压目录中的 `Start-Branchlet.cmd`，浏览器会打开 [http://127.0.0.1:4317](http://127.0.0.1:4317)。

便携包自带 Node.js 运行时和已构建应用，**无需手动安装 Node.js 或 npm**。第一次启动会创建可直接练习的真实示例仓库。安装、Git 登录、新建项目和第一次推送，请按 [入门指南](docs/GETTING-STARTED.zh-CN.md) 操作。

使用完毕后双击同目录的 `Stop-Branchlet.cmd` 停止后台服务；关闭浏览器标签页不会停止服务。

项目仓库：[Branchlet](https://github.com/Huang-158/Branchlet)。GitHub 自动生成的 “Source code” 压缩包属于源码，不是上述便携包。版本详情见 [v1.0.0 发布说明](docs/RELEASE-NOTES.v1.0.0.md)；可下载 [SHA-256 校验文件](https://github.com/Huang-158/Branchlet/releases/download/v1.0.0/Branchlet-1.0.0-windows-x64.zip.sha256)核对下载完整性。

## 功能

| 工作区           | 已实现能力                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------- |
| 仓库管理         | 打开、新建、克隆、切换和移除仓库；本地目录选择、Windows 盘符切换及路径跳转               |
| 仓库文件         | 文件列表 / 目录树切换、进入文件夹、返回上级、文本文件预览                                |
| 工作区更改       | 已暂存 / 未暂存 / 未跟踪 / 冲突分类；文件级暂存、取消暂存、确认后丢弃；统一 Diff 和提交  |
| 提交历史         | 真实父子关系图谱、提交详情、作者 / 信息 / 哈希搜索、拣选和撤销提交                       |
| 分支、储藏、标签 | 创建 / 切换 / 合并 / 安全删除分支；保存 / 应用 / 弹出储藏；创建 / 删除本地标签及推送标签 |
| 远程同步         | 获取、快进拉取、推送及上游设置；远程配置管理                                             |
| GitHub Releases  | 使用独立令牌连接仓库；查看、创建 Release，上传本地附件                                   |
| 操作恢复         | 检测合并 / 拣选 / 撤销 / 变基，解决并暂存冲突后继续或确认中止                            |
| 界面与偏好       | 中文界面、浅 / 深色、自适应布局、快捷搜索、操作记录、当前仓库作者配置                    |

文件浏览与「工作区更改」分开：前者查看项目内容，后者专注需要提交的改动。完整功能语义、历史 / Diff 限制与故障排查见 [入门指南](docs/GETTING-STARTED.zh-CN.md)。

## 三种身份各有用途

- **提交作者**：在设置中填写名称和邮箱，用于提交记录。
- **Git 远程认证**：HTTPS 使用本机 Git Credential Manager，或使用已配置的 SSH 密钥；公开仓库克隆一般不需要登录。
- **GitHub Releases 连接**：使用 GitHub fine-grained token，授予目标仓库 `Contents: Read and write`；不需要安装 `gh`。令牌仅由本地服务按仓库保存在内存中，断开连接或重启服务后清除。

推送与 Release 会向选定的远程仓库发送内容。其余本地操作直接作用于所选项目的真实 Git 工作区。具体连接与发布流程见 [GitHub 发布指南](docs/RELEASING.zh-CN.md)。

## 源码运行与开发

Windows 源码目录同样可双击 `Start-Branchlet.cmd`：没有兼容运行时时，启动器会准备缓存的便携 Node.js，并在首次运行时安装依赖和构建，因此首次需要联网。源码更新后可运行 `Start-Branchlet.cmd -Rebuild` 重新构建。准备修改代码的开发者可使用 Node.js 22+、npm 和 Git：

```bash
npm ci
npm run dev
```

开发地址：[http://127.0.0.1:5173](http://127.0.0.1:5173)。构建后运行使用 `npm run build`、`npm start`，默认地址为 `4317`。

```bash
npm run typecheck
npm test
npm run build
npm run package:windows
```

Windows 便携 ZIP 输出到 `release/`。测试使用临时真实 Git 仓库；架构、提交流程与开发约定见 [贡献指南](CONTRIBUTING.md)。

## 数据与说明

本地仓库列表、示例工作区和示例裸远程保存在应用目录的 `.branchlet/`；可通过 `BRANCHLET_DATA_DIR` 指定其他目录。示例会保留操作进度，外部仓库仍位于原位置。服务只监听本机地址，界面不是公网托管服务。

侧栏的移除按钮可将普通仓库或示例从列表中移除，保留磁盘上的文件和 Git 历史。移除示例后，重启也不会自动添加；需要时可按原路径重新打开。

- [安装、连接 Git 与使用](docs/GETTING-STARTED.zh-CN.md)
- [创建 Release、上传附件与打包](docs/RELEASING.zh-CN.md)
- [UI 设计与交互规范](docs/UI-DESIGN.md)
- [贡献指南](CONTRIBUTING.md)
