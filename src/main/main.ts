import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HolidayConfig } from '../renderer/types';

let win: BrowserWindow | null = null;
let musicWin: BrowserWindow | null = null;
const MUSIC_SITE = 'https://flac.music.hi.cn/';
const DOWNLOAD_EXTS = /\.(mp3|wav|ogg|m4a|flac|aac|ape)$/i;
const SOUND_SCHEME = 'alarm-sound';
const storePath = () => path.join(app.getPath('userData'), 'alarms.json');
const soundsPath = () => app.isPackaged ? path.join(app.getPath('userData'), 'sounds') : path.join(process.cwd(), 'sounds');
const holidaysPath = () => path.join(app.getPath('userData'), 'legal-days.json');

async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }
function soundURL(filename: string) { return `${SOUND_SCHEME}://local/${encodeURIComponent(filename)}`; }
function baseNameOf(p: string) {
  try { const u = new URL(p); if (u.protocol === 'file:') return decodeURIComponent(path.basename(u.pathname)); } catch { /* 普通路径 */ }
  return path.basename(p);
}

async function readAlarms() {
  try {
    const alarms = JSON.parse(await fs.readFile(storePath(), 'utf8'));
    // 兼容旧数据：本地绝对路径/file:// 转成铃声协议地址
    for (const a of alarms) {
      if (a.soundPath && !a.soundPath.startsWith(`${SOUND_SCHEME}://`)) {
        const name = baseNameOf(a.soundPath);
        if (await exists(path.join(soundsPath(), name))) a.soundPath = soundURL(name);
      }
    }
    return alarms;
  }
  catch { return []; }
}

async function readHolidays(): Promise<HolidayConfig> {
  try { return JSON.parse(await fs.readFile(holidaysPath(), 'utf8')); }
  catch {
    const empty: HolidayConfig = { holidays: [], workdays: [] };
    try { await fs.writeFile(holidaysPath(), JSON.stringify(empty, null, 2), 'utf8'); } catch { /* 首次生成，失败则下次再试 */ }
    return empty;
  }
}

protocol.registerSchemesAsPrivileged([{ scheme: SOUND_SCHEME, privileges: { standard: true, stream: true, supportFetchAPI: true, bypassCSP: true } }]);

async function importDownloadedFile(file: string) {
  try {
    const ext = path.extname(file);
    const stem = path.basename(file, ext).replace(/[\\/:*?"<>|]/g, '_');
    let filename = `alarm-${stem}${ext}`;
    let index = 1;
    while (await exists(path.join(soundsPath(), filename))) filename = `alarm-${stem}_${index++}${ext}`;
    await fs.copyFile(file, path.join(soundsPath(), filename));
    win?.webContents.send('sounds:updated');
    return filename;
  } catch { return null; /* 导入失败时静默，用户仍可手动导入 */ }
}

function createMusicWindow() {
  if (musicWin && !musicWin.isDestroyed()) { musicWin.focus(); return; }
  musicWin = new BrowserWindow({
    width: 1000, height: 760, title: '音乐下载',
    parent: win || undefined, backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  musicWin.loadURL(MUSIC_SITE);
  // 禁止网站弹出任何新窗口，一律在当前内嵌窗口内打开
  musicWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) musicWin?.loadURL(url);
    return { action: 'deny' };
  });
  musicWin.webContents.session.on('will-download', (_event, item) => {
    const url = item.getURL();
    if (DOWNLOAD_EXTS.test(url) || DOWNLOAD_EXTS.test(item.getFilename())) {
      item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
      item.once('done', (_e, state) => {
        if (state === 'completed') {
          const file = item.getSavePath();
          const savedName = path.basename(file);
          importDownloadedFile(file).then(finalName => {
            if (finalName) win?.webContents.send('download:done', savedName, finalName);
          });
        }
      });
    }
  });
}

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({ width: 480, height: 880, minWidth: 420, minHeight: 640, backgroundColor: '#f7f8fc', webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false } });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl); else win.loadFile(path.join(__dirname, '../../dist/index.html'));
}

app.whenReady().then(async () => {
  const soundsDir = soundsPath();
  await fs.mkdir(soundsDir, { recursive: true });

  // 打包版首次启动:把安装目录自带的默认铃声复制到用户目录
  if (app.isPackaged) {
    try {
      const bundled = path.join(process.resourcesPath, 'sounds');
      if (await exists(bundled) && (await fs.readdir(soundsDir)).length === 0) {
        await fs.cp(bundled, soundsDir, { recursive: true });
      }
    } catch { /* 铃声初始化失败不影响启动 */ }
  }

  protocol.handle(SOUND_SCHEME, async (request) => {
    try {
      const { host, pathname } = new URL(request.url);
      const filename = decodeURIComponent(host === 'local' ? pathname.replace(/^\//, '') : `${host}${pathname}`);
      const filePath = path.join(soundsDir, path.basename(filename));
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  ipcMain.handle('alarms:load', readAlarms);
  ipcMain.handle('alarms:save', async (_event, alarms) => { await fs.mkdir(path.dirname(storePath()), { recursive: true }); await fs.writeFile(storePath(), JSON.stringify(alarms, null, 2), 'utf8'); });
  ipcMain.handle('holidays:load', readHolidays);
  ipcMain.handle('sounds:list', async () => {
    try {
      const files = await fs.readdir(soundsDir);
      return files
        .filter(f => /\.(mp3|wav|ogg|m4a|flac)$/i.test(f))
        .map(f => ({ name: f, path: soundURL(f) }));
    } catch { return []; }
  });
  ipcMain.handle('sounds:delete', async (_event, name: string) => {
    try {
      const filePath = path.join(soundsDir, path.basename(String(name)));
      if (!filePath.startsWith(soundsDir)) return false;
      await fs.unlink(filePath);
      return true;
    } catch { return false; }
  });
  ipcMain.handle('sounds:rename', async (_event, oldName: string, newName: string) => {
    try {
      const ext = path.extname(String(oldName)) || '.mp3';
      let safeNew = String(newName).replace(/[\\/:*?"<>|]/g, '_').trim();
      if (!safeNew) return null;
      // 保证 alarm- 前缀和原后缀完整
      if (!safeNew.startsWith('alarm-')) safeNew = `alarm-${safeNew}`;
      if (!safeNew.toLowerCase().endsWith(ext.toLowerCase())) safeNew = `${safeNew}${ext}`;
      const from = path.join(soundsDir, path.basename(String(oldName)));
      const to = path.join(soundsDir, safeNew);
      if (!from.startsWith(soundsDir) || !to.startsWith(soundsDir)) return null;
      if (safeNew === path.basename(String(oldName))) return { path: soundURL(safeNew), name: safeNew };
      if (await exists(to)) return null;
      await fs.rename(from, to);
      win?.webContents.send('sounds:updated');
      return { path: soundURL(safeNew), name: safeNew };
    } catch { return null; }
  });
  ipcMain.handle('music:open', async () => { createMusicWindow(); });
  ipcMain.handle('music:site', async () => { await shell.openExternal(MUSIC_SITE); });
  ipcMain.handle('audio:pick', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const ext = path.extname(source);
    const stem = path.basename(source, ext).replace(/[\\/:*?"<>|]/g, '_');
    let filename = `alarm-${stem}${ext}`;
    let index = 1;
    while (await exists(path.join(soundsDir, filename))) filename = `alarm-${stem}_${index++}${ext}`;
    const target = path.join(soundsDir, filename);
    await fs.copyFile(source, target);
    win?.webContents.send('sounds:updated');
    return { path: soundURL(filename), name: filename };
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
