import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('alarmAPI', {
  load: () => ipcRenderer.invoke('alarms:load'),
  save: (alarms: unknown[]) => ipcRenderer.invoke('alarms:save', alarms),
  pickAudio: () => ipcRenderer.invoke('audio:pick'),
  loadHolidays: () => ipcRenderer.invoke('holidays:load'),
  openMusicSite: () => ipcRenderer.invoke('music:site'),
  openMusicApp: () => ipcRenderer.invoke('music:open'),
  onSoundsUpdated: (cb: () => void) => { ipcRenderer.on('sounds:updated', cb); },
  onDownloadStarted: (cb: (token: string, name: string) => void) => { ipcRenderer.on('download:started', (_e, token, name) => cb(token, name)); },
  onDownloadBefore: (cb: (token: string, name: string) => void) => { ipcRenderer.on('download:before', (_e, token, name) => cb(token, name)); },
  onDownloadProgress: (cb: (token: string, name: string, received: number, total: number) => void) => { ipcRenderer.on('download:progress', (_e, token, name, received, total) => cb(token, name, received, total)); },
  onDownloadDone: (cb: (token: string, final: string) => void) => { ipcRenderer.on('download:done', (_e, token, final) => cb(token, final)); },
  onDownloadFailed: (cb: (token: string) => void) => { ipcRenderer.on('download:failed', (_e, token) => cb(token)); },
  confirmDownload: (token: string, name: string) => ipcRenderer.invoke('download:confirm', token, name),
  cancelDownload: (token: string) => ipcRenderer.invoke('download:cancel', token),
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  renameSound: (oldName: string, newName: string) => ipcRenderer.invoke('sounds:rename', oldName, newName),
  deleteSound: (name: string) => ipcRenderer.invoke('sounds:delete', name)
});
