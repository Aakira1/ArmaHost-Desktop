const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('armaDesktop', Object.freeze({
  pick: kind => ipcRenderer.invoke('desktop:pick', kind),
  openData: () => ipcRenderer.invoke('desktop:data'),
  openVpnGuide: () => ipcRenderer.invoke('desktop:vpn-guide'),
  checkUpdate: token => ipcRenderer.invoke('desktop:update-check', token),
  downloadUpdate: () => ipcRenderer.invoke('desktop:update-download'),
  installUpdate: () => ipcRenderer.invoke('desktop:update-install'),
  openReleases: () => ipcRenderer.invoke('desktop:update-releases'),
  setDirty: value => ipcRenderer.send('desktop:dirty', value === true)
}));
