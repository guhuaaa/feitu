import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rmSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promoteRelease } from './promote-release.mjs';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');
const releaseRoot = join(projectRoot, 'release');
const steamRoot = join(releaseRoot, 'staging', 'steam-windows');
const githubRoot = join(releaseRoot, 'staging', 'github-windows');
const artifactsRoot = join(releaseRoot, 'artifacts');
const packageJson = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
const packageName = `FeituWorld-${packageJson.version}-windows-x64`;
const buildWorkspace = join(releaseRoot, 'build', 'github', `.work-${process.pid}-${Date.now()}`);
const preparedStaging = join(buildWorkspace, 'github-windows');
const packageRoot = join(preparedStaging, packageName);
const archivePath = join(artifactsRoot, `${packageName}.zip`);
const preparedArchivePath = join(buildWorkspace, `${packageName}.zip`);
process.once('exit', () => rmSync(buildWorkspace, { recursive: true, force: true }));

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function filesUnder(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.once('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', () => resolveHash(hash.digest('hex')));
  });
}

await run(process.execPath, [join(desktopRoot, 'scripts', 'verify-steam-candidate.mjs')], desktopRoot);
await mkdir(preparedStaging, { recursive: true });
await cp(steamRoot, packageRoot, { recursive: true });

const buildInfoPath = join(packageRoot, 'resources', 'build-info.json');
const buildInfo = JSON.parse(await readFile(buildInfoPath, 'utf8'));
buildInfo.distribution = 'github';
buildInfo.repackagedAt = new Date().toISOString();
await writeFile(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');

await rm(join(packageRoot, 'checksums.sha256'), { force: true });
const files = (await filesUnder(packageRoot)).sort((a, b) => relative(packageRoot, a).localeCompare(relative(packageRoot, b), 'en'));
const checksumLines = [];
let unpackedBytes = 0;
for (const path of files) {
  const relativePath = relative(packageRoot, path).replaceAll('\\', '/');
  const fileStat = await stat(path);
  unpackedBytes += fileStat.size;
  checksumLines.push(`${await sha256(path)}  ${relativePath}`);
}
await writeFile(join(packageRoot, 'checksums.sha256'), `${checksumLines.join('\n')}\n`, 'utf8');

await mkdir(artifactsRoot, { recursive: true });
const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';
await run(tarCommand, ['-a', '-c', '-f', preparedArchivePath, '-C', preparedStaging, basename(packageRoot)], projectRoot);

const [archiveDigest, archiveStat] = await Promise.all([sha256(preparedArchivePath), stat(preparedArchivePath)]);
const checksumPath = `${archivePath}.sha256`;
const preparedChecksumPath = `${preparedArchivePath}.sha256`;
await writeFile(preparedChecksumPath, `${archiveDigest}  ${basename(archivePath)}\n`, 'utf8');
const manifestPath = join(artifactsRoot, `${packageName}-github.json`);
const preparedManifestPath = join(buildWorkspace, `${packageName}-github.json`);
await writeFile(preparedManifestPath, `${JSON.stringify({
  schema: 'feitu-world/github-candidate/v1',
  version: packageJson.version,
  distribution: 'github',
  platform: 'windows',
  arch: 'x64',
  archive: basename(archivePath),
  archiveSha256: archiveDigest,
  archiveBytes: archiveStat.size,
  unpackedBytes,
  fileCount: files.length + 1,
  codeSigned: buildInfo.codeSigned,
  sourceFingerprint: buildInfo.sourceFingerprint,
  sourceDirectory: relative(projectRoot, join(githubRoot, packageName)),
  updatePolicy: 'Portable release: close the game, replace the application directory, and keep saves in Electron userData.'
}, null, 2)}\n`, 'utf8');
await run(process.execPath, [join(desktopRoot, 'scripts', 'verify-github-candidate.mjs'), '--artifacts-root', buildWorkspace], desktopRoot);
await promoteRelease(releaseRoot, [
  { prepared: preparedStaging, target: githubRoot },
  { prepared: preparedArchivePath, target: archivePath },
  { prepared: preparedChecksumPath, target: checksumPath },
  { prepared: preparedManifestPath, target: manifestPath }
]);
await rm(buildWorkspace, { recursive: true, force: true });

console.log(JSON.stringify({
  status: 'PASS',
  version: packageJson.version,
  archive: relative(projectRoot, archivePath),
  archiveSha256: archiveDigest,
  archiveMiB: Math.round((archiveStat.size / 1024 / 1024) * 100) / 100,
  unpackedMiB: Math.round((unpackedBytes / 1024 / 1024) * 100) / 100,
  fileCount: files.length + 1
}, null, 2));
