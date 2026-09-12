# GitHub Releases: connect, create a version, and upload assets

[简体中文](RELEASING.zh-CN.md) · [English](RELEASING.en.md) · [Home](../README.en.md)

This guide covers two separate tasks: **publishing your project's GitHub Release from Branchlet**, and **packaging Branchlet itself as a portable Windows ZIP**. The Releases page calls GitHub directly; GitHub CLI (`gh`) is not required.

## 1. Prepare the repository and connection

1. Open the actual project you want to publish.
2. Configure a GitHub.com HTTPS or SSH remote in **远程仓库** (Remotes). The example repository's local `origin` cannot provide GitHub Releases.
3. Open **GitHub Releases** and verify the selected remote and `OWNER/REPOSITORY`.
4. Connect using a fine-grained personal access token authorized for that repository.

The integration targets GitHub.com, not GitLab, generic Git servers, or a self-hosted GitHub Enterprise domain. The app's Releases connection requires a token. It is separate from system Git HTTPS/SSH authentication.

### Create an access token

In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens**. Select the correct resource owner and repository, choose an expiration, and grant **Contents: Read and write**. Organization repositories may require approval. See [GitHub's token documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

Click **连接 GitHub** (Connect GitHub) and paste the token into **GitHub 访问令牌** (GitHub access token). It is used for Release operations, not commit author settings or system Git login. The local service stores it only in memory, separately for each repository. It is not written to `.branchlet`, persistent browser storage, or Git configuration. Disconnecting or restarting the service clears it. The app currently requires this connection even to list releases from public repositories.

Creating releases and uploading assets normally require Contents write permission. See the official [Create a release](https://docs.github.com/en/rest/releases/releases#create-a-release) and [Upload a release asset](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset) endpoints.

## 2. Push code and the tag first

A Release identifies a version by its tag. Branchlet requires that tag to already exist on the selected GitHub remote, avoiding an implicit tag at an unintended commit.

1. Finish and commit the changes; verify the current branch and contents.
2. Push the branch so the intended commit is available on GitHub.
3. Open **标签** (Tags) and create a tag at the correct commit, such as `v1.0.0`.
4. Use **推送标签** (Push tag) on its card to send it to the target remote.
5. Return to **GitHub Releases** to create the release.

A local tag is not published automatically, and pushing a branch does not mean pushing every tag. With multiple remotes, keep the code, tag, and Release target consistent.

## 3. Create a release

Use the create action and fill **Git 标签** (Git tag), **版本标题** (Title), and **发布说明** (Markdown notes). Choose **保存为草稿** (Save as draft) and **标记为预发布** (Prerelease) as appropriate. For example, use `v1.0.0` as the tag and `Branchlet 1.0.0` as the title; explain changes, installation, and known limits in the notes.

Draft is enabled by default, making the submit button **创建草稿** (Create draft). Clearing it changes the button to **发布 Release** (Publish Release). Keep draft enabled to upload files and review before publication. A draft is not a published version for readers; prerelease labels a test/candidate version and is a separate setting.

Check the repository, tag, and text before submitting. The new version and status appear in the list on success. Read the detailed error if creation fails. If a Release already exists for that tag, use that release rather than creating a duplicate.

## 4. Upload local files

1. Click **选择附件** (Choose assets) on the target Release card.
2. Select one or more prepared local files, such as a ZIP, checksum, document, or installer.
3. Check the selection and click **上传附件** (Upload assets). Wait for completion, check names and sizes, and open GitHub to verify download entries if needed.

Assets must be nonempty, and Branchlet limits **each asset to 100 MB (100 × 1024 × 1024 bytes)**. Upload sends the selected file to GitHub; it does not commit it into Git history. Duplicate asset names are rejected rather than silently replaced. Use a different name, or handle the old asset on GitHub before retrying.

Uploads have a separate timeout. For a network interruption or timeout, refresh and inspect the asset list before retrying so you know whether the upload completed.

## 5. Publish a draft

When the assets are ready, click **发布草稿** (Publish draft), review the prompt, and confirm. You can also open its GitHub link for review. Publication changes the release's visibility; readers can access it and its assets according to repository permissions.

The Releases page is not a complete GitHub repository manager and does not create the remote repository itself. Manage unsupported actions, such as editing existing notes or renaming/deleting assets, on GitHub.

## 6. Build Branchlet's portable Windows package

This section is for maintainers. Build on Windows x64 or a Windows CI runner with Node.js 22+, npm, Git, and network access for the runtime download.

```bash
npm ci
npm run typecheck
npm test
npm run package:windows
```

Packaging builds the frontend and server, prepares a pinned official Node.js Windows runtime, verifies its SHA-256, and produces:

```text
release/
├── Branchlet-1.0.0-windows-x64.zip
└── Branchlet-1.0.0-windows-x64.zip.sha256
```

The version comes from `package.json`; `1.0.0` is an example. The ZIP includes `Start-Branchlet.cmd`, `Stop-Branchlet.cmd`, the runtime, built application, Chinese/English documentation, and third-party license notices. End users only need Git for Windows in addition to the fully extracted package.

Before publishing, extract into a separate folder and verify startup, the demo, file previews, and the stop script. Do not package personal `.branchlet/` data, tokens, or user projects. Compare the ZIP's SHA-256 with the checksum file using PowerShell:

```powershell
Get-FileHash -LiteralPath '.\release\Branchlet-1.0.0-windows-x64.zip' -Algorithm SHA256
Get-Content -LiteralPath '.\release\Branchlet-1.0.0-windows-x64.zip.sha256'
```

Create the corresponding Release in [Branchlet](https://github.com/Huang-158/Branchlet/releases), upload the ZIP and `.sha256`, and describe the three installation steps: install Git for Windows, extract, and double-click Start.

The project also provides the manually triggered [Windows portable workflow](https://github.com/Huang-158/Branchlet/actions/workflows/windows-portable.yml) in `.github/workflows/windows-portable.yml`. With Actions enabled, it can run checks, tests, packaging, and save a workflow artifact. It **does not automatically publish a Release**. Download the workflow artifact, then upload its package to the intended Release.

## Troubleshooting

| Symptom                            | Check                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| No usable GitHub remote            | Add a real GitHub.com remote; the demo's local origin does not support Releases                                                                    |
| 401 / invalid token                | Expiration, revocation, or typing errors; reconnect with a valid token                                                                             |
| 403 / 404                          | Account access, selected repository, Contents read/write permission, and organization approval                                                     |
| Tag not found                      | Push the local tag to the currently selected GitHub remote first                                                                                   |
| Workflow permission error          | If the target commit changes `.github/workflows`, GitHub may also require Workflows write permission; grant it only when needed for that operation |
| Existing release / duplicate asset | Use the existing release or another filename; manage replacement assets on GitHub                                                                  |
| Asset exceeds the limit            | Each file must be at most 100 MB; split the distribution appropriately or use another channel                                                      |
| Token needed again after restart   | Expected: tokens live only in the current service process                                                                                          |
| Recipient cannot launch the ZIP    | Check full extraction, installed Git, write access, and `.branchlet/server-error.log`                                                              |

For clone/push login problems, see the [Git connection guide](GETTING-STARTED.en.md); system Git credentials and Release tokens are configured separately.
