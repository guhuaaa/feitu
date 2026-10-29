const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('feituSettings', Object.freeze({
  getStatus: () => ipcRenderer.invoke('feitu:settings:get'),
  save: ({ mode, apiKey, model, endpoint }) => ipcRenderer.invoke('feitu:settings:save', { mode, apiKey, model, endpoint }),
  clearKey: () => ipcRenderer.invoke('feitu:settings:clear-key'),
  openFolder: (folder) => ipcRenderer.invoke('feitu:settings:open-folder', folder),
  restart: () => ipcRenderer.invoke('feitu:settings:restart'),
  close: () => ipcRenderer.invoke('feitu:settings:close')
}));
