import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function isSettingsSender(event, window, expectedUrl) {
  return Boolean(window && !window.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame?.url === expectedUrl);
}

export function createSettingsController({ app, BrowserWindow, Menu, ipcMain, shell, dialog,
  modelConfig, getMainWindow, buildInfo, log, smoke = false }) {
  const html = join(app.getAppPath(), 'settings.html');
  const expectedUrl = pathToFileURL(html).href;
  let window;
  let restartRequired = false;

  async function getStatus() {
    return { ...await modelConfig.getStatus(), version: app.getVersion(),
      distribution: buildInfo.distribution, restartRequired };
  }

  async function openFolder(kind) {
    if (!['saves', 'logs'].includes(kind)) throw new Error('Unsupported folder.');
    const path = join(app.getPath('userData'), kind);
    await mkdir(path, { recursive: true });
    if (await shell.openPath(path)) throw new Error('Could not open folder.');
    return { opened: true };
  }

  function register(name, action) {
    ipcMain.handle(`feitu:settings:${name}`, async (event, payload) => {
      if (!isSettingsSender(event, window, expectedUrl)) return { ok: false, error: '此页面无权访问桌面设置。' };
      try { return { ok: true, data: await action(payload) }; }
      catch (error) {
        log('WARN', 'settings_action_failed', { action: name });
        return { ok: false, error: error?.name === 'ModelConfigError'
          ? error.message : '操作未完成，请检查本机数据目录后重试。' };
      }
    });
  }
  register('get', getStatus);
  register('save', async (input) => {
    await modelConfig.save(input);
    restartRequired = true;
    log('INFO', 'settings_saved');
    return getStatus();
  });
  register('clear-key', async () => {
    await modelConfig.clearKey();
    restartRequired = true;
    log('INFO', 'settings_key_removed');
    return getStatus();
  });
  register('open-folder', openFolder);
  register('restart', async () => {
    if (smoke) return { restarting: false };
    const { response } = await dialog.showMessageBox(window, {
      type: 'question', title: '重启游戏', message: '现在重启以应用设置？',
      detail: '请先等待当前行动完成。已保存的进度不会被删除。',
      buttons: ['重启游戏', '取消'], defaultId: 1, cancelId: 1, noLink: true
    });
    if (response === 0) setImmediate(() => { app.relaunch(); app.quit(); });
    return { restarting: response === 0 };
  });
  register('close', () => {
    setImmediate(() => window?.close());
    return { closed: true };
  });

  async function open() {
    if (window && !window.isDestroyed()) {
      if (!smoke) { window.show(); window.focus(); }
      return window;
    }
    const next = new BrowserWindow({
      width: 720, height: 860, minWidth: 580, minHeight: 620,
      title: '设置 · 废土末班车', backgroundColor: '#0c1315',
      parent: getMainWindow(), show: false, autoHideMenuBar: true,
      webPreferences: { preload: join(app.getAppPath(), 'settings-preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    window = next;
    next.setMenu(null);
    next.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    next.webContents.on('will-navigate', (event) => event.preventDefault());
    next.webContents.on('will-attach-webview', (event) => event.preventDefault());
    next.on('closed', () => { if (window === next) window = undefined; });
    next.once('ready-to-show', () => { if (!smoke) next.show(); });
    await next.loadFile(html);
    return next;
  }

  function reportOpenFailure() {
    log('WARN', 'settings_window_failed');
    if (!smoke) dialog.showErrorBox('无法打开设置', '请验证或重新解压游戏文件后重试。');
  }
  return {
    open,
    close: () => window?.destroy(),
    installMenu(target) {
      target.setMenu(Menu.buildFromTemplate([
        { label: '游戏', submenu: [
          { label: '在线剧情与数据设置…', accelerator: 'CmdOrCtrl+,', click: () => { void open().catch(reportOpenFailure); } },
          { type: 'separator' }, { role: 'quit', label: '退出游戏' }
        ] },
        { label: '帮助', submenu: ['saves', 'logs'].map((kind) => ({
          label: kind === 'saves' ? '打开存档文件夹' : '打开日志文件夹',
          click: () => { void openFolder(kind).catch(() => {
            log('WARN', 'settings_folder_failed', { kind });
            if (!smoke) dialog.showErrorBox('无法打开文件夹', '请检查当前账户的数据目录权限后重试。');
          }); }
        })) }
      ]));
    }
  };
}
