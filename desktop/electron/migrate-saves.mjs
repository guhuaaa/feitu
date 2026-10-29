import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const LEGACY_SAVE_MIGRATION_MARKER = '.legacy-saves-migrated.json';

export async function migrateLegacySaves({ sourceUserDataPath, destinationUserDataPath, copySave = copyFile }) {
  if (resolve(sourceUserDataPath) === resolve(destinationUserDataPath)) return null;
  const marker = join(destinationUserDataPath, LEGACY_SAVE_MIGRATION_MARKER);
  try {
    await readFile(marker);
    return null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const source = join(sourceUserDataPath, 'saves');
  const destination = join(destinationUserDataPath, 'saves');
  let entries;
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
  if (!files.length) return null;
  await mkdir(destination, { recursive: true });
  let copied = 0;
  let preserved = 0;
  for (const entry of files) {
    const temporary = join(destination, `${entry.name}.migration-${randomUUID()}.tmp`);
    try {
      await copySave(join(source, entry.name), temporary, constants.COPYFILE_EXCL);
      const handle = await open(temporary, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Publish a complete copy without replacing an existing (possibly newer) save.
      try {
        await link(temporary, join(destination, entry.name));
        copied += 1;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        preserved += 1;
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const temporaryMarker = `${marker}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryMarker, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify({ schema: 'feitu-world/legacy-saves-migration/v1', source, copied, preserved })}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryMarker, marker);
  } finally {
    await rm(temporaryMarker, { force: true });
  }
  return { source, destination, copied, preserved };
}
