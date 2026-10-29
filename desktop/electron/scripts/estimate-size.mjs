import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');

async function directorySize(path) {
  try {
    const entry = await stat(path);
    if (entry.isFile()) return entry.size;
    const children = await readdir(path);
    let total = 0;
    for (const child of children) total += await directorySize(join(path, child));
    return total;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const runtimeBytes = await directorySize(join(projectRoot, 'release', 'staging', 'player-runtime'));
const electronBytes = await directorySize(join(desktopRoot, 'node_modules', 'electron', 'dist'));
const unpackedBytes = await directorySize(join(projectRoot, 'release', 'build', 'electron', 'win-unpacked'));
const mib = (bytes) => bytes === null ? null : Math.round((bytes / 1024 / 1024) * 100) / 100;

console.log(JSON.stringify({
  schema: 'feitu-world/desktop-size/v1',
  playerRuntimeMiB: mib(runtimeBytes),
  installedElectronRuntimeMiB: mib(electronBytes),
  actualWindowsUnpackedMiB: mib(unpackedBytes),
  estimatedCompressedDownloadMiB: unpackedBytes === null ? [90, 140] : [Math.round(mib(unpackedBytes) * 0.38), Math.round(mib(unpackedBytes) * 0.55)],
  estimatedIdleWorkingSetMiB: [300, 450],
  note: 'Unpacked size is exact after npm run dist:win; download and memory remain workload-dependent estimates.'
}, null, 2));
