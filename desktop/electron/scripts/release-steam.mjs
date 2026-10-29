import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasAuthenticodeSignature } from './pe-signature.mjs';
import { promoteRelease } from './promote-release.mjs';
import { fingerprintReleaseInputs } from './release-inputs.mjs';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');
const releaseRoot = join(projectRoot, 'release');
const buildWorkspace = join(releaseRoot, 'build', 'electron', `.work-${process.pid}-${Date.now()}`);
const buildRoot = join(buildWorkspace, 'win-unpacked');
const steamRoot = join(releaseRoot, 'staging', 'steam-windows');
const artifactsRoot = join(releaseRoot, 'artifacts');
const builderCache = join(releaseRoot, 'build', 'electron-builder-cache');

process.once('exit', () => {
  rmSync(buildWorkspace, { recursive: true, force: true });
});

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function run(command, args, cwd, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function runNpm(args, cwd) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], cwd);
  }
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const commandLine = ['npm.cmd', ...args].map((arg) => /[\s&|<>^]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg).join(' ');
    return run(comspec, ['/d', '/s', '/c', commandLine], cwd);
  }
  return run('npm', args, cwd);
}

async function filesUnder(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) results.push(...await filesUnder(root, path));
    else if (entry.isFile()) results.push(path);
  }
  return results;
}

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(path);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolveHash(hash.digest('hex')));
  });
}

const desktopPackage = await json(join(desktopRoot, 'package.json'));
const runtimePackage = await json(join(projectRoot, 'packages', 'dsh-feitu-world', 'package.json'));
const runtimeManifest = await json(join(projectRoot, 'packages', 'dsh-feitu-world', 'RELEASE_MANIFEST.json'));
const expectedReleaseId = `dsh-feitu-world@${desktopPackage.version}`;

if (runtimePackage.version !== desktopPackage.version || runtimeManifest.release_id !== expectedReleaseId) {
  throw new Error(`Version mismatch: desktop=${desktopPackage.version}, runtime=${runtimePackage.version}, manifest=${runtimeManifest.release_id}`);
}

await runNpm(['run', 'verify'], desktopRoot);
await runNpm(['run', 'test:release'], desktopRoot);
await runNpm(['--prefix', join(projectRoot, 'packages', 'dsh-feitu-world'), 'test'], projectRoot);
await runNpm(['--prefix', join(projectRoot, 'packages', 'dsh-feitu-world'), 'run', 'verify:pack'], projectRoot);
await runNpm(['--prefix', join(projectRoot, 'packages', 'dsh-feitu-world'), 'run', 'verify:security'], projectRoot);
const sourceFingerprint = (await fingerprintReleaseInputs(projectRoot)).sha256;
await run(process.execPath, [join(projectRoot, 'tools', 'stage-release.mjs')], projectRoot);
await mkdir(builderCache, { recursive: true });
await run(process.execPath, [
  join(desktopRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
  '--win',
  'dir',
  `--config.directories.output=${buildWorkspace}`
], desktopRoot, {
  ...process.env,
  ELECTRON_BUILDER_CACHE: builderCache
});

const codeSigned = await hasAuthenticodeSignature(join(buildRoot, 'FeituWorld.exe'));

const buildInfo = {
  schema: 'feitu-world/desktop-build/v1',
  version: desktopPackage.version,
  distribution: 'steam',
  runtimeReleaseId: runtimeManifest.release_id,
  runtimeContract: runtimeManifest.runtime_contract,
  contentId: runtimeManifest.content_id,
  codeSigned,
  sourceFingerprint,
  builtAt: new Date().toISOString()
};
await writeFile(join(buildRoot, 'resources', 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');

const files = (await filesUnder(buildRoot)).sort((a, b) => relative(buildRoot, a).localeCompare(relative(buildRoot, b), 'en'));
const checksumLines = [];
let totalBytes = 0;
for (const path of files) {
  const relativePath = relative(buildRoot, path).replaceAll('\\', '/');
  const fileStat = await stat(path);
  totalBytes += fileStat.size;
  checksumLines.push(`${await sha256(path)}  ${relativePath}`);
}
await writeFile(join(buildRoot, 'checksums.sha256'), `${checksumLines.join('\n')}\n`, 'utf8');

await mkdir(artifactsRoot, { recursive: true });
const releaseManifest = {
  schema: 'feitu-world/steam-candidate/v1',
  version: desktopPackage.version,
  distribution: 'steam',
  platform: 'windows',
  arch: 'x64',
  executable: 'FeituWorld.exe',
  sourceDirectory: 'release/staging/steam-windows',
  totalBytes,
  fileCount: files.length + 1,
  checksums: 'checksums.sha256',
  codeSigned,
  buildInfo,
  updatePolicy: 'SteamPipe beta branch first; promote manually to default after acceptance.'
};
const manifestPath = join(artifactsRoot, `FeituWorld-${desktopPackage.version}-steam-win-x64.json`);
const preparedManifestPath = join(buildWorkspace, 'steam-candidate.json');
await writeFile(preparedManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, 'utf8');
if ((await fingerprintReleaseInputs(projectRoot)).sha256 !== sourceFingerprint) throw new Error('Release inputs changed during the build. Previous candidate was preserved; rebuild from a stable source tree.');
await run(process.execPath, [
  join(desktopRoot, 'scripts', 'verify-steam-candidate.mjs'),
  '--root', buildRoot, '--manifest', preparedManifestPath
], desktopRoot);
await mkdir(join(releaseRoot, 'staging'), { recursive: true });
await promoteRelease(releaseRoot, [
  { prepared: buildRoot, target: steamRoot },
  { prepared: preparedManifestPath, target: manifestPath }
]);
await rm(buildWorkspace, { recursive: true, force: true });

console.log(JSON.stringify({
  status: 'PASS',
  version: desktopPackage.version,
  steamRoot: relative(projectRoot, steamRoot),
  manifest: relative(projectRoot, manifestPath),
  totalMiB: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
  fileCount: files.length + 1,
  runtimeTests: true
}, null, 2));
