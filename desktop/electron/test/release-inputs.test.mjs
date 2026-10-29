import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fingerprintReleaseInputs } from '../scripts/release-inputs.mjs';

const packagedInputs = [
  'model-config.mjs', 'settings-window.mjs', 'settings-preload.cjs',
  'settings.html', 'settings-renderer.mjs', 'settings.css', 'soak-probe.mjs'
];

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'feitu-release-inputs-'));
  async function write(path, value = path) {
    const fullPath = join(root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, value);
  }
  try {
    await write('release/manifests/release-files.json', JSON.stringify({
      source_root: 'game', include: ['server.mjs', 'content'], root_documents: ['GUIDE.md']
    }));
    for (const path of [
      'game/server.mjs', 'game/content/story.json', 'GUIDE.md',
      'desktop/electron/main.mjs', 'desktop/electron/migrate-saves.mjs',
      ...packagedInputs.map((file) => `desktop/electron/${file}`),
      'desktop/electron/package.json', 'desktop/electron/package-lock.json',
      'desktop/electron/build/icon.png', 'desktop/electron/scripts/release-steam.mjs',
      'tools/stage-release.mjs', 'release/RIGHTS_AND_COMPLIANCE.md'
    ]) await write(path);
    await run(root, write);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('fingerprint changes for packaged source, documents, shell, and build recipe', async () => {
  await fixture(async (root, write) => {
    let previous = await fingerprintReleaseInputs(root);
    assert.match(previous.sha256, /^[a-f0-9]{64}$/);
    assert.equal(previous.fileCount, 19);
    for (const path of ['game/content/story.json', 'GUIDE.md', 'desktop/electron/main.mjs', 'desktop/electron/scripts/release-steam.mjs']) {
      await write(path, `changed ${path}`);
      const next = await fingerprintReleaseInputs(root);
      assert.notEqual(next.sha256, previous.sha256, path);
      previous = next;
    }
  });
});

for (const file of packagedInputs) {
  test(`fingerprint changes when packaged desktop input ${file} changes`, async () => {
    await fixture(async (root, write) => {
      const before = await fingerprintReleaseInputs(root);
      await write(`desktop/electron/${file}`, `changed ${file}`);
      assert.notEqual((await fingerprintReleaseInputs(root)).sha256, before.sha256);
    });
  });
}

test('fingerprint ignores timestamps and files outside the release inputs', async () => {
  await fixture(async (root, write) => {
    const before = await fingerprintReleaseInputs(root);
    await utimes(join(root, 'game/server.mjs'), 1, 1);
    for (const path of ['release/staging/player-runtime/server.mjs', 'release/build/result.exe', 'node_modules/extra.js', 'game/test/example.mjs', 'research/source.txt', 'desktop/electron/test/extra.test.mjs']) {
      await write(path, 'not shipped');
    }
    assert.deepEqual(await fingerprintReleaseInputs(root), before);
  });
});

test('missing required inputs fail instead of producing a partial fingerprint', async () => {
  await fixture(async (root) => {
    await unlink(join(root, 'desktop/electron/migrate-saves.mjs'));
    await assert.rejects(fingerprintReleaseInputs(root), /Required release input is missing/);
  });
});

test('symbolic links and directory junctions in selected inputs are rejected', async () => {
  await fixture(async (root, write) => {
    await write('outside/story.json');
    await rm(join(root, 'game/content'), { recursive: true });
    await symlink(join(root, 'outside'), join(root, 'game/content'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(fingerprintReleaseInputs(root), /cannot contain symbolic links/);
  });
});

test('manifest paths cannot escape the declared project or source directory', async () => {
  await fixture(async (root, write) => {
    await write('release/manifests/release-files.json', JSON.stringify({
      source_root: 'game', include: ['../GUIDE.md'], root_documents: []
    }));
    await assert.rejects(fingerprintReleaseInputs(root), /Unsafe release input path/);
  });
});
