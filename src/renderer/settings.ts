import './style.css';
import type { SettingsData } from './types';
import { keyLabel } from './keys';

// 设置窗口独立入口(与主窗口共用 preload 与样式),由主进程 createSettingsWindow 打开
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<div class="settings-shell"><div class="titlebar-drag"></div><aside class="settings-nav"><button class="nav-item active" data-nav="general">⚙ 通用</button><button class="nav-item" data-nav="sounds">♫ 铃声库</button><button class="nav-item" data-nav="about">✦ 关于</button></aside><main class="settings-main" id="settings-main"></main></div>`;

let data: SettingsData = { closeAction: null, openAtLogin: false, dismissKey: 'Space', dismissHoldSeconds: 5, version: '', author: '', github: '', runtime: { electron: '', chrome: '', node: '' }, soundsDir: '', soundsCount: 0 };
let nav: 'general' | 'sounds' | 'about' = 'general';
// 按键捕获态:点击后在设置窗口里拦一次 keydown 作为新的长按按键
let capturingKey = false;

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
      </div>
      <h3 class="settings-sub">关闭响铃</h3>
      <div class="setting-row"><div class="setting-info"><strong>长按关闭按键</strong><p>闹钟响起时，长按该按键关闭本次响铃</p></div><button class="ghost setting-btn ${capturingKey ? 'capturing' : ''}" id="dismiss-key-btn">${capturingKey ? '请按下按键…' : keyLabel(data.dismissKey)}</button></div>
      <div class="setting-row"><div class="setting-info"><strong>长按时长</strong><p>需要按住多久才会关闭本次响铃</p></div><div class="setting-control"><input type="range" id="hold-range" min="1" max="10" step="1" value="${data.dismissHoldSeconds}" aria-label="长按时长"><span class="setting-value"><b id="hold-value">${data.dismissHoldSeconds}</b> 秒</span></div></div>
      <p class="setting-note">修改后立即生效，正在响铃时也无需重启。</p>`;
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
    document.getElementById('dismiss-key-btn')?.addEventListener('click', () => {
      if (capturingKey) { capturingKey = false; renderContent(); return; }
      captureDismissKey();
    });
    const range = document.getElementById('hold-range') as HTMLInputElement | null;
    range?.addEventListener('input', () => {
      const v = document.getElementById('hold-value');
      if (v) v.textContent = range.value;
    });
    range?.addEventListener('change', async () => {
      const secs = Math.min(10, Math.max(1, Number(range.value) || 5));
      data.dismissHoldSeconds = secs;
      await window.alarmAPI.setDismiss(data.dismissKey, secs);
    });
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

// 捕获一次按键作为新的长按关闭键。Esc 保留为「取消捕获」,因此不可绑定
function captureDismissKey() {
  capturingKey = true;
  renderContent();
  const onKey = async (e: KeyboardEvent) => {
    if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      window.removeEventListener('keydown', onKey, true);
      capturingKey = false;
      renderContent();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener('keydown', onKey, true);
    capturingKey = false;
    const res = await window.alarmAPI.setDismiss(e.code, data.dismissHoldSeconds);
    data.dismissKey = res?.dismissKey || e.code;
    data.dismissHoldSeconds = res?.dismissHoldSeconds ?? data.dismissHoldSeconds;
    renderContent();
  };
  window.addEventListener('keydown', onKey, true);
}

async function refresh() { data = await window.alarmAPI.getSettings(); renderContent(); }

document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(b => b.addEventListener('click', () => {
  capturingKey = false; // 切栏目时退出按键捕获,避免残留监听
  nav = (b.dataset.nav as typeof nav) || 'general';
  document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x === b));
  void refresh();
}));

void refresh();
