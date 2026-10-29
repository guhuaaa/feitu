import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { release as osRelease } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { classifySoakFailure } from '../desktop/electron/soak-probe.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopRoot = join(projectRoot, 'desktop', 'electron');

export function parseSoakArgs(args) {
  const options = { channel: 'steam', minutes: 60, development: false };
  const used = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (used.has(flag)) throw new Error('Duplicate soak option.');
    used.add(flag);
    if (flag === '--development') options.development = true;
    else if (flag === '--channel') {
      const value = args[++index];
      if (!['steam', 'github'].includes(value)) throw new Error('Channel must be steam or github.');
      options.channel = value;
    } else if (flag === '--minutes') {
      const value = args[++index];
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1 || Number(value) > 240) throw new Error('Minutes must be an integer from 1 to 240.');
      options.minutes = Number(value);
    } else throw new Error('Usage: release:soak -- [--channel steam|github] [--minutes 1..240] [--development]');
  }
  return options;
}

export function summarizeMemory(samples) {
  if (!samples.length) throw new Error('No process memory samples were collected.');
  for (const sample of samples) {
    if (!Number.isFinite(sample.workingSetBytes) || sample.workingSetBytes <= 0
      || !Number.isFinite(sample.privateBytes) || sample.privateBytes < 0 || sample.processCount < 1) throw new Error('Invalid memory sample.');
  }
  const mib = (value) => Math.round(value / 1048576 * 100) / 100;
  return { sampleCount: samples.length, intervalMs: 15000,
    observedPeakWorkingSetMiB: mib(Math.max(...samples.map((sample) => sample.workingSetBytes))),
    observedPeakPrivateMiB: mib(Math.max(...samples.map((sample) => sample.privateBytes))),
    finalWorkingSetMiB: mib(samples.at(-1).workingSetBytes),
    note: 'Sampled aggregate of this EXE and descendants, not a continuous OS high-water mark or proof of no memory leak. Working-set sums may double-count shared pages; private bytes measure commit, not resident RAM.' };
}

const failureStages = new Set(['startup', 'health_check', 'resume_report', 'resume_control', 'role_switch',
  'game_start', 'free_action', 'checkpoint_save', 'checkpoint_restore', 'run_resume', 'unknown_action',
  'drawers', 'capture_start', 'capture_final', 'capture_resume', 'capture_unknown', 'report_write', 'story_action', 'item_take']);

export function assertSoakCoverage(probe) {
  const coverage = probe?.coverage;
  for (const [field, required] of Object.entries({ visitedLocationIds: ['L001', 'L002', 'L003', 'L004', 'L005', 'L006'],
    newItemIds: ['I006', 'I004', 'I005'], endingIds: ['END_01'] })) {
    assert.ok(Array.isArray(coverage?.[field]) && required.every((id) => coverage[field].includes(id)), 'DESKTOP_SOAK_COVERAGE_INCOMPLETE');
  }
  for (const [field, minimum] of Object.entries({ maxRunTurn: 20, maxRunActionCount: 25, completedJourneyCount: 1 })) {
    assert.ok(Number.isInteger(coverage?.[field]) && coverage[field] >= minimum, 'DESKTOP_SOAK_COVERAGE_INCOMPLETE');
  }
}

export async function readSoakBuildBinding(packageRoot, version, channel) {
  const info = JSON.parse(await readFile(join(packageRoot, 'resources', 'build-info.json'), 'utf8'));
  assert.equal(info.version, version, 'DESKTOP_SOAK_BUILD_MISMATCH');
  assert.equal(info.distribution, channel, 'DESKTOP_SOAK_BUILD_MISMATCH');
  assert.match(info.sourceFingerprint ?? '', /^[a-f0-9]{64}$/, 'DESKTOP_SOAK_BUILD_MISMATCH');
  const hash = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
  return { version, distribution: channel, sourceFingerprint: info.sourceFingerprint, builtAt: info.builtAt,
    appAsarSha256: await hash(join(packageRoot, 'resources', 'app.asar')),
    checksumsSha256: await hash(join(packageRoot, 'checksums.sha256')) };
}

export function assertSoakExit(mode, result, logText = '') {
  const entries = logText.split(/\r?\n/).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const failure = entries.findLast((entry) => entry?.event === 'desktop_soak_failure')
    ?? entries.findLast((entry) => ['desktop_soak_timeout', 'desktop_startup_error'].includes(entry?.event));
  if (failure) {
    const code = failure.event === 'desktop_soak_failure' ? classifySoakFailure({ message: failure.code }).code
      : failure.event === 'desktop_soak_timeout' ? 'DESKTOP_SOAK_TIMEOUT' : 'DESKTOP_SOAK_PHASE_FAILED';
    const stage = failureStages.has(failure.stage) ? failure.stage : 'unknown';
    throw new Error(`${code}: mode=${mode}, stage=${stage}`);
  }
  assert.equal(result.code, 0, `Desktop ${mode} did not exit cleanly.`);
}

export async function readSoakPhaseReport(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('DESKTOP_SOAK_OUTPUT_MISSING'); throw error; }
}

async function sampleMemory(pid, allowStopped = false) {
  assert.ok(Number.isInteger(pid) && pid > 0);
  const script = `
$ErrorActionPreference = 'Stop'
$soakRows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
$soakIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$soakIds.Add(${pid})
do {
  $soakAdded = $false
  foreach ($soakRow in $soakRows) {
    if ($soakIds.Contains([int]$soakRow.ParentProcessId) -and $soakIds.Add([int]$soakRow.ProcessId)) { $soakAdded = $true }
  }
} while ($soakAdded)
$soakValues = @(Get-Process -Id @($soakIds) -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{ pid=$_.Id; workingSetBytes=$_.WorkingSet64; privateBytes=$_.PrivateMemorySize64 }
})
ConvertTo-Json -InputObject $soakValues -Compress
`;
  const env = { ...process.env };
  delete env.PSModulePath;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    env, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024
  });
  const rows = JSON.parse(stdout.trim());
  assert.ok(Array.isArray(rows) && (allowStopped || rows.some((row) => row.pid === pid)), 'The owned EXE disappeared while sampling.');
  return { timestamp: new Date().toISOString(), rootPid: pid, processCount: rows.length,
    workingSetBytes: rows.reduce((sum, row) => sum + row.workingSetBytes, 0),
    privateBytes: rows.reduce((sum, row) => sum + row.privateBytes, 0), processIds: rows.map((row) => row.pid) };
}

async function runSoak(options) {
  if (process.platform !== 'win32') throw new Error('Desktop soak acceptance requires Windows.');
  const packageJson = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
  const packageRoot = options.development ? desktopRoot : options.channel === 'steam'
    ? join(projectRoot, 'release', 'staging', 'steam-windows')
    : join(projectRoot, 'release', 'staging', 'github-windows', `FeituWorld-${packageJson.version}-windows-x64`);
  const executable = options.development ? join(desktopRoot, 'node_modules', 'electron', 'dist', 'electron.exe') : join(packageRoot, 'FeituWorld.exe');
  if (!options.development) {
    const verifier = options.channel === 'steam' ? 'verify-steam-candidate.mjs' : 'verify-github-candidate.mjs';
    const verification = await execFileAsync(process.execPath, [join(desktopRoot, 'scripts', verifier)], { cwd: desktopRoot, windowsHide: true, timeout: 120000 });
    console.log(verification.stdout.trim());
  }
  const build = options.development ? null : await readSoakBuildBinding(packageRoot, packageJson.version, options.channel);
  const artifacts = join(projectRoot, 'release', 'artifacts');
  const testParent = join(projectRoot, 'release', 'test-data');
  await mkdir(testParent, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  const testRoot = await mkdtemp(join(testParent, 'desktop-soak-'));
  const label = options.development ? 'development' : options.channel;
  const prefix = `FeituWorld-${packageJson.version}-${label}-${options.minutes}min-soak`;
  const reportPath = join(artifacts, `${prefix}.json`);
  const report = { schema: 'feitu-world/desktop-soak-acceptance/v1', status: 'RUNNING',
    version: packageJson.version, ...options, build, startedAt: new Date().toISOString(), windowsVersion: osRelease(),
    executable: relative(projectRoot, executable), testData: relative(projectRoot, testRoot),
    runnerSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    samples: [], samplingErrors: [], exitChecks: [],
    limits: ['Offline deterministic UI workflow on this Windows host, not clean Windows 10/11 or real Steam client acceptance.',
      'A short pilot is not evidence of a 60-minute pass. No paid model service is contacted.'] };
  let active;
  let interrupted = false;
  const abort = () => { interrupted = true; };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  async function publish() {
    const temporary = `${reportPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await rename(temporary, reportPath);
  }
  async function stopOwnedTree() {
    if (active && active.child.exitCode === null && active.child.signalCode === null) {
      await execFileAsync('taskkill.exe', ['/PID', String(active.child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }).catch(() => {});
      await Promise.race([active.closed, new Promise((done) => setTimeout(done, 5000))]);
    }
  }
  async function launch(mode) {
    const env = { ...process.env, DEEPSEEK_API_KEY: '', FEITU_DESKTOP_SMOKE: '1',
      FEITU_DESKTOP_SETTINGS_SMOKE: '0', FEITU_DESKTOP_UI_SOAK: mode,
      FEITU_DESKTOP_UI_SOAK_MINUTES: String(options.minutes), FEITU_DESKTOP_TEST_USER_DATA: testRoot };
    delete env.FEITU_DESKTOP_TEST_LEGACY_USER_DATA;
    delete env.NODE_OPTIONS;
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, options.development ? [desktopRoot] : [], {
      cwd: packageRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    const running = { child };
    active = running;
    running.closed = new Promise((done) => {
      child.once('error', (error) => done({ error: error.message }));
      child.once('close', (code, signal) => done({ code, signal }));
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      let pending = '';
      stream.on('data', (chunk) => {
        const lines = `${pending}${chunk}`.split(/\r?\n/);
        pending = lines.pop();
        for (const line of lines) {
          try { const entry = JSON.parse(line); if (entry.event === 'desktop_soak_progress') console.log(JSON.stringify(entry)); } catch {}
        }
      });
    }
    console.log(JSON.stringify({ event: 'desktop_soak_spawn', mode, pid: child.pid, report: relative(projectRoot, reportPath) }));
    const deadline = performance.now() + (mode === 'run' ? options.minutes * 60000 + 120000 : 60000);
    let nextSample = 0;
    let result;
    while (!result) {
      if (interrupted) throw new Error('Desktop soak was interrupted.');
      if (performance.now() > deadline) throw new Error('Desktop soak exceeded its execution budget.');
      result = await Promise.race([running.closed, new Promise((done) => setTimeout(() => done(null), 1000))]);
      if (mode === 'run' && !result && performance.now() >= nextSample) {
        nextSample = performance.now() + 15000;
        try { report.samples.push(await sampleMemory(child.pid)); }
        catch (error) {
          if (child.exitCode === null && child.signalCode === null) report.samplingErrors.push({ timestamp: new Date().toISOString(), message: error.message });
        }
        await publish();
      }
    }
    const exitCheck = { mode, rootPid: child.pid, code: result.code ?? null, signal: result.signal ?? null };
    report.exitChecks.push(exitCheck);
    const logText = await readFile(join(testRoot, 'logs', 'desktop.jsonl'), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return ''; throw error;
    });
    const stoppedDeadline = performance.now() + 5000;
    let stopped;
    do {
      stopped = await sampleMemory(child.pid, true);
      if (!stopped.processCount) break;
      await new Promise((done) => setTimeout(done, 100));
    } while (performance.now() < stoppedDeadline);
    exitCheck.remainingProcessCount = stopped.processCount;
    assert.equal(stopped.processCount, 0, 'The game left descendant processes behind after exit.');
    active = undefined;
    assertSoakExit(mode, result, logText);
  }
  try {
    await publish();
    await launch('run');
    const first = await readSoakPhaseReport(join(testRoot, 'desktop-soak.json'));
    assert.equal(first.status, 'RUN_COMPLETE');
    assertSoakCoverage(first);
    assert.ok(first.elapsedMs >= options.minutes * 60000 && first.actionCount > 0 && first.saveCount > 0
      && first.cycleCount >= Math.max(2, Math.floor(options.minutes * 60000 / 45000)));
    assert.ok(first.roles?.includes('zhunin') && first.roles?.includes('linenchuan'));
    assert.equal(first.resumed, false);
    assert.equal(first.version, packageJson.version);
    await launch('resume');
    const probe = await readSoakPhaseReport(join(testRoot, 'desktop-soak.json'));
    assert.equal(probe.status, 'PASS');
    assertSoakCoverage(probe);
    assert.deepEqual(probe.coverage, first.coverage);
    assert.equal(probe.resumed, true);
    assert.equal(probe.stateSha256, first.stateSha256);
    assert.equal(probe.resumedStateSha256, first.stateSha256);
    const entries = (await readFile(join(testRoot, 'logs', 'desktop.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(!entries.some((entry) => entry.level === 'ERROR' || entry.event === 'window_unresponsive'));
    const starts = entries.filter((entry) => entry.event === 'runtime_ready');
    assert.ok(starts.length === 2 && starts.every((entry) => entry.deepseekConfigured === false));
    assert.ok(entries.some((entry) => entry.event === 'desktop_soak_run_complete') && entries.some((entry) => entry.event === 'desktop_soak_resume_complete'));
    assert.equal(report.samplingErrors.length, 0, 'Windows process sampling was incomplete.');
    assert.ok(report.samples.length >= Math.max(2, Math.floor(options.minutes * 60000 / 20000)), 'Too few process memory samples.');
    report.memory = summarizeMemory(report.samples);
    if (build) assert.deepEqual(await readSoakBuildBinding(packageRoot, packageJson.version, options.channel), build, 'DESKTOP_SOAK_BUILD_CHANGED');
    report.probe = probe;
    report.screenshots = [];
    for (const phase of ['start', 'final', 'resume']) {
      const target = join(artifacts, `${prefix}-${phase}.png`);
      await copyFile(join(testRoot, `soak-${phase}.png`), target);
      report.screenshots.push(relative(projectRoot, target));
    }
    report.status = 'PASS';
    report.meets60MinuteDuration = !options.development && options.minutes >= 60;
    report.finishedAt = new Date().toISOString();
    await publish();
    const cleanupRelative = relative(testParent, testRoot);
    assert.ok(cleanupRelative && !cleanupRelative.startsWith('..') && !isAbsolute(cleanupRelative));
    await rm(testRoot, { recursive: true, force: true });
    console.log(JSON.stringify({ status: report.status, version: packageJson.version, ...options,
      meets60MinuteDuration: report.meets60MinuteDuration, elapsedMs: probe.elapsedMs,
      actionCount: probe.actionCount, cycleCount: probe.cycleCount, saveCount: probe.saveCount,
      memory: report.memory, report: relative(projectRoot, reportPath) }, null, 2));
  } catch (error) {
    report.status = 'FAIL'; report.finishedAt = new Date().toISOString();
    report.failure = { message: error.message };
    await publish();
    throw new Error(`Desktop soak failed: ${error.message}. Evidence: ${relative(projectRoot, reportPath)}`, { cause: error });
  } finally {
    await stopOwnedTree();
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runSoak(parseSoakArgs(process.argv.slice(2)));
}
