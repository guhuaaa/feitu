import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(desktopRoot, '..', '..');
const packageJson = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'));
const channelIndex = process.argv.indexOf('--channel');
const channel = channelIndex >= 0 ? process.argv[channelIndex + 1] : 'steam';
if (!['steam', 'github'].includes(channel)) throw new Error('channel must be steam or github.');
const development = process.argv.includes('--development');

const packageRoot = channel === 'steam'
  ? join(projectRoot, 'release', 'staging', 'steam-windows')
  : join(projectRoot, 'release', 'staging', 'github-windows', `FeituWorld-${packageJson.version}-windows-x64`);
const executable = development ? join(desktopRoot, 'node_modules', 'electron', 'dist', 'electron.exe') : join(packageRoot, 'FeituWorld.exe');
const testRoot = join(projectRoot, 'release', 'test-data', `desktop-smoke-${channel}-${process.pid}-${Date.now()}`);
const legacyRoot = `${testRoot}-legacy`;
const logPath = join(testRoot, 'logs', 'desktop.jsonl');
const migrationProbe = { schema: 'feitu-world/migration-probe/v1', channel };
let stdout = '';
let stderr = '';

await mkdir(testRoot, { recursive: true });
await mkdir(join(testRoot, 'saves'), { recursive: true });
await writeFile(join(testRoot, 'saves', 'steam_autocloud.vdf'), 'cloud-marker\n', 'utf8');
await mkdir(join(legacyRoot, 'saves'), { recursive: true });
await writeFile(join(legacyRoot, 'saves', 'migration-probe.json'), `${JSON.stringify(migrationProbe)}\n`, 'utf8');
async function runDesktop(settingsSmoke) {
const child = spawn(executable, development ? [desktopRoot] : [], {
  cwd: development ? desktopRoot : packageRoot,
  env: {
    ...process.env,
    DEEPSEEK_API_KEY: '',
    FEITU_DESKTOP_SMOKE: '1',
    FEITU_DESKTOP_SETTINGS_SMOKE: settingsSmoke ? '1' : '0',
    FEITU_DESKTOP_TEST_USER_DATA: testRoot,
    FEITU_DESKTOP_TEST_LEGACY_USER_DATA: legacyRoot
  },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-16384); });
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16384); });

return new Promise((resolveRun, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error(`Desktop smoke timed out after 30 seconds. Test data: ${testRoot}`));
  }, 30000);
  child.once('error', (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once('close', (code, signal) => {
    clearTimeout(timeout);
    resolveRun({ code, signal });
  });
});
}

const result = await runDesktop(true);

const logText = await readFile(logPath, 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error));
const entries = logText.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const events = entries.map((entry) => entry.event);
const requiredEvents = ['legacy_saves_migrated', 'desktop_start', 'runtime_ready', 'desktop_ready', 'settings_smoke_pass'];
const missingEvents = requiredEvents.filter((event) => !events.includes(event));
const errorEvents = entries.filter((entry) => entry.level === 'ERROR');
const copiedProbe = await readFile(join(testRoot, 'saves', 'migration-probe.json'), 'utf8').then(JSON.parse).catch(() => null);
const cloudMarkerPreserved = await readFile(join(testRoot, 'saves', 'steam_autocloud.vdf'), 'utf8').then((value) => value === 'cloud-marker\n').catch(() => false);
const startEntry = entries.find((entry) => entry.event === 'desktop_start');
const offlineStartupVerified = entries.find((entry) => entry.event === 'runtime_ready')?.deepseekConfigured === false;
const migrationVerified = JSON.stringify(copiedProbe) === JSON.stringify(migrationProbe) && cloudMarkerPreserved && resolve(startEntry?.userData ?? '') === resolve(testRoot);
if (!logText || result.code !== 0 || missingEvents.length || errorEvents.length || !migrationVerified || !offlineStartupVerified) {
  throw new Error(JSON.stringify({
    message: 'Desktop smoke failed.',
    channel,
    exitCode: result.code,
    signal: result.signal,
    missingEvents,
    errorEvents,
    logCreated: Boolean(logText),
    migrationVerified,
    offlineStartupVerified,
    stdout,
    stderr,
    testData: testRoot
  }, null, 2));
}

const restartResult = await runDesktop(false);
const restartLog = await readFile(logPath, 'utf8');
const restartEntries = restartLog.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const runtimeStarts = restartEntries.filter((entry) => entry.event === 'runtime_ready');
if (restartResult.code !== 0 || runtimeStarts.length !== 2 || runtimeStarts.at(-1).deepseekConfigured !== true
  || restartEntries.some((entry) => entry.level === 'ERROR')) {
  throw new Error(JSON.stringify({ message: 'Saved model configuration did not reach the runtime after restart.',
    channel, exitCode: restartResult.code, testData: testRoot, stdout, stderr }, null, 2));
}

const preview = join(projectRoot, 'release', 'artifacts', `FeituWorld-${packageJson.version}-${development ? 'development' : channel}-settings.png`);
await copyFile(join(testRoot, 'settings-preview.png'), preview);
await rm(testRoot, { recursive: true, force: true });
await rm(legacyRoot, { recursive: true, force: true });
console.log(JSON.stringify({
  schema: 'feitu-world/desktop-smoke/v1',
  status: 'PASS',
  version: packageJson.version,
  channel,
  development,
  executable: relative(projectRoot, executable),
  exitCode: result.code,
  requiredEvents,
  errorEvents: 0,
  legacySaveMigrationVerified: true,
  offlineStartupVerified: true,
  settingsUiAndEncryptionVerified: true,
  savedConfigurationAfterRestartVerified: true,
  settingsPreview: relative(projectRoot, preview),
  steamCloudMarkerPreserved: true
}, null, 2));
