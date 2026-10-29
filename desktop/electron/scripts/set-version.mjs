import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');
const requested = process.argv[2];

if (!requested || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(requested)) {
  throw new Error('Usage: npm run version:set -- <semver>, for example 0.2.3 or 0.3.0-beta.1');
}

const paths = {
  desktopPackage: join(desktopRoot, 'package.json'),
  desktopLock: join(desktopRoot, 'package-lock.json'),
  runtimePackage: join(projectRoot, 'packages', 'dsh-feitu-world', 'package.json'),
  runtimeManifest: join(projectRoot, 'packages', 'dsh-feitu-world', 'RELEASE_MANIFEST.json')
};

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const desktopPackage = await readJson(paths.desktopPackage);
const desktopLock = await readJson(paths.desktopLock);
const runtimePackage = await readJson(paths.runtimePackage);
const runtimeManifest = await readJson(paths.runtimeManifest);

desktopPackage.version = requested;
desktopLock.version = requested;
if (desktopLock.packages?.['']) desktopLock.packages[''].version = requested;
runtimePackage.version = requested;
runtimeManifest.release_id = `dsh-feitu-world@${requested}`;

await writeJson(paths.desktopPackage, desktopPackage);
await writeJson(paths.desktopLock, desktopLock);
await writeJson(paths.runtimePackage, runtimePackage);
await writeJson(paths.runtimeManifest, runtimeManifest);

console.log(JSON.stringify({
  schema: 'feitu-world/version-set/v1',
  status: 'UPDATED',
  version: requested,
  files: Object.values(paths).map((path) => path.slice(projectRoot.length + 1))
}, null, 2));
