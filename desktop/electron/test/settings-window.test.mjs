import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createSettingsController, isSettingsSender } from '../settings-window.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'feitu-settings-window-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const handlers = new Map();
  const calls = [];
  const logs = [];
  const frames = [];
  const status = { mode: 'environment', hasSavedKey: false };
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: pathToFileURL(join(root, 'settings.html')).href };
      this.webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler; };
      frames.push(this);
    }
    isDestroyed() { return false; }
    setMenu(menu) { this.menu = menu; }
    async loadFile(path) { this.path = path; }
    show() {}
    focus() {}
    destroy() { this.emit('closed'); }
  }
  const modelConfig = {
    getStatus: async () => status,
    save: async (value) => { calls.push(value); },
    clearKey: async () => { calls.push('clear'); }
  };
  const controller = createSettingsController({
    app: { getAppPath: () => root, getPath: () => root, getVersion: () => '1.2.3' },
    BrowserWindow: FakeWindow, Menu: { buildFromTemplate: (value) => value },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    shell: { openPath: async (path) => { calls.push(path); return ''; } },
    dialog: {}, modelConfig, getMainWindow: () => null,
    buildInfo: { distribution: 'test' }, log: (...args) => logs.push(args), smoke: true
  });
  const window = await controller.open();
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const invoke = (name, payload, sender = event) => handlers.get(`feitu:settings:${name}`)(sender, payload);
  return { controller, window, event, invoke, calls, logs, modelConfig, frames };
}

test('only the settings main frame at the exact packaged URL may invoke IPC', async (t) => {
  const { event, window, invoke, calls } = await fixture(t);
  assert.equal(isSettingsSender(event, window, event.senderFrame.url), true);
  for (const sender of [
    { ...event, sender: {} },
    { ...event, senderFrame: { url: event.senderFrame.url } },
    { ...event, senderFrame: { url: 'https://example.invalid/' } }
  ]) assert.equal((await invoke('save', {}, sender)).ok, false);
  event.senderFrame.url += '#untrusted';
  assert.equal((await invoke('clear-key')).ok, false);
  assert.deepEqual(calls, []);
});

test('saving and clearing only return public status and require a restart', async (t) => {
  const { invoke, calls } = await fixture(t);
  assert.equal((await invoke('get')).data.restartRequired, false);
  const saved = await invoke('save', { mode: 'offline' });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.restartRequired, true);
  assert.equal(saved.data.version, '1.2.3');
  assert.equal((await invoke('clear-key')).ok, true);
  assert.deepEqual(calls, [{ mode: 'offline' }, 'clear']);
});

test('unexpected backend errors never return or log their message', async (t) => {
  const { invoke, modelConfig, logs } = await fixture(t);
  modelConfig.save = async () => { throw new Error('private-input-marker'); };
  const response = await invoke('save', {});
  assert.equal(response.ok, false);
  assert.equal(JSON.stringify([response, logs]).includes('private-input-marker'), false);
});

test('settings are sandboxed, cannot navigate, and expose no arbitrary folder opening', async (t) => {
  const { controller, window, invoke, calls, frames } = await fixture(t);
  assert.deepEqual(window.options.webPreferences, {
    preload: join(window.path, '..', 'settings-preload.cjs'),
    contextIsolation: true, nodeIntegration: false, sandbox: true
  });
  assert.deepEqual(window.openHandler(), { action: 'deny' });
  let prevented = false;
  window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal((await invoke('open-folder', '../private')).ok, false);
  assert.deepEqual(calls, []);
  assert.equal((await invoke('open-folder', 'saves')).ok, true);
  const target = { setMenu(value) { this.menu = value; } };
  controller.installMenu(target);
  assert.equal(target.menu[0].submenu[0].accelerator, 'CmdOrCtrl+,');
  await controller.open();
  assert.equal(frames.length, 1);
});
