import { randomUUID } from 'node:crypto';
import { lstat, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function within(root, path) {
  const suffix = relative(root, path);
  return suffix !== '' && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`);
}

async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// Prepare and verify every input before calling this function. Keep previous
// artifacts until the entire promotion succeeds, and restore them on failure.
export async function promoteRelease(releaseRoot, replacements, { move = rename } = {}) {
  const root = resolve(releaseRoot);
  const transaction = randomUUID();
  const items = replacements.map(({ prepared, target }) => ({
    prepared: resolve(prepared), target: resolve(target), backedUp: false, installed: false
  }));
  const paths = items.flatMap((item) => [item.prepared, item.target]);
  if (!items.length || new Set(paths).size !== paths.length) throw new Error('Release promotion paths must be distinct.');
  for (const item of items) {
    if (!within(join(root, 'build'), item.prepared)) throw new Error(`Prepared release is outside release/build: ${item.prepared}`);
    if (!['staging', 'artifacts'].some((name) => within(join(root, name), item.target))) {
      throw new Error(`Release target is outside staging/artifacts: ${item.target}`);
    }
    if (paths.some((path) => path !== item.prepared && within(item.prepared, path))) throw new Error('Release promotion paths must not overlap.');
    const info = await lstat(item.prepared);
    if (info.isSymbolicLink()) throw new Error(`Prepared release cannot be a symbolic link: ${item.prepared}`);
    item.backup = join(dirname(item.target), `.candidate-backup-${transaction}-${items.indexOf(item)}`);
  }
  try {
    for (const item of items) {
      if (await exists(item.target)) {
        await move(item.target, item.backup);
        item.backedUp = true;
      }
      await move(item.prepared, item.target);
      item.installed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of [...items].reverse()) {
      try {
        if (item.installed) await move(item.target, item.prepared);
        if (item.backedUp) await move(item.backup, item.target);
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Release promotion failed; previous artifacts remain in .candidate-backup paths and require recovery.');
    throw error;
  }
  for (const item of items) {
    if (item.backedUp) await rm(item.backup, { recursive: true, force: true }).catch((error) => {
      console.warn(`Release promoted; could not remove previous artifact ${item.backup}: ${error.message}`);
    });
  }
}
