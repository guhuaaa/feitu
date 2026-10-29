import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';

const fixedInputs = [
  'desktop/electron/main.mjs',
  'desktop/electron/migrate-saves.mjs',
  'desktop/electron/model-config.mjs',
  'desktop/electron/settings-window.mjs',
  'desktop/electron/settings-preload.cjs',
  'desktop/electron/settings.html',
  'desktop/electron/settings-renderer.mjs',
  'desktop/electron/settings.css',
  'desktop/electron/soak-probe.mjs',
  'desktop/electron/package.json',
  'desktop/electron/package-lock.json',
  'desktop/electron/build/icon.png',
  'tools/stage-release.mjs',
  'release/manifests/release-files.json',
  'release/RIGHTS_AND_COMPLIANCE.md'
];

export async function fingerprintReleaseInputs(projectRoot) {
  const root = resolve(projectRoot);
  const files = new Map();
  const directories = new Set();
  function inputPath(base, value) {
    if (typeof value !== 'string' || !value || isAbsolute(value) || win32.isAbsolute(value)
      || value.split(/[\\/]/).some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
      throw new Error(`Unsafe release input path: ${value}`);
    }
    return resolve(base, ...value.split(/[\\/]/));
  }
  async function inspect(path) {
    let info;
    try { info = await lstat(path); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Required release input is missing: ${relative(root, path)}`);
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Release inputs cannot contain symbolic links: ${relative(root, path)}`);
    return info;
  }
  async function collect(path) {
    const parts = relative(root, path).split(sep);
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      if (!directories.has(parent)) {
        if (!(await inspect(parent)).isDirectory()) throw new Error(`Release input ancestor is not a directory: ${parent}`);
        directories.add(parent);
      }
    }
    const info = await inspect(path);
    if (info.isDirectory()) {
      directories.add(path);
      for (const name of await readdir(path)) await collect(join(path, name));
    } else if (info.isFile()) {
      files.set(relative(root, path).split(sep).join('/'), path);
    } else throw new Error(`Release input is not a regular file or directory: ${relative(root, path)}`);
  }
  if (!(await inspect(root)).isDirectory()) throw new Error('Release project root must be a directory.');
  const manifestPath = inputPath(root, 'release/manifests/release-files.json');
  await collect(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.include) || !Array.isArray(manifest.root_documents)) throw new Error('Release manifest must declare include and root_documents arrays.');
  const sourceRoot = inputPath(root, manifest.source_root);
  if (!(await inspect(sourceRoot)).isDirectory()) throw new Error('Release source_root must be a directory.');
  for (const item of manifest.include) await collect(inputPath(sourceRoot, item));
  for (const item of manifest.root_documents) await collect(inputPath(root, item));
  for (const item of fixedInputs) await collect(inputPath(root, item));
  const scriptsRoot = inputPath(root, 'desktop/electron/scripts');
  if (!(await inspect(scriptsRoot)).isDirectory()) throw new Error('Release scripts root must be a directory.');
  for (const name of await readdir(scriptsRoot)) {
    const path = join(scriptsRoot, name);
    const info = await inspect(path);
    if (info.isFile() && name.endsWith('.mjs')) await collect(path);
  }
  const hash = createHash('sha256');
  for (const name of [...files.keys()].sort()) {
    const contents = await readFile(files.get(name));
    hash.update(`${JSON.stringify([name, contents.length])}\n`);
    hash.update(contents);
    hash.update('\n');
  }
  return { sha256: hash.digest('hex'), fileCount: files.size };
}
