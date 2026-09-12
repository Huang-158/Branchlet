import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32')
  throw new Error(
    'Build the Windows portable ZIP on Windows (local machine or windows-latest CI runner).',
  );
const info = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const runtime = JSON.parse(await readFile(path.join(root, 'scripts/runtime.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(info.version)) throw new Error('Invalid package version');
const name = `Branchlet-${info.version}-windows-${runtime.architecture}`;
const releaseDirectory = path.join(root, 'release');
await mkdir(releaseDirectory, { recursive: true });
const stagingDirectory = await mkdtemp(path.join(releaseDirectory, '.package-'));
const output = path.join(stagingDirectory, name);
const finalArchive = path.join(releaseDirectory, `${name}.zip`);
await mkdir(output, { recursive: true });
const run = (command, args) =>
  new Promise((resolve, reject) => {
    // PowerShell 7's module search path must not shadow Windows PowerShell 5 modules.
    const childEnvironment = { ...process.env };
    for (const key of Object.keys(childEnvironment))
      if (key.toLowerCase() === 'psmodulepath') delete childEnvironment[key];
    const child = spawn(command, args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
      env: childEnvironment,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
await run('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  path.join(root, 'scripts/node-runtime.ps1'),
  '-Destination',
  path.join(output, 'runtime'),
  '-Architecture',
  runtime.architecture,
]);
for (const item of [
  'app',
  'dist',
  'docs',
  'README.md',
  'README.en.md',
  'LICENSE',
  'CONTRIBUTING.md',
  'CONTRIBUTING.en.md',
  'Start-Branchlet.cmd',
  'Stop-Branchlet.cmd',
])
  await cp(path.join(root, item), path.join(output, item), { recursive: true });
await mkdir(path.join(output, 'scripts'), { recursive: true });
for (const script of ['start-windows.ps1', 'stop-windows.ps1'])
  await cp(path.join(root, 'scripts', script), path.join(output, 'scripts', script));
// Include licenses for dependencies that are bundled into the executable JavaScript.
const licenses = ['Node.js runtime: see runtime/LICENSE.\n'];
const lockfile = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
for (const [location, metadata] of Object.entries(lockfile.packages)) {
  if (!location || metadata.dev) continue;
  for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md']) {
    try {
      const content = await readFile(path.join(root, location, candidate), 'utf8');
      licenses.push(`\n${'='.repeat(72)}\n${location} ${metadata.version}\n${content}`);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
await writeFile(path.join(output, 'THIRD-PARTY-NOTICES.txt'), licenses.join('\n'));
await writeFile(
  path.join(output, 'BUILD-INFO.json'),
  JSON.stringify(
    {
      application: info.name,
      version: info.version,
      node: runtime.version,
      architecture: runtime.architecture,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
await run('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  path.join(root, 'scripts/zip-release.ps1'),
  '-Source',
  output,
  '-Target',
  finalArchive,
]);
if (
  path.dirname(stagingDirectory) !== releaseDirectory ||
  !path.basename(stagingDirectory).startsWith('.package-')
)
  throw new Error('Invalid staging cleanup target');
await rm(stagingDirectory, { recursive: true, force: true });
console.log(
  `\nPortable release ready: ${finalArchive}\nInstall Git for Windows, extract the ZIP, then double-click Start-Branchlet.cmd.`,
);
