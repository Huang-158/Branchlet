# Contributing

[简体中文](CONTRIBUTING.md) · [English](CONTRIBUTING.en.md) · [Home](README.en.md)

## Development setup

Use Node.js 22+, npm, and Git. From the project root:

```bash
npm ci
npm run dev
```

Vite serves the UI at `http://127.0.0.1:5173`; the Git API runs at `127.0.0.1:4317`. The Windows source launcher can also prepare a runtime. After source changes, use `Start-Branchlet.cmd -Rebuild` to rebuild a regular local run. The portable ZIP is a distribution for end users, not the source development environment.

## Architecture

| Location                     | Responsibility                                                                |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `src/App.tsx`                | Pages, active repository, Git workflows, search, and preferences              |
| `src/api.ts`                 | Local API requests and session token                                          |
| `src/components/`            | Commit graph, diff, repository files, Releases, dialogs, and component styles |
| `src/styles.css`             | Application layout, themes, and responsive rules                              |
| `shared/types.ts`            | Shared Git snapshot and other types                                           |
| `server/app.ts`              | Express routes, request validation, and static assets                         |
| `server/git-service.ts`      | Repository registry, snapshots, Git actions, and mutation locks               |
| `server/git-command.ts`      | Git subprocesses, argument validation, output limits, and errors              |
| `server/demo.ts`             | Initial creation of the real example repository                               |
| `server/repository-files.ts` | Repository directory listings and text previews                               |
| `server/releases.ts`         | GitHub Releases API, in-memory tokens, and asset uploads                      |
| `scripts/`                   | Windows launch/stop, runtime preparation, server bundling, and ZIP packaging  |
| `tests/`                     | Temporary real Git repositories and local HTTP integration tests              |

The frontend uses React, TypeScript, Vite, and Lucide. Express calls the system Git executable with argument arrays and no shell. The Windows package distributes built application files together with the official Node.js runtime.

## Change and verify

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

Use `npm run format` to apply formatting. See the [release guide](docs/RELEASING.en.md) for packaging and publishing.

Tests use temporary real worktrees and local bare remotes. Do not borrow personal repositories or production remotes. Test actual state transitions and meaningful failure cases for new Git behavior. GitHub API tests should use local mock responses rather than real tokens or remotely created releases.

For visual changes, inspect light/dark themes, desktop/narrow layouts, loading/empty/error states, and keyboard focus. The [UI design specification](docs/UI-DESIGN.md) records existing behavior in Chinese.

## Configuration and data

- `BRANCHLET_PORT`: defaults to `4317`; update the Vite proxy when changing the API port in development.
- `BRANCHLET_DATA_DIR`: local application data; defaults to `.branchlet/` next to the application rather than the invoking terminal's working directory.
- `BRANCHLET_DEMO=0`: disables automatic demo creation for an isolated development run.
- `.branchlet/`, `.runtime/`, `dist/`, bundled server output, `release/`, and `node_modules/` are local artifacts. Do not commit personal data or dependency caches.
- GitHub Releases tokens belong only in server memory. Do not put them in source code, logs, screenshots, fixtures, URLs, or configuration files.

Windows launcher options: `-NoBrowser` starts without opening a browser; `-Foreground` runs in the current terminal and stops with Ctrl+C; `-Rebuild` reinstalls locked source dependencies and rebuilds, so stop the old instance first. Normal background mode stores logs and its process record in the data directory; use `Stop-Branchlet.cmd` for that instance.

The local server checks Host/Origin, cross-site request metadata, and session tokens. Mutations use JSON or the protected upload endpoint. Preserve repository path boundaries; do not expose `.git` or outside files through symlinks for preview convenience. Git still follows applicable system configuration and hooks: request validation is not a sandbox for untrusted repositories.

## Submitting a contribution

Keep each change focused on a concrete problem. Explain the before/after behavior, validation, and relevant limits. Update the matching Chinese and English documents when features change. Submit issues and pull requests through the [project repository](https://github.com/Huang-158/Branchlet).

Do not submit personal repository paths from `.branchlet`, tokens, credentials, private keys, or user files.
