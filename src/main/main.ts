import { app, BrowserWindow, dialog, ipcMain, Menu, Tray, protocol, net, shell } from 'electron';
import type { DownloadItem } from 'electron';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HolidayConfig } from '../renderer/types';

let win: BrowserWindow | null = null;
let musicWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let tray: Tray | null = null;
// 关闭行为:null=每次询问; 'minimize'=记住最小化到托盘; 'exit'=记住直接退出
let closeAction: 'minimize' | 'exit' | null = null;
let quitting = false;
// 关闭响铃方式(设置窗口可改):长按的按键 + 需要按住的秒数。全局偏好,主窗口与设置窗口共用
type DismissPrefs = { dismissKey: string; dismissHoldSeconds: number };
const DEFAULT_DISMISS: DismissPrefs = { dismissKey: 'Space', dismissHoldSeconds: 5 };
let dismissPrefs: DismissPrefs = { ...DEFAULT_DISMISS };
const MUSIC_SITE = 'https://flac.music.hi.cn/';
const GITHUB_URL = 'https://github.com/allthetimes/tiny_alarm';
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
  let filename = `${cleanStem}${ext}`;
  let index = 1;
  while (reservedNames.has(filename) || await exists(path.join(soundsPath(), filename))) filename = `${cleanStem}_${index++}${ext}`;
  return filename;
}

// 旧库迁移:去掉文件名的 alarm- 前缀。音频改名时同名封面(相同主名)一起改;重名自动加 _N;
// 启动时执行一次,旧版库无缝升级
async function migrateStripAlarmPrefix() {
  try {
    const dir = soundsPath();
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const set = new Set(files);
    const audioExts = /\.(mp3|wav|ogg|m4a|flac|aac|ape)$/i;
    const imgExts = /\.(jpe?g|png|webp|gif)$/i;
    const uniqueName = (stem: string, ext: string) => { let name = `${stem}${ext}`, i = 1; while (set.has(name)) name = `${stem}_${i++}${ext}`; return name; };
    const move = async (from: string, to: string) => { await fs.rename(path.join(dir, from), path.join(dir, to)); set.delete(from); set.add(to); };
    for (const f of files.filter(x => x.startsWith('alarm-') && audioExts.test(x))) {
      const ext = path.extname(f);
      const oldStem = f.slice(0, f.length - ext.length); // alarm-foo
      const base = oldStem.slice(6);
      if (!base) continue;
      const newStem = set.has(`${base}${ext}`) ? uniqueName(base, ext).slice(0, -ext.length) : base;
      try { await move(f, newStem + ext); } catch { continue; /* 文件被占用则跳过,下次启动再试 */ }
      for (const g of files) {
        if (!imgExts.test(g) || !set.has(g)) continue;
        const gExt = path.extname(g);
        if (g.slice(0, g.length - gExt.length) !== oldStem) continue;
        const coverTarget = set.has(newStem + gExt) ? uniqueName(newStem, gExt) : newStem + gExt;
        try { await move(g, coverTarget); } catch { /* 封面改名失败不影响音频 */ }
      }
    }
    // 孤儿封面:无对应音频、仍带前缀的图片
    for (const g of files.filter(x => x.startsWith('alarm-') && imgExts.test(x) && set.has(x))) {
      const ext = path.extname(g);
      const base = g.slice(6, g.length - ext.length);
      if (!base) continue;
      try { await move(g, set.has(`${base}${ext}`) ? uniqueName(base, ext) : `${base}${ext}`); } catch { /* 跳过 */ }
    }
  } catch { /* 目录不存在等:静默跳过 */ }
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
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLE_BAR, color: '#ffffff' },
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  musicWin.loadURL(MUSIC_SITE);
  // 给第三方页面顶部注入一条透明拖拽区(避开右上角 3 个系统按钮),让标题栏可拖拽
  musicWin.webContents.on('did-finish-load', () => {
    if (!musicWin || musicWin.isDestroyed()) return;
    musicWin.webContents.insertCSS(`
      body::before {
        content: '';
        position: fixed;
        top: 0; left: 0; right: 140px;
        height: ${TITLE_BAR.height}px;
        -webkit-app-region: drag;
        z-index: 2147483647;
      }
    `).catch(() => { /* 页面可能已跳转 */ });
  });
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

// 统一标题栏:隐藏系统标题栏文字区,保留原生最小化/最大化/关闭按钮(overlay),
// 按钮底色与应用背景一致,深灰图标。内容区需在顶部预留 -webkit-app-region: drag 的拖拽条。
const TITLE_BAR = { color: '#00000000', symbolColor: '#5a5e73', height: 36 };

// 点击关闭按钮时询问:最小化到托盘(闹钟照常响)还是直接退出;可记住选择(持久化,重启仍生效)
const closePrefPath = () => path.join(app.getPath('userData'), 'close-pref.json');
async function loadClosePref() {
  try {
    const saved = JSON.parse(await fs.readFile(closePrefPath(), 'utf8'));
    if (saved?.action === 'minimize' || saved?.action === 'exit') closeAction = saved.action;
  } catch { /* 首次运行或文件损坏:保持每次询问 */ }
}
// 关闭响铃偏好(dismissKey/dismissHoldSeconds)持久化:与 close-pref 一样放 userData,独立文件
const prefsPath = () => path.join(app.getPath('userData'), 'preferences.json');
// 长按时长可配范围:1–10 秒,越界一律收敛(设置里滑块也是这个区间)
const HOLD_MIN = 1, HOLD_MAX = 10;
const clampHoldSeconds = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(HOLD_MAX, Math.max(HOLD_MIN, n)) : DEFAULT_DISMISS.dismissHoldSeconds;
};
async function loadPrefs() {
  try {
    const saved = JSON.parse(await fs.readFile(prefsPath(), 'utf8'));
    dismissPrefs = {
      dismissKey: typeof saved?.dismissKey === 'string' && saved.dismissKey ? saved.dismissKey : DEFAULT_DISMISS.dismissKey,
      dismissHoldSeconds: clampHoldSeconds(saved?.dismissHoldSeconds)
    };
  } catch { /* 首次运行或文件损坏:用默认值(空格 / 5 秒) */ }
}
async function savePrefs() {
  try { await fs.writeFile(prefsPath(), JSON.stringify(dismissPrefs, null, 2), 'utf8'); } catch { /* 写不进则本次会话内仍生效 */ }
}
// 配置改动后通知两个窗口:主窗口更新遮罩文案与长按判定,设置窗口回填控件
function broadcastPrefs() {
  for (const w of [win, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send('settings:changed', dismissPrefs);
}
// 关闭行为:null=每次询问; 'minimize'=最小化到托盘; 'exit'=直接退出。托盘设置与关闭弹窗共用
async function applyClosePref(action: 'minimize' | 'exit' | null) {
  closeAction = action;
  try {
    if (action) await fs.writeFile(closePrefPath(), JSON.stringify({ action }, null, 2), 'utf8');
    else await fs.rm(closePrefPath(), { force: true }); // 恢复"每次询问"就删掉记录
  } catch { /* 写不进则本次会话内仍生效 */ }
}
async function handleCloseRequest(): Promise<void> {
  if (quitting) { win?.destroy(); return; }
  if (closeAction === 'minimize') { win?.hide(); return; }
  if (closeAction === 'exit') { quitting = true; app.quit(); return; }
  const { response, checkboxChecked } = await dialog.showMessageBox(win!, {
    type: 'question',
    title: '关闭小小闹钟',
    message: '要最小化到系统托盘，还是直接退出？',
    detail: '最小化后闹钟会在后台照常响起，可从托盘图标重新打开窗口。',
    buttons: ['最小化到托盘', '直接退出', '取消'],
    defaultId: 0,
    cancelId: 2,
    checkboxLabel: '记住我的选择，不再询问',
    noLink: true
  });
  if (response === 2) return; // 取消
  if (checkboxChecked) await applyClosePref(response === 0 ? 'minimize' : 'exit');
  if (response === 0) win?.hide();
  else { quitting = true; app.quit(); }
}

// 关于对话框:版本、作者、GitHub、运行时信息,可直接跳转仓库
async function showAbout() {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '关于小小闹钟',
    message: `小小闹钟 v${app.getVersion()}`,
    detail: `一个专注、简洁的桌面闹钟\n\n作者：allthetimes\nGitHub：${GITHUB_URL}\n\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
    buttons: ['访问 GitHub 仓库', '关闭'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (response === 0) void shell.openExternal(GITHUB_URL);
}

// 设置窗口:左侧栏目导航(通用/铃声库/关于),加载独立入口 settings.html
function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 640, height: 470, resizable: false, maximizable: false,
    title: '设置', parent: win || undefined, backgroundColor: '#f5f6fb',
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR,
    webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) settingsWin.loadURL(`${devUrl.replace(/\/$/, '')}/settings.html`);
  else settingsWin.loadFile(path.join(__dirname, '../../dist/settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function createTray() {
  // 托盘点击恢复窗口,右键菜单可彻底退出。图标: 打包后取 resources 下的 icon.ico,
  // 开发态退回 electron 默认(打包时 electron-builder 会把 build/icon.ico 放进 resources)
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'build', 'icon.ico');
  tray = new Tray(iconPath);
  tray.setToolTip(`小小闹钟 v${app.getVersion()}`);
  tray.on('click', () => {
    if (!win || win.isDestroyed()) createWindow();
    else { win.show(); win.focus(); }
  });
  // 菜单按需构建:状态实时读取,切换后重建菜单保持同步
  const buildTrayMenu = () => Menu.buildFromTemplate([
    { label: '打开小小闹钟', click: () => { if (!win || win.isDestroyed()) createWindow(); else { win.show(); win.focus(); } } },
    { type: 'separator' },
    { label: '设置…', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'GitHub 仓库', click: () => { void shell.openExternal(GITHUB_URL); } },
    { label: `关于小小闹钟（v${app.getVersion()}）`, click: () => { void showAbout(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(buildTrayMenu());
}

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 480, height: 880, minWidth: 420, minHeight: 640,
    backgroundColor: '#f5f6fb',
    titleBarStyle: 'hidden',
    titleBarOverlay: TITLE_BAR,
    webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl); else win.loadFile(path.join(__dirname, '../../dist/index.html'));
  // 点关闭按钮 → 询问最小化/退出;程序发起的退出(app.quit)走 destroy 不再询问
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    void handleCloseRequest();
  });
}

app.whenReady().then(async () => {
  await loadClosePref();
  await migrateStripAlarmPrefix();
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
      // 封面图 <stem>.<img> 与音频 <stem>.<audio> 按主名对应(旧版 alarm- 前缀文件已在启动时迁移)
      const covers = new Map<string, string>();
      for (const f of files) {
        const m = f.match(/^(.+)\.(jpe?g|png|webp|gif)$/i);
        if (m) covers.set(m[1].replace(/^alarm-/i, '').toLowerCase(), soundURL(f));
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
      // 保证原后缀完整
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
  // 设置窗口:读取/修改配置
  // 登录项读写统一带 path/args:开发态注册 electron.exe + 应用路径以启动本应用;
  // 读取时的参数必须与写入一致,否则 openAtLogin 判断会失配
  const launchItemOptions = () => ({ path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
  const autoLaunchOn = () => app.getLoginItemSettings(launchItemOptions()).openAtLogin;
  ipcMain.handle('settings:get', async () => ({
    closeAction,
    openAtLogin: autoLaunchOn(),
    dismissKey: dismissPrefs.dismissKey,
    dismissHoldSeconds: dismissPrefs.dismissHoldSeconds,
    version: app.getVersion(),
    author: 'allthetimes',
    github: GITHUB_URL,
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    soundsDir: soundsPath(),
    soundsCount: (await fs.readdir(soundsPath()).catch(() => [] as string[])).filter(f => /\.(mp3|wav|ogg|m4a|flac)$/i.test(f)).length
  }));
  ipcMain.handle('settings:setClose', (_event, action: unknown) => applyClosePref(action === 'minimize' || action === 'exit' ? action : null));
  // 关闭响铃方式:按键(KeyboardEvent.code) + 长按秒数。任一参数缺省则保留原值,越界自动收敛
  ipcMain.handle('settings:setDismiss', async (_event, key: unknown, seconds: unknown) => {
    dismissPrefs = {
      dismissKey: typeof key === 'string' && key ? key : dismissPrefs.dismissKey,
      dismissHoldSeconds: seconds === undefined || seconds === null ? dismissPrefs.dismissHoldSeconds : clampHoldSeconds(seconds)
    };
    await savePrefs();
    broadcastPrefs();
    return dismissPrefs;
  });
  ipcMain.handle('settings:setAutoLaunch', (_event, on: unknown) => {
    app.setLoginItemSettings({ openAtLogin: !!on, ...launchItemOptions() });
    return autoLaunchOn();
  });
  ipcMain.handle('settings:openSoundsDir', async () => { await fs.mkdir(soundsPath(), { recursive: true }); return shell.openPath(soundsPath()); });
  ipcMain.handle('app:openExternal', (_event, url: unknown) => {
    const u = String(url);
    if (/^https:\/\/([a-z0-9.-]+\.)?github\.com\//i.test(u)) return shell.openExternal(u); // 白名单:仅允许 GitHub 链接
  });
  ipcMain.handle('audio:pick', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const ext = path.extname(source);
    const stem = path.basename(source, ext).replace(/[\\/:*?"<>|]/g, '_');
    let filename = `${stem}${ext}`;
    let index = 1;
    while (await exists(path.join(soundsDir, filename))) filename = `${stem}_${index++}${ext}`;
    await fs.mkdir(soundsDir, { recursive: true });
    const target = path.join(soundsDir, filename);
    await fs.copyFile(source, target);
    win?.webContents.send('sounds:updated');
    return { path: soundURL(filename), name: filename };
  });
  createWindow();
  createTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  // 托盘常驻:窗口全部隐藏/销毁时不清退出进程,保持闹钟后台运行
  if (process.platform !== 'darwin' && quitting) app.quit();
});
