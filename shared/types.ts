export interface Repository {
  id: string;
  name: string;
  path: string;
  isDemo?: boolean;
}
export interface FileChange {
  path: string;
  status: string;
  oldPath?: string;
  additions?: number;
  deletions?: number;
}
export interface GitStatus {
  branch: string;
  head: string;
  upstream?: string;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: FileChange[];
  conflicted: FileChange[];
  clean: boolean;
  operation?: 'merge' | 'cherry-pick' | 'revert' | 'rebase';
}
export interface Commit {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  email: string;
  date: string;
  refs: string[];
}
export interface Branch {
  name: string;
  current: boolean;
  remote: boolean;
  hash: string;
  subject: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  date?: string;
}
export interface Stash {
  ref: string;
  hash: string;
  message: string;
  date: string;
}
export interface Tag {
  name: string;
  hash: string;
  message?: string;
  date?: string;
}
export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}
export interface RepoSnapshot {
  repo: Repository;
  status: GitStatus;
  commits: Commit[];
  branches: Branch[];
  stashes: Stash[];
  tags: Tag[];
  remotes: Remote[];
  totalCommits: number;
}
export interface GitAction {
  action: string;
  files?: string[];
  message?: string;
  name?: string;
  startPoint?: string;
  remote?: string;
  url?: string;
  ref?: string;
  hash?: string;
  includeUntracked?: boolean;
}
export interface DirectoryListing {
  path: string;
  parent: string | null;
  roots: { name: string; path: string }[];
  directories: { name: string; path: string; isRepository: boolean }[];
}
