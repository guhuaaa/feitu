import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasAuthenticodeSignature } from './pe-signature.mjs';
import { fingerprintReleaseInputs } from './release-inputs.mjs';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');
const releaseRoot = join(projectRoot, 'release');
const packageJson = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
const packageName = `FeituWorld-${packageJson.version}-windows-x64`;
const artifactsIndex = process.argv.indexOf('--artifacts-root');
if (artifactsIndex >= 0 && (!process.argv[artifactsIndex + 1] || process.argv[artifactsIndex + 1].startsWith('--'))) throw new Error('Missing value for --artifacts-root');
const artifactsRoot = artifactsIndex < 0 ? join(releaseRoot, 'artifacts') : resolve(process.argv[artifactsIndex + 1]);
const archivePath = join(artifactsRoot, `${packageName}.zip`);
const manifestPath = join(artifactsRoot, `${packageName}-github.json`);
const verifyRoot = join(releaseRoot, 'test-data', `.github-verify-${process.pid}-${Date.now()}`);

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
    else throw new Error(`Candidate contains a symbolic link or unsupported file: ${path}`);
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

const safeTestRoot = join(releaseRoot, 'test-data');
if (!verifyRoot.startsWith(`${safeTestRoot}${sep}`)) throw new Error(`Unsafe verification path: ${verifyRoot}`);

try {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const [archiveDigest, archiveStat, sidecar] = await Promise.all([
    sha256(archivePath),
    stat(archivePath),
    readFile(`${archivePath}.sha256`, 'utf8')
  ]);
  if (manifest.version !== packageJson.version || manifest.distribution !== 'github') throw new Error('GitHub manifest version or distribution mismatch.');
  if (archiveDigest !== manifest.archiveSha256 || archiveStat.size !== manifest.archiveBytes) throw new Error('GitHub archive does not match its manifest.');
  if (sidecar.trim() !== `${archiveDigest}  ${basename(archivePath)}`) throw new Error('GitHub archive checksum sidecar mismatch.');

  await mkdir(verifyRoot, { recursive: true });
  const tarCommand = process.platform === 'win32' ? 'tar.exe' : 'tar';
  await run(tarCommand, ['-x', '-f', archivePath, '-C', verifyRoot], projectRoot);
  const packageRoot = join(verifyRoot, packageName);
  const buildInfo = JSON.parse(await readFile(join(packageRoot, 'resources', 'build-info.json'), 'utf8'));
  const codeSigned = await hasAuthenticodeSignature(join(packageRoot, 'FeituWorld.exe'));
  if (buildInfo.version !== packageJson.version || buildInfo.distribution !== 'github') throw new Error('Extracted GitHub build metadata mismatch.');
  if (manifest.codeSigned !== codeSigned || buildInfo.codeSigned !== codeSigned) throw new Error('GitHub code-signing metadata does not match the executable.');
  if (process.env.FEITU_REQUIRE_CODE_SIGNING === '1' && !codeSigned) throw new Error('GitHub candidate must be Authenticode signed.');
  if (manifest.sourceFingerprint !== buildInfo.sourceFingerprint || buildInfo.sourceFingerprint !== (await fingerprintReleaseInputs(projectRoot)).sha256) throw new Error('GitHub candidate was built from different release inputs. Rebuild the desktop candidate first.');

  const checksumText = await readFile(join(packageRoot, 'checksums.sha256'), 'utf8');
  const expected = new Map();
  for (const line of checksumText.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`Malformed checksum line: ${line}`);
    if (match[2].startsWith('/') || match[2].includes('..')) throw new Error(`Unsafe checksum path: ${match[2]}`);
    if (expected.has(match[2])) throw new Error(`Duplicate checksum path: ${match[2]}`);
    expected.set(match[2], match[1]);
  }

  const actualFiles = (await filesUnder(packageRoot))
    .map((path) => relative(packageRoot, path).replaceAll('\\', '/'))
    .filter((path) => path !== 'checksums.sha256')
    .sort((a, b) => a.localeCompare(b, 'en'));
  const expectedFiles = [...expected.keys()].sort((a, b) => a.localeCompare(b, 'en'));
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error('Extracted GitHub file set does not match checksums.sha256.');
  let unpackedBytes = 0;
  for (const relativePath of actualFiles) {
    const fullPath = join(packageRoot, ...relativePath.split('/'));
    if (await sha256(fullPath) !== expected.get(relativePath)) throw new Error(`Extracted checksum mismatch: ${relativePath}`);
    unpackedBytes += (await stat(fullPath)).size;
  }
  if (manifest.fileCount !== actualFiles.length + 1 || manifest.unpackedBytes !== unpackedBytes) throw new Error('GitHub file count or unpacked size does not match its manifest.');

  console.log(JSON.stringify({
    schema: 'feitu-world/github-candidate-verify/v1',
    status: 'PASS',
    version: packageJson.version,
    archive: relative(projectRoot, archivePath),
    archiveMiB: Math.round((archiveStat.size / 1024 / 1024) * 100) / 100,
    fileCount: actualFiles.length + 1,
    archiveChecksumVerified: true,
    extractedChecksumsVerified: true,
    codeSigned
  }, null, 2));
} finally {
  await rm(verifyRoot, { recursive: true, force: true });
}
