# Branchlet

[简体中文](README.md) · [English](README.en.md)

**See every change clearly.** Branchlet is a local Git workbench for browsing repository files and commit graphs, reviewing changes, managing branches, and creating GitHub Releases with uploaded assets.

## Windows: install Git, then launch

1. Install [Git for Windows](https://git-scm.com/install/windows). Keep Git Credential Manager enabled and make Git available to command-line and third-party applications.
2. Download [Branchlet-1.0.0-windows-x64.zip](https://github.com/Huang-158/Branchlet/releases/download/v1.0.0/Branchlet-1.0.0-windows-x64.zip) from the [v1.0.0 release page](https://github.com/Huang-158/Branchlet/releases/tag/v1.0.0) and extract the entire archive into a writable folder.
3. Double-click `Start-Branchlet.cmd` in the extracted folder. Your browser opens [http://127.0.0.1:4317](http://127.0.0.1:4317).

The portable package includes Node.js and the built application. **You do not need to install Node.js or npm yourself.** The first launch creates a real example repository to explore. Follow the [getting-started guide](docs/GETTING-STARTED.en.md) for installation, Git authentication, project creation, and your first push.

Double-click `Stop-Branchlet.cmd` in the same folder to stop the background service. Closing the browser tab does not stop it.

Project repository: [Branchlet](https://github.com/Huang-158/Branchlet). GitHub's automatic “Source code” archives are source distributions, not the portable package described above. See the [v1.0.0 release notes](docs/RELEASE-NOTES.v1.0.0.md) for details, and download the [SHA-256 checksum file](https://github.com/Huang-158/Branchlet/releases/download/v1.0.0/Branchlet-1.0.0-windows-x64.zip.sha256) to verify the archive.

## Features

| Area                    | Implemented features                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Repositories            | Open, initialize, clone, and switch repositories; browse local folders                                                            |
| Repository files        | Switch between list and tree views, navigate folders, and preview text files                                                      |
| Changes                 | Staged, unstaged, untracked, and conflicted files; file-level staging and unstaging; confirmed discard; unified diffs and commits |
| History                 | Graphs based on actual parent relationships; commit details; author/message/hash search; cherry-pick and revert                   |
| Branches, stashes, tags | Create/switch/merge/safely delete branches; save/apply/pop stashes; create/delete local tags and push tags                        |
| Remotes                 | Fetch, fast-forward-only pull, push and upstream setup; remote configuration                                                      |
| GitHub Releases         | Connect with a separate token; list/create releases and upload local assets                                                       |
| Operation recovery      | Detect merge/cherry-pick/revert/rebase operations; continue after resolving and staging conflicts, or confirm an abort            |
| Interface               | Chinese UI, light/dark themes, responsive layout, quick search, operation history, and repository-local author settings           |

Repository browsing and the Changes page are separate: one shows project contents, while the other focuses on pending work. See the [getting-started guide](docs/GETTING-STARTED.en.md) for behavior, limits, and troubleshooting.

## Three separate kinds of identity

- **Commit author:** the name and email in Settings become part of commit records.
- **Git remote authentication:** use the system Git Credential Manager for HTTPS, or your configured SSH key. Public clones normally need no login.
- **GitHub Releases connection:** use a fine-grained token with `Contents: Read and write` for the selected repository. No `gh` installation is required. The local service stores this token only in memory, separately for each repository, and clears it when disconnected or restarted.

Push and Release actions send content to the selected remote service. Local Git operations affect the selected project's real files and repository. See the [release guide](docs/RELEASING.en.md) for connection and publishing steps.

## Running from source

On Windows, you can also double-click `Start-Branchlet.cmd` in the source directory. If a compatible runtime is absent, the launcher prepares a cached portable Node.js runtime; the first source launch installs dependencies and builds the app, so internet access is needed initially. After source updates, run `Start-Branchlet.cmd -Rebuild`. For development, use Node.js 22+, npm, and Git:

```bash
npm ci
npm run dev
```

Development URL: [http://127.0.0.1:5173](http://127.0.0.1:5173). For a built local run, use `npm run build` followed by `npm start`; the default port is `4317`.

```bash
npm run typecheck
npm test
npm run build
npm run package:windows
```

Portable Windows ZIP files are written to `release/`. Tests use temporary real Git repositories. See [Contributing](CONTRIBUTING.en.md) for architecture and development practices.

## Data and documentation

The repository registry, demo workspace, and demo bare remote live in `.branchlet/` next to the application. Set `BRANCHLET_DATA_DIR` to use another directory. Example progress persists; external repositories remain at their original paths. The server listens on the local machine only.

- [Install, connect Git, and use the app](docs/GETTING-STARTED.en.md)
- [Create releases, upload assets, and build packages](docs/RELEASING.en.md)
- [UI design specification](docs/UI-DESIGN.md) — Chinese
- [Contributing](CONTRIBUTING.en.md)
