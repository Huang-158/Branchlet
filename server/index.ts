import { createApp } from './app.js';
import path from 'node:path';

const port = Number(process.env.BRANCHLET_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('BRANCHLET_PORT 必须是 1024–65535 之间的端口。');
async function main() {
  const appDirectory = process.env.BRANCHLET_APP_DIR
    ? path.resolve(process.env.BRANCHLET_APP_DIR)
    : path.resolve(path.dirname(process.argv[1]), '..');
  const { app } = await createApp({
    dataDir: process.env.BRANCHLET_DATA_DIR
      ? path.resolve(process.env.BRANCHLET_DATA_DIR)
      : path.join(appDirectory, '.branchlet'),
    staticDir: path.join(appDirectory, 'dist'),
    demo: process.env.BRANCHLET_DEMO !== '0',
  });
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(
      `\n  Branchlet Git service → http://127.0.0.1:${port}\n  所有 Git 操作均在本机运行。\n`,
    );
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `端口 ${port} 已被占用。请关闭已有服务或设置 BRANCHLET_PORT。`
        : error,
    );
    process.exitCode = 1;
  });
  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => server.close());
}
main().catch((error) => {
  console.error('[Branchlet]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
