import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promoteRelease } from '../scripts/promote-release.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'feitu-promotion-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const build = join(root, 'build', 'prepared');
  const candidate = join(root, 'staging', 'steam-windows');
  const manifest = join(root, 'artifacts', 'manifest.json');
  await Promise.all([mkdir(build, { recursive: true }), mkdir(candidate, { recursive: true }), mkdir(join(root, 'artifacts'))]);
  await writeFile(join(build, 'game.txt'), 'new');
  await writeFile(join(candidate, 'game.txt'), 'previous');
  await writeFile(join(root, 'build', 'manifest.json'), 'new-manifest');
  await writeFile(manifest, 'previous-manifest');
  return { root, build, candidate, manifest, replacements: [
    { prepared: build, target: candidate },
    { prepared: join(root, 'build', 'manifest.json'), target: manifest }
  ] };
}

test('promotes directory and manifest together and removes previous backups', async (t) => {
  const f = await fixture(t);
  await promoteRelease(f.root, f.replacements);
  assert.equal(await readFile(join(f.candidate, 'game.txt'), 'utf8'), 'new');
  assert.equal(await readFile(f.manifest, 'utf8'), 'new-manifest');
  assert.deepEqual(await readdir(join(f.root, 'staging')), ['steam-windows']);
  assert.deepEqual(await readdir(join(f.root, 'artifacts')), ['manifest.json']);
});

test('manifest promotion failure restores the previous candidate and manifest', async (t) => {
  const f = await fixture(t);
  await assert.rejects(promoteRelease(f.root, f.replacements, {
    move: async (source, destination) => {
      if (source === f.replacements[1].prepared) throw new Error('simulated disk/permission failure');
      return rename(source, destination);
    }
  }), /simulated disk/);
  assert.equal(await readFile(join(f.candidate, 'game.txt'), 'utf8'), 'previous');
  assert.equal(await readFile(f.manifest, 'utf8'), 'previous-manifest');
  assert.equal(await readFile(join(f.build, 'game.txt'), 'utf8'), 'new');
});

test('missing prepared artifact fails before changing any previous artifact', async (t) => {
  const f = await fixture(t);
  await rm(f.replacements[1].prepared);
  await assert.rejects(promoteRelease(f.root, f.replacements), /ENOENT/);
  assert.equal(await readFile(join(f.candidate, 'game.txt'), 'utf8'), 'previous');
  assert.equal(await readFile(f.manifest, 'utf8'), 'previous-manifest');
});

test('refuses targets outside the release output directories', async (t) => {
  const f = await fixture(t);
  await assert.rejects(promoteRelease(f.root, [{ prepared: f.build, target: join(f.root, 'source') }]), /outside staging\/artifacts/);
  assert.equal(await readFile(join(f.candidate, 'game.txt'), 'utf8'), 'previous');
});
