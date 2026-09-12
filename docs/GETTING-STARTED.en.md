# Getting started: installation, Git connections, and projects

[简体中文](GETTING-STARTED.zh-CN.md) · [English](GETTING-STARTED.en.md) · [Home](../README.en.md)

This guide is for Windows users trying a Git GUI for the first time. Branchlet shows its interface in your browser and uses the installed Git executable for real operations. No Branchlet account is required. The current application interface is Chinese; the labels below match it.

## 1. Install and launch

### Portable Windows package

1. Install Git from the [official Git for Windows download page](https://git-scm.com/install/windows). Keep Git Credential Manager enabled and allow Git to be used from the command line and third-party software.
2. Obtain `Branchlet-<version>-windows-x64.zip` from the maintainer. If this project has published packages, download that asset from its actual Releases page. GitHub's automatically generated “Source code (zip)” is a different distribution.
3. **Extract the entire ZIP** into a writable folder, such as `D:\Apps\Branchlet`. Do not run it inside the archive or copy only the launcher.
4. Double-click `Start-Branchlet.cmd` and wait for the browser to open the [local workbench](http://127.0.0.1:4317). Open that address manually if needed.

The package includes the application and Node.js runtime. Git for Windows is the only additional software you need to install: no separate Node.js or `npm install` is required. Local browsing and example operations work offline. Remote repositories, authentication, and GitHub Releases require network access.

To stop a launcher-managed instance, double-click `Stop-Branchlet.cmd` from the same application folder. Closing a browser tab does not stop the local service.

### If you only have source code

Extract the complete source and double-click its `Start-Branchlet.cmd`. The launcher checks the bundled runtime, cached runtime, and compatible system Node.js in that order; if none is available, it prepares a cached portable runtime from the official source. The first source launch installs dependencies and builds the application, so it needs internet access and takes longer than the portable package. You still do not have to install Node.js manually. After source updates, stop the old instance and run `Start-Branchlet.cmd -Rebuild` to reinstall locked dependencies and rebuild.

For command-line development, see [Contributing](../CONTRIBUTING.en.md). Development uses port `5173`; regular and portable runs use `4317`.

## 2. Practice with the example

The first launch opens `atlas-workspace`, an independent real Git repository with commits, branches, a tag, a stash, pending files, and an `origin` pointing to a local bare repository.

1. Open **仓库文件** (Repository files), switch between list and tree views, and select a text file to preview it.
2. Open **工作区更改** (Changes) and select a file. The right-hand diff shows additions in green and deletions in red.
3. Click the file's `+` button to stage it, or use **全部暂存** (Stage all).
4. Enter a message such as `docs: create my first GUI commit` and click the commit button.
5. Open **提交历史** (History), select the new commit, and inspect its author, hash, and changes.

Pushing this example updates only its local demo remote. It does not publish to GitHub, and restarting preserves your practice work.

To dismiss the example, click its remove button in the sidebar and confirm. It disappears from the repository list and stays dismissed after restart. Its files, commits, and practice progress remain on disk. To use it again, select its original path with **打开仓库** (Open repository); by default, it lives in `demo/` inside the application data directory.

## 3. Open, create, or clone a project

| Your situation                             | Action                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| You already have a local Git repository    | Use **打开仓库** (Open repository), then enter or select its folder                                  |
| You have a normal folder to start tracking | Choose **新建仓库** (New repository) and select the folder; the default initial branch is `main`     |
| You want a new empty project folder        | Enter a complete new folder path in **新建仓库**, then create files with your editor                 |
| The project already exists remotely        | Choose **克隆仓库** (Clone repository), paste its clone URL, and choose a new or empty target folder |

### Choose a drive or enter a path

Click the folder browser beside the repository path, select an accessible Windows drive such as `C:\` or `D:\`, and navigate to your project folder. You can also enter a complete path such as `D:\projects` in the browser's address field and click the go button or press `Enter`, then select the current folder. If a drive or directory is unavailable, check that the disk is connected and your user account can access it.

For a folder that does not exist yet, enter its complete new path directly in the repository path field, such as `D:\projects\my-project`. The folder browser selects existing directories.

Check the path and current branch in the repository toolbar. Operations modify that project's real working tree, index, and Git history. The file browser is for reading; create and edit files in your usual editor.

Every repository has a remove button in the sidebar. Removing it only deletes its entry from the application list; files and Git history remain on disk, and you can open the original path again. Removing the active repository switches to another repository. If the list becomes empty, you can still open, initialize, or clone a project.

### Set the commit author

Open **设置** (Settings), enter your name and email, and save. These values apply to this repository and become part of future commits. They are **not login credentials** and do not grant remote push access.

## 4. Connect Git remotes

Git stores local history; hosting services such as GitHub and GitLab provide remote repositories. Create or find the target repository on your chosen service and copy its HTTPS or SSH clone URL.

### Start with HTTPS

Git for Windows includes Git Credential Manager (GCM). It can open a browser when authentication is required and reuse saved credentials. Public read-only clones normally do not require login. See [GitHub's credential documentation](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git).

Branchlet disables interactive terminal credential prompts in its Git subprocesses. If a private clone, pull, or push fails to authenticate, first sign in from a separate PowerShell or Git Bash window. Replace `OWNER/REPOSITORY` below with **your actual repository that your account can access**:

```bash
git ls-remote https://github.com/OWNER/REPOSITORY.git
```

For a repository that requires authentication, complete the GCM browser prompt and retry in Branchlet after the command succeeds. A public repository may return results without prompting. If pushing to it still needs authentication, run `git credential-manager github login`, complete sign-in, and retry. Do not put a password or token in the remote URL.

### Optional: existing SSH setup

If you already use SSH keys, a URL such as `git@github.com:OWNER/REPOSITORY.git` works with your existing configuration. Complete initial host trust or key-passphrase prompts in a separate terminal first. See the [GitHub SSH guide](https://docs.github.com/en/authentication/connecting-to-github-with-ssh) for key setup.

### First push from a new local project

1. Create the remote repository on GitHub or your hosting service. When local history already exists, an empty remote without an initial README/license avoids an unnecessary initial history divergence.
2. Open the local project in Branchlet, set its author, stage files, and create at least one commit.
3. Open **远程仓库 → 添加远程** (Remotes → Add remote). Use `origin` as the name and the actual clone URL as the address.
4. Click **推送** (Push), check the repository and branch, and confirm. A successful push also sets the upstream.

During regular work, **获取** (Fetch) updates remote references; **拉取** (Pull) fast-forwards the current branch; **推送** (Push) sends local commits. Ahead/behind counts use fetched references. Pull uses `--ff-only`, so divergent histories require deliberate branch integration according to your project's workflow.

## 5. Everyday work

| Task                       | Method and effect                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Read project files         | **仓库文件** offers list/tree navigation and text previews; ignored content and internal `.git` files are not ordinary browser entries |
| Review changes             | **工作区更改** separates unstaged and staged changes; selecting the same file in different groups shows the respective diff            |
| Commit selected files      | Stage only the required files, then enter a message and commit; staging currently operates on whole files                              |
| Unstage                    | Cancel staging from the staged list; working-tree contents remain                                                                      |
| Discard                    | Confirm the discard action; tracked files lose unstaged edits and untracked files are deleted                                          |
| Change tasks               | Commit or stash first, then create/switch branches; creating a branch switches to it                                                   |
| Merge                      | Merge the selected branch into the current one; safe deletion rejects unmerged branches                                                |
| Save unfinished work       | Stashes include tracked and untracked files; Apply keeps the record, while Pop removes it after successful application                 |
| Undo a historical change   | Revert in commit details creates a new inverse commit, preserving existing history                                                     |
| Publish downloadable files | Use **GitHub Releases**; see the [release guide](RELEASING.en.md)                                                                      |

After editing externally, click **刷新** (Refresh). The application does not continuously watch the filesystem.

### Resolving conflicts

Conflicted files are marked in Changes. A pending merge, cherry-pick, revert, or rebase also shows an operation banner.

1. Click **查看工作区** (View workspace) and resolve `<<<<<<<`, `=======`, and `>>>>>>>` markers in your editor.
2. Save, refresh, and stage the resolved files.
3. Once all conflicts are staged as resolved, click **继续** (Continue) in the banner. Repeat if another step produces conflicts.
4. To abandon the operation, choose **中止操作** (Abort) and confirm. Changes made while resolving conflicts may be discarded.

The app can continue or abort a rebase started externally, but cannot initiate a rebase or edit its interactive plan. Stash conflicts generally do not create the same sequence banner; resolve and stage them, then commit as appropriate.

## 6. Keyboard shortcuts

| Shortcut                  | Action                                              |
| ------------------------- | --------------------------------------------------- |
| `Ctrl+K` / `⌘+K`          | Search actions, loaded commits, or local branches   |
| `Ctrl+R` / `⌘+R`          | Refresh the active repository                       |
| `Ctrl+Enter` / `⌘+Enter`  | Commit staged changes from the commit message field |
| `Esc`                     | Close an idle modal or popover                      |
| `Tab` / `Shift+Tab`       | Move keyboard focus                                 |
| `↑` / `↓`, `Home` / `End` | Select commits in the graph                         |
| `←` / `→`                 | Switch tabs in the repository dialog                |

## 7. Data, updates, and limits

By default, data is stored in `.branchlet/` next to the application: `repos.json` records repository paths, `demo/` contains the demo worktree, and `demo-origin.git/` contains its remote. External repositories are not copied. Preserve this directory when replacing a portable package; do not overwrite it with an empty directory. Set `BRANCHLET_DATA_DIR` to keep data elsewhere.

For example, start with a custom data directory from PowerShell:

```powershell
$env:BRANCHLET_DATA_DIR = 'D:\BranchletData'
.\Start-Branchlet.cmd
```

Theme and active-repository preferences use browser storage. Operation history lasts for the current page session. GitHub Releases tokens are held only in local server memory and cleared on disconnect or server restart.

- History loads up to 100 commits across references, in topological order, excluding stashes. Search covers loaded records; there is no pagination.
- Diffs use unified text view. There is no editor, three-way merge editor, line staging, or image comparison.
- The file browser lists up to 1,000 entries per directory and previews the first 1 MB / 20,000 lines of text. Binary/non-UTF-8 content shows a notice; symlinks are listed but not followed for preview.
- Git output is limited to 4 MB. Regular commands time out after 30 seconds and clone/remote commands after 120 seconds. A file action accepts up to 2,000 paths.
- There is no force push, hard reset, amend, branch rename, remote tag deletion, or PR/Issue interface. Tag push and GitHub Releases have their own actions.
- The Windows ZIP targets x64 and uses a browser interface, rather than an Electron/Tauri installer. The local server is not intended for public hosting.

## 8. Troubleshooting

| Symptom                              | What to do                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git cannot be found                  | Install Git for Windows, verify `git --version` in a new terminal, and reopen the launcher                                                                           |
| Node.js is not installed             | Use the portable package, or let the source launcher prepare its runtime; the latter needs initial internet access                                                   |
| Launcher fails                       | Fully extract into a writable folder; inspect the launcher or `.branchlet/server-error.log`, or run `Start-Branchlet.cmd -Foreground` to see service output directly |
| Page does not open                   | Check that the service is running, open `http://127.0.0.1:4317`, and check for a port conflict                                                                       |
| Commit needs an author               | Set the repository's author name and email in Settings                                                                                                               |
| Remote authentication fails          | Complete system GCM/SSH authentication first; author settings and the Release token do not replace Git authentication                                                |
| Pull cannot fast-forward             | Fetch and inspect both histories, then integrate according to the project's workflow                                                                                 |
| A recently edited file is absent     | Refresh, check `.gitignore`, and verify the selected repository and branch                                                                                           |
| Release returns 403/404              | Check repository selection, token permissions, and organization approval; see the release guide                                                                      |
| Session expires after server restart | Fully reload the browser page; in-app `Ctrl+R` only refreshes repository data                                                                                        |
| Git reports dubious ownership        | Check ownership and trust settings; trust only repositories you have verified                                                                                        |

See [Contributing](../CONTRIBUTING.en.md) for development configuration and the [UI specification](UI-DESIGN.md) for design details (Chinese).
