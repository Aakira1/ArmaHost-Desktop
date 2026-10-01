const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('armaDesktop', Object.freeze({
  pick: kind => ipcRenderer.invoke('desktop:pick', kind),
  openData: () => ipcRenderer.invoke('desktop:data'),
  openVpnGuide: () => ipcRenderer.invoke('desktop:vpn-guide'),
  copyText: text => ipcRenderer.invoke('desktop:copy', String(text)),
  about: () => ipcRenderer.invoke('desktop:about'),
  updates: Object.freeze({
    state: () => ipcRenderer.invoke('update:get-state'),
    checkNow: token => ipcRenderer.invoke('update:check-now', token),
    setAuto: value => ipcRenderer.invoke('update:set-auto', value === true),
    skip: () => ipcRenderer.invoke('update:skip'),
    install: () => ipcRenderer.invoke('update:install'),
    openReleases: () => ipcRenderer.invoke('update:open-releases'),
    onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('update:state', listener); return () => ipcRenderer.removeListener('update:state', listener); }
  }),
  setDirty: value => ipcRenderer.send('desktop:dirty', value === true)
}));
