const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('iconGenerator', {
  generate: (payload) => ipcRenderer.invoke('generate-icon', payload),
  chooseOutputFolder: () => ipcRenderer.invoke('choose-output-folder'),
  getOutputFolder: () => ipcRenderer.invoke('get-output-folder'),
  openOutputFolder: (outputDirectory) => ipcRenderer.invoke('open-output-folder', outputDirectory),
  listIcons: (outputDirectory) => ipcRenderer.invoke('list-icons', outputDirectory),
  deleteIcon: (payload) => ipcRenderer.invoke('delete-icon', payload),
  restoreIcon: (payload) => ipcRenderer.invoke('restore-icon', payload),
  getVersion: () => ipcRenderer.invoke('get-version'),
  showFile: (file) => ipcRenderer.invoke('show-file', file),
  openWowhead: () => ipcRenderer.invoke('open-wowhead'),
  onWowheadIconSelected: (callback) => ipcRenderer.on('wowhead-icon-selected', (_event, icon) => callback(icon))
});