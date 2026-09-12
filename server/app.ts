import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from './git-command.js';
import { GitService } from './git-service.js';
import { createReleasesRouter } from './releases.js';
import { createRepositoryFilesRouter } from './repository-files.js';

export interface AppOptions {
  dataDir?: string;
  demo?: boolean;
  staticDir?: string;
}
const allowedOrigins = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4317',
  'http://localhost:4317',
]);
if (/^\d{4,5}$/.test(process.env.BRANCHLET_PORT ?? '')) {
  allowedOrigins.add(`http://127.0.0.1:${process.env.BRANCHLET_PORT}`);
  allowedOrigins.add(`http://localhost:${process.env.BRANCHLET_PORT}`);
}

export async function createApp(options: AppOptions = {}) {
  const service = new GitService(
    options.dataDir ?? path.resolve('.branchlet'),
    options.demo ?? true,
  );
  await service.initialize();
  const app = express();
  const token = randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use((req: Request, res: Response, next: NextFunction) => {
    let hostname = '';
    try {
      hostname = new URL(`http://${req.headers.host ?? ''}`).hostname;
    } catch {
      /* Invalid Host. */
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname))
      return res.status(403).json({ error: '此服务仅允许通过本机地址访问。' });
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin))
      return res.status(403).json({ error: '请求来源不受信任。请从本地 Branchlet 页面操作。' });
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return res.status(403).json({ error: '已拒绝跨站请求。' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Branchlet-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      return res.sendStatus(204);
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      const supplied = req.headers['x-branchlet-token'];
      if (
        typeof supplied !== 'string' ||
        !/^[a-f0-9]{64}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        return res.status(403).json({ error: '安全会话已过期，请刷新页面后重试。' });
      const isAssetUpload =
        req.method === 'POST' &&
        /^\/api\/repos\/[^/]+\/releases\/[1-9]\d*\/assets$/.test(req.path) &&
        req.is('application/octet-stream');
      if (!req.is('application/json') && !isAssetUpload)
        return res.status(415).json({ error: '请求必须使用 JSON 格式。' });
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', (_req, res) =>
    res.json({
      ok: true,
      app: 'Branchlet',
      version: '1.0.0',
      dataDir: path.resolve(service.dataDir),
      pid: process.pid,
    }),
  );
  app.get('/api/session', (_req, res) => res.json({ token }));
  app.get('/api/repos', (_req, res) => res.json(service.list()));
  app.post('/api/repos/open', async (req, res) => res.json(await service.open(req.body?.path)));
  app.post('/api/repos/init', async (req, res) => res.json(await service.init(req.body?.path)));
  app.post('/api/repos/clone', async (req, res) =>
    res.json(await service.clone(req.body?.url, req.body?.path)),
  );
  app.get('/api/filesystem', async (req, res) =>
    res.json(
      await service.filesystem(typeof req.query.path === 'string' ? req.query.path : undefined),
    ),
  );
  app.get('/api/repos/:id/snapshot', async (req, res) =>
    res.json(await service.snapshot(String(req.params.id))),
  );
  app.get('/api/repos/:id/diff', async (req, res) =>
    res.json(
      await service.diff(String(req.params.id), req.query.path, req.query.staged === 'true'),
    ),
  );
  app.get('/api/repos/:id/commit/:hash', async (req, res) =>
    res.json(await service.commitDetail(String(req.params.id), req.params.hash)),
  );
  app.post('/api/repos/:id/action', async (req, res) => {
    if (!req.body || typeof req.body.action !== 'string') throw new ApiError(400, '缺少操作名称。');
    res.json(await service.action(String(req.params.id), req.body));
  });
  app.get('/api/repos/:id/config', async (req, res) =>
    res.json(await service.config(String(req.params.id))),
  );
  app.post('/api/repos/:id/config', async (req, res) =>
    res.json(await service.setConfig(String(req.params.id), req.body ?? {})),
  );
  app.use('/api', createReleasesRouter(service));
  app.use('/api', createRepositoryFilesRouter(service));
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  const staticDir = options.staticDir ?? path.resolve('dist');
  app.use(
    '/help',
    express.static(path.resolve(staticDir, '..', 'docs'), {
      setHeaders: (res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      },
    }),
  );
  if (existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ApiError)
      return res
        .status(error.status)
        .json({ error: error.message, ...(error.detail ? { detail: error.detail } : {}) });
    if (error instanceof SyntaxError)
      return res.status(400).json({ error: '请求 JSON 格式无效。' });
    if ((error as { type?: string })?.type === 'entity.too.large')
      return res.status(413).json({ error: '上传文件超过 100 MB，或请求体超过允许大小。' });
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'EACCES' || code === 'EPERM')
      return res.status(403).json({ error: '没有权限访问此目录或文件。' });
    if (code === 'ENOENT')
      return res.status(404).json({ error: '目录或文件不存在，请刷新后重试。' });
    console.error('[Branchlet]', error);
    return res.status(500).json({ error: '本地服务发生错误，请查看终端日志。' });
  });
  return { app, service };
}
