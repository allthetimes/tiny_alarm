import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('alarmAPI', {
  load: () => ipcRenderer.invoke('alarms:load'),
  save: (alarms: unknown[]) => ipcRenderer.invoke('alarms:save', alarms),
  pickAudio: () => ipcRenderer.invoke('audio:pick'),
  loadHolidays: () => ipcRenderer.invoke('holidays:load'),
  openMusicSite: () => ipcRenderer.invoke('music:site'),
  openMusicApp: () => ipcRenderer.invoke('music:open'),
  onSoundsUpdated: (cb: () => void) => { ipcRenderer.on('sounds:updated', cb); },
  onDownloadDone: (cb: (saved: string, final: string) => void) => { ipcRenderer.on('download:done', (_e, saved, final) => cb(saved, final)); },
  listSounds: () => ipcRenderer.invoke('sounds:list'),
  renameSound: (oldName: string, newName: string) => ipcRenderer.invoke('sounds:rename', oldName, newName),
  deleteSound: (name: string) => ipcRenderer.invoke('sounds:delete', name)
});
