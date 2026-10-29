import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, crashReporter, dialog, ipcMain, Menu, safeStorage, session, shell } from 'electron';
import { migrateLegacySaves as migrateSaves } from './migrate-saves.mjs';
import { createModelConfig } from './model-config.mjs';
import { createSettingsController } from './settings-window.mjs';
import { loadSoakWindow, readSoakOptions, runDesktopSoak } from './soak-probe.mjs';

const productTitle = '废土末班车';
const isSmokeRun = process.env.FEITU_DESKTOP_SMOKE === '1';
const detectedLegacyUserDataPath = app.getPath('userData');
const legacyUserDataPath = isSmokeRun && process.env.FEITU_DESKTOP_TEST_LEGACY_USER_DATA
  ? resolve(process.env.FEITU_DESKTOP_TEST_LEGACY_USER_DATA)
  : detectedLegacyUserDataPath;
const stableUserDataPath = join(app.getPath('appData'), 'FeituWorld');
const soakOptions = readSoakOptions(process.env, stableUserDataPath);
const selectedUserDataPath = isSmokeRun && process.env.FEITU_DESKTOP_TEST_USER_DATA
  ? resolve(process.env.FEITU_DESKTOP_TEST_USER_DATA)
  : stableUserDataPath;
app.setPath('userData', selectedUserDataPath);
let appQuitting = false;
let logFile;
let mainWindow;
let runtimeProcess;
let runtimeReady = false;
let runtimeStopping = false;
let recoveryDialogOpen = false;
let modelConfig;
let desktopSettings;

function errorFields(error) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}

function log(level, event, details = {}) {
  const entry = { timestamp: new Date().toISOString(), level, event, ...details };
  const line = JSON.stringify(entry);
  const target = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  target(line);
  if (logFile) {
    try { appendFileSync(logFile, `${line}\n`, 'utf8'); }
    catch (error) { console.error('FEITU_LOG_WRITE_ERROR', error); }
  }
}

async function initializeLogs() {
  const logs = join(app.getPath('userData'), 'logs');
  await mkdir(logs, { recursive: true });
  logFile = join(logs, 'desktop.jsonl');
  try {
    if ((await stat(logFile)).size >= 2 * 1024 * 1024) {
      const previous = join(logs, 'desktop.previous.jsonl');
      await rm(previous, { force: true });
      await rename(logFile, previous);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function migrateLegacySaves() {
  if ((isSmokeRun && !process.env.FEITU_DESKTOP_TEST_LEGACY_USER_DATA) || resolve(legacyUserDataPath) === resolve(selectedUserDataPath)) return false;
  const result = await migrateSaves({ sourceUserDataPath: legacyUserDataPath, destinationUserDataPath: selectedUserDataPath });
  if (result) {
    log('INFO', 'legacy_saves_migrated', { from: result.source, to: result.destination, files: result.copied, preserved: result.preserved });
  }
  return Boolean(result);
}

function reserveLocalPort() {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('Could not reserve a local port.'));
        else resolvePort(port);
      });
    });
  });
}

function runtimeRoot() {
  if (app.isPackaged) return join(process.resourcesPath, 'player-runtime');
  return resolve(app.getAppPath(), '..', '..', 'release', 'staging', 'player-runtime');
}

async function readBuildInfo() {
  if (!app.isPackaged) return { distribution: 'development', version: app.getVersion() };
  try {
    const info = JSON.parse(await readFile(join(process.resourcesPath, 'build-info.json'), 'utf8'));
    if (info.version !== app.getVersion()) throw new Error(`Packaged version mismatch: app=${app.getVersion()}, build=${info.version}`);
    if (!['steam', 'github'].includes(info.distribution)) throw new Error(`Unsupported packaged distribution: ${info.distribution ?? 'missing'}`);
    return info;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Packaged build metadata is missing. Verify or reinstall the game files.', { cause: error });
    throw error;
  }
}

async function offerRestart(title, message) {
  if (recoveryDialogOpen || appQuitting || isSmokeRun) return;
  recoveryDialogOpen = true;
  try {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title,
      message,
      detail: `诊断日志：${join(app.getPath('userData'), 'logs', 'desktop.jsonl')}`,
      buttons: ['重启游戏', '退出'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (response === 0) app.relaunch();
    app.quit();
  } finally {
    recoveryDialogOpen = false;
  }
}

async function waitForRuntime(baseUrl, child) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Player runtime stopped during startup with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      const health = await response.json();
      if (response.ok && health.status === 'PASS' && health.runtimeContract === 'feitu-world/v1') return health;
      lastError = new Error('Player runtime returned an unexpected health response.');
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Player runtime did not become ready: ${lastError?.message ?? 'unknown error'}`);
}

async function startRuntime(buildInfo) {
  const root = runtimeRoot();
  const serverEntry = join(root, 'server.mjs');
  await access(serverEntry);
  const saves = join(app.getPath('userData'), 'saves');
  await mkdir(saves, { recursive: true });
  const port = await reserveLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const configured = await modelConfig.applyToEnv(process.env);
  if (configured.warning) log('WARN', 'model_settings_unavailable', { reason: configured.warning });
  const env = {
    ...configured.env,
    ELECTRON_RUN_AS_NODE: '1',
    FEITU_DESKTOP_VERSION: app.getVersion(),
    FEITU_DISTRIBUTION: buildInfo.distribution,
    FEITU_PORT: String(port),
    FEITU_STORAGE_DIR: saves
  };
  delete env.NODE_OPTIONS;

  runtimeStopping = false;
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  runtimeProcess = child;
  child.stdout.on('data', (chunk) => log('INFO', 'runtime_stdout', { text: String(chunk).trim() }));
  child.stderr.on('data', (chunk) => log('WARN', 'runtime_stderr', { text: String(chunk).trim() }));
  const processError = new Promise((_resolve, reject) => {
    child.once('error', (error) => {
      log('ERROR', 'runtime_process_error', errorFields(error));
      reject(error);
    });
  });
  child.once('exit', (code, signal) => {
    log(runtimeStopping || appQuitting ? 'INFO' : 'ERROR', 'runtime_exit', { code, signal, expected: runtimeStopping || appQuitting });
    runtimeProcess = undefined;
    if (runtimeReady && !runtimeStopping && !appQuitting) {
      void offerRestart('游戏服务意外停止', `本地游戏服务已停止（代码 ${code ?? 'unknown'}）。`);
    }
  });

  const health = await Promise.race([waitForRuntime(baseUrl, child), processError]);
  runtimeReady = true;
  log('INFO', 'runtime_ready', { port, runtimeContract: health.runtimeContract, deepseekConfigured: health.deepseek?.configured === true });
  return baseUrl;
}

function stopRuntime() {
  runtimeStopping = true;
  runtimeReady = false;
  if (runtimeProcess && runtimeProcess.exitCode === null) runtimeProcess.kill();
}

function exitFailedSmoke() {
  appQuitting = true;
  stopRuntime();
  app.exit(1);
}

async function smokeSettings() {
  if (!process.env.FEITU_DESKTOP_TEST_USER_DATA || resolve(selectedUserDataPath) === resolve(stableUserDataPath)) {
    throw new Error('Settings smoke requires an isolated test userData directory.');
  }
  const window = await desktopSettings.open();
  const probeKey = 'desktop-settings-smoke-value';
  const launcherProbeKey = 'launcher-smoke-value';
  const publicStatus = await window.webContents.executeJavaScript(`(async () => {
    const wait = async (test) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await test()) return;
        await new Promise((done) => setTimeout(done, 50));
      }
      throw new Error('Settings UI did not become ready.');
    };
    await wait(() => window.feituSettings && !document.getElementById('save-settings').disabled);
    const mode = document.getElementById('mode');
    mode.value = 'saved'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('api-key').value = ${JSON.stringify(probeKey)};
    document.getElementById('model').value = 'deepseek-chat';
    document.getElementById('endpoint').value = 'https://api.deepseek.com/chat/completions';
    document.getElementById('settings-form').requestSubmit();
    await wait(async () => {
      const reply = await window.feituSettings.getStatus();
      return reply.ok && reply.data.mode === 'saved' && reply.data.hasSavedKey && reply.data.restartRequired;
    });
    await wait(() => !document.getElementById('save-settings').disabled && document.getElementById('api-key').value === '');
    const reply = await window.feituSettings.getStatus();
    return reply.data;
  })()`);
  const stored = await readFile(join(app.getPath('userData'), 'model-settings.json'), 'utf8');
  const configured = await modelConfig.applyToEnv({ DEEPSEEK_API_KEY: launcherProbeKey });
  const preferences = window.webContents.getLastWebPreferences();
  if (!publicStatus.hasSavedKey || !publicStatus.secureStorageAvailable
    || JSON.stringify(publicStatus).includes(probeKey) || stored.includes(probeKey)
    || configured.env.DEEPSEEK_API_KEY !== probeKey || configured.warning
    || !preferences.sandbox || !preferences.contextIsolation || preferences.nodeIntegration
    || await mainWindow.webContents.executeJavaScript('typeof window.feituSettings') !== 'undefined'
    || await window.webContents.executeJavaScript('typeof require') !== 'undefined') {
    throw new Error('Settings encryption or window isolation smoke failed.');
  }
  await writeFile(join(app.getPath('userData'), 'settings-preview.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`(() => {
    document.getElementById('endpoint').value = 'invalid-address';
    const mode = document.getElementById('mode');
    mode.value = 'offline'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('settings-form').requestSubmit();
  })()`);
  let offlineSelected = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await modelConfig.getStatus()).mode === 'offline') { offlineSelected = true; break; }
    await new Promise((done) => setTimeout(done, 50));
  }
  if (!offlineSelected) throw new Error('Invalid hidden fields prevented offline selection.');
  const cleared = await window.webContents.executeJavaScript('window.feituSettings.clearKey()');
  const offline = await modelConfig.applyToEnv({ DEEPSEEK_API_KEY: launcherProbeKey });
  if (!cleared.ok || cleared.data.hasSavedKey || cleared.data.mode !== 'offline'
    || offline.env.DEEPSEEK_API_KEY) throw new Error('Settings key removal smoke failed.');
  log('INFO', 'settings_smoke_pass', { encryptedRoundTrip: true, rendererSecretAbsent: true,
    mainWindowBridgeAbsent: true, sandboxedSettings: true, keyRemovalOffline: true,
    invalidHiddenFieldsAllowOffline: true });
  await modelConfig.save({ mode: 'saved', apiKey: probeKey });
  desktopSettings.close();
}

async function createWindow(baseUrl) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: `${productTitle} v${app.getVersion()}`,
    backgroundColor: '#06090a',
    autoHideMenuBar: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow = window;
  desktopSettings.installMenu(window);
  const allowedOrigin = new URL(baseUrl).origin;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === allowedOrigin) return;
    } catch {}
    event.preventDefault();
    if (url.startsWith('https://')) void shell.openExternal(url);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    log(details.reason === 'clean-exit' ? 'INFO' : 'ERROR', 'renderer_gone', details);
    if (details.reason !== 'clean-exit') void offerRestart('游戏画面异常退出', '渲染进程已停止。');
  });
  window.on('unresponsive', () => log('WARN', 'window_unresponsive'));
  if (!soakOptions) window.once('ready-to-show', () => { if (!isSmokeRun) window.show(); });
  window.webContents.once('did-finish-load', () => {
    window.setTitle(`${productTitle} v${app.getVersion()}${soakOptions ? ' · 稳定性测试，请勿操作' : ''}`);
    log('INFO', 'desktop_ready', { version: app.getVersion() });
    if (isSmokeRun && !soakOptions && process.env.FEITU_DESKTOP_SETTINGS_SMOKE !== '1') setTimeout(() => app.quit(), 1000);
  });
  window.on('closed', () => { desktopSettings.close(); if (mainWindow === window) mainWindow = undefined; });
  const load = () => window.loadURL(`${baseUrl}/preview.html`);
  if (soakOptions) await loadSoakWindow(window, load);
  else await load();
}

crashReporter.start({ productName: 'FeituWorld', companyName: 'Feitu World contributors', submitURL: '', uploadToServer: false, compress: true });
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.feitu.world');
    await initializeLogs();
    await migrateLegacySaves();
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    const buildInfo = await readBuildInfo();
    modelConfig = createModelConfig({ userDataPath: app.getPath('userData'), safeStorage });
    if (soakOptions) await modelConfig.save({ mode: 'offline' });
    desktopSettings = createSettingsController({ app, BrowserWindow, Menu, ipcMain, shell, dialog,
      modelConfig, getMainWindow: () => mainWindow, buildInfo, log, smoke: isSmokeRun });
    log('INFO', 'desktop_start', { version: app.getVersion(), distribution: buildInfo.distribution, packaged: app.isPackaged, userData: app.getPath('userData') });
    const baseUrl = await startRuntime(buildInfo);
    if (soakOptions) {
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        let permitted = false;
        try { const url = new URL(details.url); permitted = url.origin === baseUrl || url.protocol === 'data:'; } catch {}
        callback({ cancel: !permitted });
      });
    }
    await createWindow(baseUrl);
    if (soakOptions) {
      const budget = soakOptions.mode === 'run' ? soakOptions.minutes * 60000 + 60000 : 60000;
      const watchdog = setTimeout(() => { log('ERROR', 'desktop_soak_timeout'); exitFailedSmoke(); }, budget);
      try {
        await runDesktopSoak({ window: mainWindow, baseUrl, userDataPath: app.getPath('userData'),
          ...soakOptions, version: app.getVersion(), distribution: buildInfo.distribution, log });
      } finally { clearTimeout(watchdog); }
      app.quit();
    } else if (isSmokeRun && process.env.FEITU_DESKTOP_SETTINGS_SMOKE === '1') {
      await smokeSettings();
      app.quit();
    }
  }).catch((error) => {
    log('ERROR', 'desktop_startup_error', errorFields(error));
    if (isSmokeRun) { exitFailedSmoke(); return; }
    dialog.showErrorBox('废土末班车启动失败', error.message);
    app.quit();
  });
  app.on('before-quit', () => { appQuitting = true; stopRuntime(); });
  app.on('window-all-closed', () => app.quit());
}
