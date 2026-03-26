const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File path from drag-and-drop (Electron 28+ requires webUtils)
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // License
  getLicense: () => ipcRenderer.invoke('license:get'),
  activateLicense: (key) => ipcRenderer.invoke('license:activate', key),
  checkQuota: (count) => ipcRenderer.invoke('license:checkQuota', count),
  recordUsage: (sessionId, count, colorCounts) =>
    ipcRenderer.invoke('license:recordUsage', sessionId, count, colorCounts),

  // File dialogs
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  selectOutputFolder: () => ipcRenderer.invoke('dialog:selectOutputFolder'),
  openInExplorer: (folderPath) => ipcRenderer.invoke('shell:openFolder', folderPath),

  // Settings
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // Claude Vision API
  getClaudeKeyStatus: () => ipcRenderer.invoke('settings:getClaudeKey'),
  setClaudeKey: (key) => ipcRenderer.invoke('settings:setClaudeKey', key),

  // History
  getHistory: () => ipcRenderer.invoke('history:list'),
  deleteHistory: (id) => ipcRenderer.invoke('history:delete', id),
  renameHistory: (id, name) => ipcRenderer.invoke('history:rename', id, name),
  getOutputPath: (sessionId) => ipcRenderer.invoke('history:getOutputPath', sessionId),
  getSessionFiles: (sessionId) => ipcRenderer.invoke('history:getSessionFiles', sessionId),

  // Worker
  getWorkerHealth: () => ipcRenderer.invoke('worker:health'),
  getWorkerPort: () => ipcRenderer.invoke('worker:port'),

  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),
  getUserDataPath: () => ipcRenderer.invoke('app:userData'),
});
