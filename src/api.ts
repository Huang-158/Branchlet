import type { GitAction, Repository, RepoSnapshot } from '../shared/types';
let session: Promise<string> | undefined;
async function token() {
  session ??= fetch('/api/session')
    .then(async (response) => {
      if (!response.ok) throw new Error('无法连接本地 Git 服务');
      return (await response.json()).token as string;
    })
    .catch((error) => {
      session = undefined;
      throw error;
    });
  return session;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.method && options.method !== 'GET') headers['X-Branchlet-Token'] = await token();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 403 && /安全会话已过期/.test(data.error || '') && session) {
      session = undefined;
      headers['X-Branchlet-Token'] = await token();
      const retry = await fetch(`/api${path}`, {
        ...options,
        headers: { ...headers, ...options.headers },
      });
      const retried = await retry.json();
      if (retry.ok) return retried;
      throw new Error(
        [retried.error || '操作未能完成', retried.detail].filter(Boolean).join('\n\n'),
      );
    }
    throw new Error(
      [data.error || data.message || '操作未能完成', data.detail].filter(Boolean).join('\n\n'),
    );
  }
  return data;
}
export const getRepos = () => api<Repository[]>('/repos');
export const getSnapshot = (id: string) => api<RepoSnapshot>(`/repos/${id}/snapshot`);
export const runAction = (id: string, action: GitAction) =>
  api<{ message?: string }>(`/repos/${id}/action`, {
    method: 'POST',
    body: JSON.stringify(action),
  });
