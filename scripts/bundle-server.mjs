import { build } from 'esbuild';
await build({
  entryPoints: ['server/index.ts'],
  outfile: 'app/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  legalComments: 'eof',
  logLevel: 'info',
});
