import { access, readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasAuthenticodeSignature } from './pe-signature.mjs';
import { fingerprintReleaseInputs } from './release-inputs.mjs';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return resolve(value);
}
const steamRoot = option('--root', join(projectRoot, 'release', 'staging', 'steam-windows'));
const packageJson = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
const manifestPath = option('--manifest', join(projectRoot, 'release', 'artifacts', `FeituWorld-${packageJson.version}-steam-win-x64.json`));

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

await access(join(steamRoot, 'FeituWorld.exe'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const buildInfo = JSON.parse(await readFile(join(steamRoot, 'resources', 'build-info.json'), 'utf8'));
const codeSigned = await hasAuthenticodeSignature(join(steamRoot, 'FeituWorld.exe'));
if (manifest.version !== packageJson.version || buildInfo.version !== packageJson.version) throw new Error('Candidate version does not match desktop package version.');
if (manifest.distribution !== 'steam' || buildInfo.distribution !== 'steam') throw new Error('Candidate distribution must be steam.');
if (manifest.codeSigned !== codeSigned || buildInfo.codeSigned !== codeSigned) throw new Error('Candidate code-signing metadata does not match the executable.');
if (process.env.FEITU_REQUIRE_CODE_SIGNING === '1' && !codeSigned) throw new Error('Candidate must be Authenticode signed.');
if (buildInfo.sourceFingerprint !== (await fingerprintReleaseInputs(projectRoot)).sha256) throw new Error('Candidate was built from different release inputs. Run release:steam before distributing this source version.');

const checksumText = await readFile(join(steamRoot, 'checksums.sha256'), 'utf8');
const expected = new Map();
for (const line of checksumText.trim().split(/\r?\n/)) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match) throw new Error(`Malformed checksum line: ${line}`);
  const relativePath = match[2];
  if (relativePath.startsWith('/') || relativePath.includes('..')) throw new Error(`Unsafe checksum path: ${relativePath}`);
  if (expected.has(relativePath)) throw new Error(`Duplicate checksum path: ${relativePath}`);
  expected.set(relativePath, match[1]);
}

const actualFiles = (await filesUnder(steamRoot))
  .map((path) => relative(steamRoot, path).replaceAll('\\', '/'))
  .filter((path) => path !== 'checksums.sha256')
  .sort((a, b) => a.localeCompare(b, 'en'));
const expectedFiles = [...expected.keys()].sort((a, b) => a.localeCompare(b, 'en'));
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) throw new Error('Candidate file set does not match checksums.sha256.');

let totalBytes = 0;
for (const relativePath of actualFiles) {
  const fullPath = join(steamRoot, ...relativePath.split('/'));
  const [digest, fileStat] = await Promise.all([sha256(fullPath), stat(fullPath)]);
  if (digest !== expected.get(relativePath)) throw new Error(`Checksum mismatch: ${relativePath}`);
  totalBytes += fileStat.size;
}
if (manifest.fileCount !== actualFiles.length + 1 || manifest.totalBytes !== totalBytes) throw new Error('Candidate file count or size does not match its manifest.');
if (JSON.stringify(manifest.buildInfo) !== JSON.stringify(buildInfo)) throw new Error('Candidate build metadata does not match its manifest.');

console.log(JSON.stringify({
  schema: 'feitu-world/steam-candidate-verify/v1',
  status: 'PASS',
  version: packageJson.version,
  distribution: 'steam',
  fileCount: actualFiles.length + 1,
  totalMiB: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
  checksumsVerified: true,
  codeSigned
}, null, 2));
