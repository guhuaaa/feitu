import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsRoot = join(projectRoot, 'release', 'artifacts');
const desktopPackage = JSON.parse(await readFile(join(projectRoot, 'desktop', 'electron', 'package.json'), 'utf8'));
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
  if (!['--from', '--to'].includes(name) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value ?? '')) {
    throw new Error('Usage: node tools/verify-desktop-upgrade.mjs --from <version> --to <version>');
  }
  options.set(name, value);
}
const from = options.get('--from') ?? '0.2.2';
const to = options.get('--to') ?? desktopPackage.version;
if (from === to) throw new Error('Upgrade acceptance requires two different release versions.');
if (process.platform !== 'win32') throw new Error('This acceptance command requires the Windows release EXEs.');

const testParent = join(projectRoot, 'release', 'test-data');
await mkdir(testParent, { recursive: true });
const testRoot = await mkdtemp(join(testParent, 'desktop-upgrade-'));
const saves = join(testRoot, 'saves');
const activeServices = new Set();
const checks = [];

function digest(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.once('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('end', () => resolveHash(hash.digest('hex')));
  });
}

async function extract(version) {
  const name = `FeituWorld-${version}-windows-x64`;
  const archive = join(artifactsRoot, `${name}.zip`);
  const expected = (await readFile(`${archive}.sha256`, 'utf8')).trim();
  const sha256 = await digest(archive);
  assert.equal(expected, `${sha256}  ${basename(archive)}`, `Archive checksum mismatch: ${version}`);
  const destination = join(testRoot, `package-${version}`);
  await mkdir(destination);
  const { stdout } = await execFileAsync('tar.exe', ['-t', '-f', archive], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  for (const path of stdout.trim().split(/\r?\n/)) {
    const normalized = path.replaceAll('\\', '/');
    assert.ok(normalized.startsWith(`${name}/`) && !normalized.split('/').includes('..'), `Unexpected archive entry: ${path}`);
  }
  await execFileAsync('tar.exe', ['-x', '-f', archive, '-C', destination], { windowsHide: true, timeout: 30000 });
  const root = join(destination, name);
  const metadata = JSON.parse(await readFile(join(root, 'resources', 'build-info.json'), 'utf8'));
  assert.equal(metadata.version, version);
  await access(join(root, 'FeituWorld.exe'));
  return { root, version, sha256 };
}

async function startPackage(packageInfo) {
  const runtime = join(packageInfo.root, 'resources', 'player-runtime');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', FEITU_PORT: '0', FEITU_STORAGE_DIR: saves, FEITU_DESKTOP_VERSION: packageInfo.version, FEITU_DISTRIBUTION: 'upgrade-acceptance' };
  delete env.DEEPSEEK_API_KEY;
  delete env.NODE_OPTIONS;
  const child = spawn(join(packageInfo.root, 'FeituWorld.exe'), [join(runtime, 'server.mjs')], {
    cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  const service = { child, version: packageInfo.version, output: '', baseUrl: null };
  activeServices.add(service);
  service.closed = new Promise((resolveClose) => {
    child.once('error', (error) => resolveClose({ error: error.message }));
    child.once('close', (code, signal) => resolveClose({ code, signal }));
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  try {
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error(`Packaged runtime ${service.version} startup timed out: ${service.output}`)), 15000);
      child.stdout.on('data', (chunk) => {
        service.output = `${service.output}${chunk}`.slice(-12000);
        const match = /FEITU_PREVIEW (http:\/\/127\.0\.0\.1:\d+)/.exec(service.output);
        if (match) { service.baseUrl = match[1]; clearTimeout(timer); resolveReady(); }
      });
      child.stderr.on('data', (chunk) => { service.output = `${service.output}${chunk}`.slice(-12000); });
      service.closed.then((result) => {
        clearTimeout(timer);
        if (!service.baseUrl) reject(new Error(`Packaged runtime exited before readiness: ${JSON.stringify(result)} ${service.output}`));
      });
    });
    const health = await request(service, '/api/health');
    assert.equal(health.status, 'PASS');
    assert.equal(health.deepseek.configured, false);
    assert.equal(health.runtimeContract, 'feitu-world/v1');
    const manifest = await request(service, '/api/manifest');
    assert.equal(manifest.releaseId, `dsh-feitu-world@${packageInfo.version}`);
    return service;
  } catch (error) { await stopPackage(service); throw error; }
}

async function stopPackage(service) {
  if (!activeServices.has(service)) return;
  if (service.child.exitCode === null && service.child.signalCode === null) service.child.kill();
  let timer;
  try {
    await Promise.race([service.closed, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`Runtime ${service.version} did not stop.`)), 5000); })]);
    activeServices.delete(service);
  } finally { clearTimeout(timer); }
}

async function request(service, path, action) {
  const response = await fetch(`${service.baseUrl}${path}`, {
    method: action ? 'POST' : 'GET',
    headers: action ? { 'Content-Type': 'application/json' } : {},
    body: action ? JSON.stringify(action) : undefined,
    signal: AbortSignal.timeout(5000)
  });
  const value = await response.json();
  assert.equal(response.status, 200, `${service.version} ${path}: ${JSON.stringify(value)}`);
  return value;
}

const act = (service, action) => request(service, '/api/game', action);
const snapshot = (view) => Object.fromEntries([
  'run_id', 'turn', 'role', 'location', 'currentNode', 'inventory', 'discoveredClues', 'flags',
  'visibleDialogue', 'visibleNarrative', 'storyUnlocks', 'opening', 'pressure', 'helmet', 'checkpoint'
].map((key) => [key, view[key]]));

async function resumeAndCheck(service, saved) {
  const initial = await request(service, '/api/game');
  assert.equal(initial.started, false);
  assert.ok(initial.saves.includes(saved.run_id));
  const resumed = await act(service, { action: 'resume', run_id: saved.run_id });
  assert.deepEqual(snapshot(resumed), snapshot(saved));
  assert.equal(resumed.actionCount, saved.actionCount + 1);
  return resumed;
}

try {
  console.log(`Verifying real packaged saves: ${from} -> ${to} -> ${from}`);
  const oldPackage = await extract(from);
  const newPackage = await extract(to);
  await mkdir(saves);
  let service = await startPackage(oldPackage);
  let view = await act(service, { action: 'start', role_id: 'zhunin' });
  const runId = view.run_id;
  view = await act(service, { action: 'free_action', action_text: '我观察入口的积水和孢子痕迹', run_id: runId, expected_turn: view.turn, client_action_id: randomUUID() });
  assert.equal(view.freeActionEvent.accepted, true);
  assert.equal(view.freeActionEvent.source, 'deterministic-fallback');
  assert.equal(view.dsh.reason, 'DEEPSEEK_API_KEY_NOT_CONFIGURED');
  await act(service, { action: 'move', target_id: 'L002' });
  await act(service, { action: 'inspect' });
  await act(service, { action: 'take', item_id: 'I003' });
  const oldSaved = await act(service, { action: 'save' });
  assert.equal(oldSaved.location.id, 'L002');
  assert.ok(oldSaved.discoveredClues.length > 0);
  const oldSave = JSON.parse(await readFile(join(saves, `${runId}.json`), 'utf8'));
  checks.push({ name: 'old-package-offline-gameplay-and-save', status: 'PASS', saveFormat: oldSave.save_format });
  await stopPackage(service);

  service = await startPackage(newPackage);
  view = await resumeAndCheck(service, oldSaved);
  checks.push({ name: 'old-save-restored-in-new-package', status: 'PASS', comparedFields: Object.keys(snapshot(view)) });
  view = await act(service, { action: 'free_action', action_text: '我继续观察眼前的现场', run_id: runId, expected_turn: view.turn, client_action_id: randomUUID() });
  assert.equal(view.freeActionEvent.accepted, true);
  assert.equal(view.dsh.reason, 'DEEPSEEK_API_KEY_NOT_CONFIGURED');
  const newSaved = await act(service, { action: 'save' });
  await stopPackage(service);
  service = await startPackage(newPackage);
  const restarted = await resumeAndCheck(service, newSaved);
  checks.push({ name: 'new-save-survives-new-package-restart', status: 'PASS' });
  await stopPackage(service);

  service = await startPackage(oldPackage);
  await resumeAndCheck(service, restarted);
  checks.push({ name: 'new-save-readable-after-binary-rollback', status: 'PASS' });
  await stopPackage(service);

  service = await startPackage(newPackage);
  await act(service, { action: 'start', role_id: 'zhunin' });
  for (const choice_id of ['CHOICE_001_PROTECT_REPORT', 'CHOICE_005_SEND_EVIDENCE_ZN', 'CHOICE_010_ENTER_DEEP_FIELD', 'CHOICE_011_STAY_AND_SHARE', 'CHOICE_013_CHECK_OUTSIDE_ZN', 'CHOICE_018_OBSERVE_TESTIMONY_ZN']) {
    await act(service, { action: 'submit_choice', choice_id });
  }
  await act(service, { action: 'resolve_interactive_event', event_id: 'IE_ZN_TRACK_CONFRONTATION', result_id: 'IER_ZN_TRACK_SUCCESS' });
  const ending = await act(service, { action: 'submit_choice', choice_id: 'CHOICE_020_PROTECT_IN_TIME' });
  assert.equal(ending.ending.id, 'END_01');
  assert.equal(ending.flags.endingCommitted, true);
  assert.equal(ending.dsh.configured, false);
  checks.push({ name: 'new-package-offline-ending', status: 'PASS', ending: ending.ending.id });
  await stopPackage(service);

  const report = {
    schema: 'feitu-world/desktop-upgrade-acceptance/v1', status: 'PASS', testedAt: new Date().toISOString(),
    from, to, executionMode: 'each release EXE running its packaged server via ELECTRON_RUN_AS_NODE',
    archives: [{ version: from, sha256: oldPackage.sha256 }, { version: to, sha256: newPackage.sha256 }],
    isolatedSaves: true, apiKeyConfigured: false, checks,
    limits: ['Does not exercise renderer clicks or Steam client installation.', 'Rollback compatibility is proven only for these two versions and their unchanged save format.']
  };
  const reportPath = join(artifactsRoot, `FeituWorld-${from}-to-${to}-upgrade-verification.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await rm(testRoot, { recursive: true, force: true });
  console.log(JSON.stringify({ ...report, report: relative(projectRoot, reportPath) }, null, 2));
} catch (error) {
  console.error(`Upgrade acceptance failed; isolated evidence retained at ${testRoot}`);
  throw error;
} finally {
  for (const service of activeServices) await stopPackage(service);
}
