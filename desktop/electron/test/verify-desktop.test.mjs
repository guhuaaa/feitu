import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');
const packagedInputs = [
  'model-config.mjs', 'settings-window.mjs', 'settings-preload.cjs',
  'settings.html', 'settings-renderer.mjs', 'settings.css', 'soak-probe.mjs'
];

async function cleanCheckout(t) {
  const root = await mkdtemp(join(tmpdir(), 'feitu-desktop-verify-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktop = join(root, 'desktop', 'electron');
  await cp(desktopRoot, desktop, {
    recursive: true,
    filter: (source) => !['node_modules', 'test'].includes(basename(source))
  });
  const runtime = join(root, 'packages', 'dsh-feitu-world');
  for (const file of ['package.json', 'RELEASE_MANIFEST.json', 'server.mjs', 'ui/preview.html']) {
    await mkdir(dirname(join(runtime, file)), { recursive: true });
    await cp(join(projectRoot, 'packages', 'dsh-feitu-world', file), join(runtime, file));
  }
  return { root, desktop, runtime };
}

function verify(desktop) {
  return spawnSync(process.execPath, [join(desktop, 'scripts', 'verify-desktop.mjs')], {
    cwd: desktop,
    encoding: 'utf8',
    windowsHide: true
  });
}

test('source checkout verifies before generated staging exists', async (t) => {
  const { desktop } = await cleanCheckout(t);
  const result = verify(desktop);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'PASS');
  assert.equal(report.runtimeSourceAvailable, true);
  assert.equal(Object.hasOwn(report, 'runtimeBundled'), false);
});

test('missing runtime source is rejected even when old staging exists', async (t) => {
  const { root, desktop, runtime } = await cleanCheckout(t);
  const staging = join(root, 'release', 'staging', 'player-runtime');
  await mkdir(join(staging, 'ui'), { recursive: true });
  await cp(join(runtime, 'server.mjs'), join(staging, 'server.mjs'));
  await cp(join(runtime, 'ui', 'preview.html'), join(staging, 'ui', 'preview.html'));
  await rm(join(runtime, 'server.mjs'));
  const result = verify(desktop);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /packages[\\/]dsh-feitu-world[\\/]server\.mjs/);
});

test('source checkout still rejects version drift', async (t) => {
  const { desktop, runtime } = await cleanCheckout(t);
  const path = join(runtime, 'package.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.version = '0.0.0';
  await writeFile(path, JSON.stringify(manifest));
  const result = verify(desktop);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Desktop and player runtime versions do not match/);
});

for (const file of packagedInputs) {
  test(`source checkout rejects missing packaged desktop input ${file}`, async (t) => {
    const { desktop } = await cleanCheckout(t);
    await rm(join(desktop, file));
    const result = verify(desktop);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(file), result.stderr);
  });

  test(`source checkout rejects desktop input absent from build.files: ${file}`, async (t) => {
    const { desktop } = await cleanCheckout(t);
    const path = join(desktop, 'package.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.build.files = manifest.build.files.filter((entry) => entry !== file);
    await writeFile(path, JSON.stringify(manifest));
    const result = verify(desktop);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`Required desktop file is not explicitly packaged: ${file}`), result.stderr);
  });
}
