import './style.css';
import type { SettingsData } from './types';

// 设置窗口独立入口(与主窗口共用 preload 与样式),由主进程 createSettingsWindow 打开
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<div class="settings-shell"><div class="titlebar-drag"></div><aside class="settings-nav"><button class="nav-item active" data-nav="general">⚙ 通用</button><button class="nav-item" data-nav="sounds">♫ 铃声库</button><button class="nav-item" data-nav="about">✦ 关于</button></aside><main class="settings-main" id="settings-main"></main></div>`;

let data: SettingsData = { closeAction: null, openAtLogin: false, version: '', author: '', github: '', runtime: { electron: '', chrome: '', node: '' }, soundsDir: '', soundsCount: 0 };
let nav: 'general' | 'sounds' | 'about' = 'general';

function renderContent() {
  const main = document.getElementById('settings-main')!;
  if (nav === 'general') {
    main.innerHTML = `
      <h2>通用</h2>
      <div class="setting-row"><div class="setting-info"><strong>开机自启</strong><p>登录 Windows 后自动启动小小闹钟</p></div><button class="toggle ${data.openAtLogin ? 'on' : ''}" id="autolaunch-toggle" aria-label="开机自启"><i></i></button></div>
      <div class="setting-row"><div class="setting-info"><strong>关闭窗口时</strong><p>点击标题栏 × 按钮时的行为；最小化到托盘后闹钟照常响铃</p></div></div>
      <div class="repeat-chips close-chips">
        <button data-close="" class="${data.closeAction === null ? 'selected' : ''}">每次询问</button>
        <button data-close="minimize" class="${data.closeAction === 'minimize' ? 'selected' : ''}">最小化到托盘</button>
        <button data-close="exit" class="${data.closeAction === 'exit' ? 'selected' : ''}">直接退出</button>
      </div>`;
    document.getElementById('autolaunch-toggle')?.addEventListener('click', async () => {
      try { data.openAtLogin = await window.alarmAPI.setAutoLaunch(!data.openAtLogin); }
      catch (err) { alert('设置开机自启失败：' + err); }
      renderContent();
    });
    main.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b => b.addEventListener('click', async () => {
      const v = b.dataset.close;
      await window.alarmAPI.setCloseAction(v === 'minimize' ? 'minimize' : v === 'exit' ? 'exit' : null);
      data.closeAction = v === 'minimize' || v === 'exit' ? v : null;
      renderContent();
    }));
  } else if (nav === 'sounds') {
    main.innerHTML = `
      <h2>铃声库</h2>
      <div class="setting-row"><div class="setting-info"><strong>已收录铃声</strong><p>${data.soundsCount} 首铃声可在闹钟中选用</p></div></div>
      <div class="setting-row"><div class="setting-info"><strong>存储位置</strong><p class="setting-path">${data.soundsDir}</p></div><button class="ghost setting-btn" id="open-dir">打开文件夹</button></div>`;
    document.getElementById('open-dir')?.addEventListener('click', () => { void window.alarmAPI.openSoundsDir(); });
  } else {
    main.innerHTML = `
      <h2>关于</h2>
      <div class="about-card">
        <div class="about-head"><div class="brand-mark big">✦</div><div><strong>小小闹钟 v${data.version}</strong><p>一个专注、简洁的桌面闹钟</p></div></div>
        <div class="setting-row"><div class="setting-info"><strong>作者</strong><p>${data.author}</p></div></div>
        <div class="setting-row"><div class="setting-info"><strong>GitHub</strong><p class="setting-path">${data.github}</p></div><button class="ghost setting-btn" id="gh-btn">访问仓库</button></div>
        <p class="about-runtime">Electron ${data.runtime.electron} · Chromium ${data.runtime.chrome} · Node ${data.runtime.node}</p>
      </div>`;
    document.getElementById('gh-btn')?.addEventListener('click', () => { void window.alarmAPI.openExternal(data.github); });
  }
}

async function refresh() { data = await window.alarmAPI.getSettings(); renderContent(); }

document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(b => b.addEventListener('click', () => {
  nav = (b.dataset.nav as typeof nav) || 'general';
  document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x === b));
  void refresh();
}));

void refresh();
