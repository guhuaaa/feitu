import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LEGACY_SAVE_MIGRATION_MARKER, migrateLegacySaves } from '../migrate-saves.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'feitu-save-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceUserDataPath = join(root, 'legacy');
  const destinationUserDataPath = join(root, 'stable');
  const source = join(sourceUserDataPath, 'saves');
  const destination = join(destinationUserDataPath, 'saves');
  await mkdir(source, { recursive: true });
  await mkdir(destination, { recursive: true });
  await writeFile(join(source, 'a.json'), '{"turn":1}\n');
  await writeFile(join(source, 'b.json'), '{"turn":2}\n');
  return { sourceUserDataPath, destinationUserDataPath, source, destination };
}

test('copies every legacy save, preserves source and Steam Cloud metadata', async (t) => {
  const paths = await fixture(t);
  await writeFile(join(paths.destination, 'steam_autocloud.vdf'), 'cloud-marker\n');
  const result = await migrateLegacySaves(paths);
  assert.equal(result.copied, 2);
  for (const name of ['a.json', 'b.json']) {
    assert.equal(await readFile(join(paths.source, name), 'utf8'), await readFile(join(paths.destination, name), 'utf8'));
  }
  assert.equal(await readFile(join(paths.destination, 'steam_autocloud.vdf'), 'utf8'), 'cloud-marker\n');
  assert.equal((await readdir(paths.destination)).includes(LEGACY_SAVE_MIGRATION_MARKER), false);
  assert.equal(JSON.parse(await readFile(join(paths.destinationUserDataPath, LEGACY_SAVE_MIGRATION_MARKER), 'utf8')).schema, 'feitu-world/legacy-saves-migration/v1');
});

test('preserves a newer same-name save while importing other missing saves', async (t) => {
  const paths = await fixture(t);
  await writeFile(join(paths.destination, 'a.json'), '{"turn":99}\n');
  const result = await migrateLegacySaves(paths);
  assert.equal(result.copied, 1);
  assert.equal(result.preserved, 1);
  assert.equal(await readFile(join(paths.destination, 'a.json'), 'utf8'), '{"turn":99}\n');
  assert.equal(await readFile(join(paths.destination, 'b.json'), 'utf8'), '{"turn":2}\n');
});

test('retries an interrupted multi-save migration without publishing a partial file', async (t) => {
  const paths = await fixture(t);
  let copies = 0;
  await assert.rejects(migrateLegacySaves({ ...paths, async copySave(source, destination, mode) {
    copies += 1;
    if (copies === 2) {
      await writeFile(destination, '{"turn":');
      throw Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' });
    }
    return copyFile(source, destination, mode);
  } }), /simulated full disk/);
  assert.equal((await readdir(paths.destination)).filter((name) => name.endsWith('.json')).length, 1);
  await assert.rejects(readFile(join(paths.destinationUserDataPath, LEGACY_SAVE_MIGRATION_MARKER)), { code: 'ENOENT' });
  const retried = await migrateLegacySaves(paths);
  assert.equal(retried.copied, 1);
  assert.equal(retried.preserved, 1);
  for (const name of ['a.json', 'b.json']) assert.equal(await readFile(join(paths.destination, name), 'utf8'), await readFile(join(paths.source, name), 'utf8'));
  assert.equal((await readdir(paths.destination)).some((name) => name.endsWith('.tmp')), false);
});

test('completed migration does not resurrect a subsequently deleted save', async (t) => {
  const paths = await fixture(t);
  await migrateLegacySaves(paths);
  await rm(join(paths.destination, 'a.json'));
  assert.equal(await migrateLegacySaves(paths), null);
  await assert.rejects(readFile(join(paths.destination, 'a.json')), { code: 'ENOENT' });
  assert.equal(await readFile(join(paths.source, 'a.json'), 'utf8'), '{"turn":1}\n');
});
