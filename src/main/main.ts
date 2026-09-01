import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, net, shell } from 'electron';
import type { DownloadItem } from 'electron';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
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

type PendingDownload = { item: DownloadItem; originalName: string; ext: string; tempPath: string; finalName?: string; cover?: { buf: Buffer; ext: string } };
const pendingDownloads = new Map<string, PendingDownload>();
const reservedNames = new Set<string>();

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

function safeStem(value: string) { return path.basename(value).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120); }
async function uniqueSoundName(stem: string, ext: string) {
  const cleanStem = safeStem(stem) || '铃声';
  let filename = `alarm-${cleanStem}${ext}`;
  let index = 1;
  while (reservedNames.has(filename) || await exists(path.join(soundsPath(), filename))) filename = `alarm-${cleanStem}_${index++}${ext}`;
  return filename;
}

function sniffImageExt(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return '.webp';
  if (buf.length > 4 && buf.toString('latin1', 0, 4) === 'GIF8') return '.gif';
  return null;
}

function decodeDataUrl(dataUrl: string): Buffer | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  try { return Buffer.from(dataUrl.slice(comma + 1), 'base64'); } catch { return null; }
}

// 实验性:从内嵌音乐页面抓当前下载歌曲的封面。封面是酷我 CDN 的 song-cover img,
// 按 DOM 顺序第一个 song-cover 就是刚点下载的那首。CDN URL 里的 /120/ 是尺寸,可试换 /500/ 高清。
// 抓取:主进程 net.fetch(带 Referer 应对防盗链) → 页面内 fetch 回退。失败静默,不影响下载流程。
async function fetchCoverFromPage(wc: Electron.WebContents): Promise<{ buf: Buffer; ext: string } | null> {
  try {
    const found: string = await wc.executeJavaScript(`(() => {
      const norm = u => { if (!u) return ''; u = String(u).trim(); return u.startsWith('//') ? location.protocol + u : u; };
      const imgs = [...document.images]
        .map(img => ({ url: norm(img.currentSrc || img.src), cls: String(img.className || img.parentElement?.className || '') }))
        .filter(i => i.url);
      const pick =
        imgs.find(i => /albumcover/.test(i.url)) ||
        imgs.find(i => /song-cover|cover/i.test(i.cls) && !/logo|icon|favicon/i.test(i.url)) ||
        imgs.find(i => /\\.(jpe?g|png|webp)$/i.test(i.url) && !/logo|icon|favicon|album_300|placeholder|default|avatar/i.test(i.url));
      return pick ? pick.url : '';
    })()`, true);
    if (!found || typeof found !== 'string' || !found) {
      console.log('[cover] no song-cover image on page');
      return null;
    }
    const url: string = found;
    console.log('[cover] trying', url);
    // 酷我 albumcover URL:/120/ 是 120px,试 /500/ 拿高清;失败再回退原 120
    const candidates = url.includes('/albumcover/')
      ? [url.replace(/\/(\d{2,4})\//, '/500/'), url]
      : [url];
    for (const u of candidates) {
      // 1) 主进程直接抓:无 CORS 限制,带 Referer 应对防盗链
      try {
        const res = await net.fetch(u, { headers: { Referer: MUSIC_SITE }, bypassCustomProtocolHandlers: true });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const ext = sniffImageExt(buf);
          if (ext && buf.length >= 1024) return { buf, ext };
          console.log('[cover] main fetch got non-image,', buf.length, 'bytes');
        } else console.log('[cover] main fetch status', res.status);
      } catch (err) { console.log('[cover] main fetch failed:', err); }
      // 2) 回退:页面内 fetch(带页面 cookie,可过 WAF);依次试 omit/include 凭据和 https 升级
      try {
        const embedded = JSON.stringify(u);
        const dataUrl: string = await wc.executeJavaScript(`(async () => {
          for (const u of [${embedded}, ${embedded}.replace(/^http:/, 'https:')]) {
            for (const cred of ['omit', 'include']) {
              try {
                const res = await fetch(u, { credentials: cred });
                if (!res.ok) continue;
                const blob = await res.blob();
                if (blob.size < 2048 || blob.size > 8 * 1024 * 1024) continue;
                const dt = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(''); fr.readAsDataURL(blob); });
                if (dt) return dt;
              } catch { /* 下一种组合 */ }
            }
          }
          return '';
        })()`, true);
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
          const buf = decodeDataUrl(dataUrl);
          const ext = buf && sniffImageExt(buf);
          if (buf && ext && buf.length >= 1024) return { buf, ext };
        }
        console.log('[cover] page fetch fallback empty');
      } catch (err) { console.log('[cover] page fetch failed:', err); }
    }
    return null;
  } catch (err) { console.log('[cover] fetch failed:', err); return null; }
}

async function importDownloadedFile(file: string) {
  try {
    const ext = path.extname(file);
    const filename = await uniqueSoundName(path.basename(file, ext), ext);
    reservedNames.add(filename);
    await fs.mkdir(soundsPath(), { recursive: true });
    await fs.copyFile(file, path.join(soundsPath(), filename));
    reservedNames.delete(filename);
    win?.webContents.send('sounds:updated');
    return filename;
  } catch { return null; /* 导入失败时静默，用户仍可手动导入 */ }
}

// 下载结束后关闭内嵌窗口:网站里的音乐可能还在播放,留着会让用户找不到声源
function closeMusicWindow() {
  if (musicWin && !musicWin.isDestroyed()) musicWin.close();
  musicWin = null;
}
function createMusicWindow() {
  if (musicWin && !musicWin.isDestroyed()) { musicWin.show(); musicWin.focus(); return; }
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
    if (!DOWNLOAD_EXTS.test(url) && !DOWNLOAD_EXTS.test(item.getFilename())) return;
    const token = crypto.randomUUID();
    const originalName = item.getFilename();
    const ext = path.extname(originalName).toLowerCase() || '.mp3';
    const tempPath = path.join(soundsPath(), `.download-${token}.part`);
    pendingDownloads.set(token, { item, originalName, ext, tempPath });
    item.setSavePath(tempPath);
    item.pause();
    musicWin?.hide(); win?.show(); win?.focus();
    win?.webContents.send('download:before', token, originalName);
    // 异步抓封面,不阻塞命名/下载;抓到后挂在 pending 记录上,完成时一并落盘
    if (musicWin && !musicWin.isDestroyed()) {
      const wc = musicWin.webContents;
      fetchCoverFromPage(wc).then(cover => {
        const pending = pendingDownloads.get(token);
        if (pending && cover) pending.cover = cover;
      });
    }
    item.on('updated', (_e, state) => {
      const pending = pendingDownloads.get(token);
      if (state === 'progressing' && pending && !item.isPaused()) win?.webContents.send('download:progress', token, originalName, item.getReceivedBytes(), item.getTotalBytes());
    });
    item.once('done', async (_e, state) => {
      const pending = pendingDownloads.get(token);
      if (!pending) return;
      pendingDownloads.delete(token);
      if (state === 'completed' && pending.finalName) {
        try {
          await fs.mkdir(soundsPath(), { recursive: true });
          await fs.rename(pending.tempPath, path.join(soundsPath(), pending.finalName));
          reservedNames.delete(pending.finalName);
          if (pending.cover) {
            const stem = pending.finalName.slice(0, pending.finalName.length - pending.ext.length);
            try { await fs.writeFile(path.join(soundsPath(), `${stem}${pending.cover.ext}`), pending.cover.buf); } catch { /* 封面失败不影响铃声 */ }
          }
          win?.webContents.send('sounds:updated');
          win?.webContents.send('download:done', token, pending.finalName);
          closeMusicWindow();
          return;
        } catch { /* fall through to failure cleanup */ }
      }
      if (pending.finalName) reservedNames.delete(pending.finalName);
      try { await fs.unlink(pending.tempPath); } catch { /* already absent */ }
      win?.webContents.send('download:failed', token);
      closeMusicWindow();
    });
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
      // 封面图 alarm-<stem>.<img> 与音频 alarm-<stem>.<audio> 按 stem 对应
      const covers = new Map<string, string>();
      for (const f of files) {
        const m = f.match(/^alarm-(.+)\.(jpe?g|png|webp|gif)$/i);
        if (m) covers.set(m[1].toLowerCase(), soundURL(f));
      }
      return files
        .filter(f => /\.(mp3|wav|ogg|m4a|flac)$/i.test(f))
        .map(f => {
          const stem = f.slice(0, f.length - path.extname(f).length).replace(/^alarm-/, '');
          return { name: f, path: soundURL(f), cover: covers.get(stem.toLowerCase()) };
        });
    } catch { return []; }
  });
  ipcMain.handle('sounds:delete', async (_event, name: string) => {
    try {
      const filePath = path.join(soundsDir, path.basename(String(name)));
      if (!filePath.startsWith(soundsDir)) return false;
      await fs.unlink(filePath);
      // 同步删除同名封面图(任意图片扩展名)
      const stem = path.basename(String(name), path.extname(String(name)));
      for (const imgExt of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
        try { await fs.unlink(path.join(soundsDir, `${stem}${imgExt}`)); } catch { /* 无封面 */ }
      }
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
      // 同步重命名同名封面图
      const oldStem = path.basename(String(oldName), path.extname(String(oldName)));
      const newStem = safeNew.slice(0, safeNew.length - path.extname(safeNew).length);
      for (const imgExt of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
        const coverFrom = path.join(soundsDir, `${oldStem}${imgExt}`);
        if (await exists(coverFrom)) { try { await fs.rename(coverFrom, path.join(soundsDir, `${newStem}${imgExt}`)); } catch { /* 保持原名 */ } break; }
      }
      win?.webContents.send('sounds:updated');
      return { path: soundURL(safeNew), name: safeNew };
    } catch { return null; }
  });
  ipcMain.handle('music:open', async () => { createMusicWindow(); });
  ipcMain.handle('download:confirm', async (_event, token: string, requestedName: string) => {
    const pending = pendingDownloads.get(token);
    if (!pending || pending.finalName) return null;
    // 渲染层送来的是 alarm- 前缀完整名，这里还原为纯 stem 再统一处理
    const raw = path.basename(String(requestedName));
    const stem = raw.replace(/^alarm-/i, '').replace(/\.[^.]*$/, '');
    const filename = await uniqueSoundName(stem, pending.ext);
    pending.finalName = filename;
    reservedNames.add(filename);
    await fs.mkdir(soundsDir, { recursive: true });
    pending.item.resume();
    win?.webContents.send('download:started', token, pending.originalName);
    return filename;
  });
  ipcMain.handle('download:cancel', async (_event, token: string) => {
    const pending = pendingDownloads.get(token);
    if (!pending) return false;
    pendingDownloads.delete(token);
    if (pending.finalName) reservedNames.delete(pending.finalName);
    try { pending.item.cancel(); } catch { /* already finished */ }
    try { await fs.unlink(pending.tempPath); } catch { /* not created yet */ }
    win?.webContents.send('download:failed', token);
    closeMusicWindow();
    return true;
  });

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
    await fs.mkdir(soundsDir, { recursive: true });
    const target = path.join(soundsDir, filename);
    await fs.copyFile(source, target);
    win?.webContents.send('sounds:updated');
    return { path: soundURL(filename), name: filename };
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
