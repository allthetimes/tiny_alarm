import type { Alarm, Repeat, HolidayConfig } from './types';
import { keyLabel } from './keys';
import './style.css';
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const repeats: { key: Repeat; label: string }[] = [
  { key: 'once', label: '仅一次' },
  { key: 'daily', label: '每天' },
  { key: 'weekdays', label: '工作日' },
  { key: 'weekends', label: '周末' },
  { key: 'legal', label: '法定工作日' },
  { key: 'custom', label: '自定义' }
];
let alarms: Alarm[] = [];
let holidays: HolidayConfig = { holidays: [], workdays: [] };
let editingId: string | null = null;
let selectedSound = { path: '', name: '系统默认铃声' };
const audio = new Audio();
let volume = .72;
let lastTriggered = '';
let previewTimer: number | null = null;
let ringingAlarm: Alarm | null = null;
let ringTimer: number | null = null;
let retryTimer: number | null = null;
let retriesLeft = 0;
let holdTimer: number | null = null;
let holdStarted = 0;
// 关闭响铃方式:来自设置窗口(默认长按空格 5 秒),通过 getSettings / onSettingsChanged 同步
let dismissCode = 'Space';
let dismissHoldSeconds = 5;
let downloadState: { name: string; received: number; total: number } | null = null;
let freshSound: string | null = null;
audio.volume = volume;
const app = document.querySelector<HTMLDivElement>('#app')!;
// 像素小窗(精简模式)功能暂缓:入口按钮先关掉,后续再改。
// 置为 true 即可恢复标题栏的「最小化 · 切换 · 关闭」三按钮布局 ——
// 像素主题样式、px-compact 面板与主进程的尺寸切换逻辑都完整保留,无需重写。
const PIXEL_UI_ENABLED = false;
app.innerHTML = `<div class="titlebar-drag"></div><div class="win-ctl"><button id="win-min" title="最小化" aria-label="最小化"><svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="8.5" width="9" height="2" fill="currentColor"/></svg></button>${PIXEL_UI_ENABLED ? '<button id="win-compact" title="切换像素小窗" aria-label="切换像素小窗"><svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="5" y="5" width="6" height="6" fill="currentColor"/></svg></button>' : ''}<button class="ctl-close" id="win-close" title="关闭" aria-label="关闭"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div><div class="phone"><header class="top"><div class="brand"><div class="brand-mark">✦</div><strong>小小闹钟</strong></div><div class="clock"><strong id="clock">--:--</strong><span id="date">----</span></div></header><div class="hero"><p class="hi" id="greeting">早上好</p><p class="active"><i></i><span id="active-label">0 个闹钟正在运行</span></p></div><section id="alarm-list" class="alarm-list"></section><section class="empty" id="empty"><div class="empty-icon">◷</div><h2>还没有闹钟</h2><p>创建一个闹钟，开启你的专注时刻</p></section><div class="dock"><div class="dock-side"><label class="volume"><span>♫</span><input id="volume" type="range" min="0" max="100" value="72" aria-label="音量"></label><button class="icon-btn" id="sound-lib">我的铃声</button></div><button class="fab" id="add-btn">＋ 新建</button></div></div><div class="px-compact"><section class="px-face"><strong class="px-clock" id="px-clock">--:--</strong><span class="px-date" id="px-date">----</span></section><div class="px-next"><i class="px-dot" id="px-dot"></i><span class="px-next-text" id="px-next-text">暂无闹钟</span><b class="px-next-count" id="px-next-count"></b></div><div class="px-actions"><button id="px-open">＋ 新建闹钟</button></div></div><div class="modal-backdrop hidden" id="modal"><div class="modal"><button class="close" id="close">×</button><h2 id="modal-title">新建闹钟</h2><label>时间<div class="time-picker" id="time-picker"><div class="tp-col"><button class="tp-btn" data-step="hour" data-dir="1" title="加一小时">▲</button><div class="tp-val" data-wheel="hour" id="tp-hour">08</div><button class="tp-btn" data-step="hour" data-dir="-1" title="减一小时">▼</button></div><div class="tp-colon">:</div><div class="tp-col"><button class="tp-btn" data-step="minute" data-dir="1" title="加一分钟">▲</button><div class="tp-val" data-wheel="minute" id="tp-minute">00</div><button class="tp-btn" data-step="minute" data-dir="-1" title="减一分钟">▼</button></div><span class="tp-icon">◷</span></div><input id="time-input" type="hidden" value="08:00"></label><label>标签<input id="label-input" type="text" placeholder="例如：晨读"></label><label>重复<div class="repeat-chips" id="repeat-chips">${repeats.map(r => `<button data-repeat="${r.key}">${r.label}</button>`).join('')}</div><div class="days" id="days">${weekdays.map((d, i) => `<button data-day="${i}">${d}</button>`).join('')}</div></label><div class="settings-grid"><label>响铃时长<select id="ring-seconds"><option value="10">10 秒</option><option value="30" selected>30 秒</option><option value="60">1 分钟</option><option value="300">5 分钟</option></select></label><label>再响间隔<select id="snooze-minutes"><option value="0">不再响</option><option value="5" selected>5 分钟</option><option value="10">10 分钟</option><option value="15">15 分钟</option></select></label><label>最多再响<select id="snooze-count"><option value="0">0 次</option><option value="1">1 次</option><option value="3" selected>3 次</option><option value="5">5 次</option></select></label></div><label>铃声<div class="sound-row"><button class="sound-select" id="sound-btn">♫ <span id="sound-name">系统默认铃声</span></button><button class="test-btn" id="test-sound">试听</button></div></label><button class="primary full" id="save-btn">保存闹钟</button></div></div><div class="modal-backdrop hidden" id="sound-lib-modal"><div class="modal"><button class="close" id="lib-close">×</button><h2 id="lib-title">我的铃声</h2><div class="lib-list" id="lib-list"></div><button class="primary full" id="lib-import">＋ 导入铃声</button><button class="ghost full" id="lib-site">🌐 内嵌打开音乐网站</button><small class="lib-hint">在内嵌窗口下载的音频会自动加入铃声库</small></div></div><div class="modal-backdrop hidden" id="rename-modal"><div class="modal small"><h2 id="rename-title">重命名铃声</h2><p class="rename-format" id="rename-format">（新名称）.mp3</p><div class="rename-box"><span class="rename-fixed hidden" id="rename-prefix"></span><input id="rename-input" type="text" placeholder="新名称"><span class="rename-fixed" id="rename-ext">.mp3</span></div><div class="rename-actions"><button class="ghost" id="rename-cancel">取消</button><button class="primary" id="rename-ok">确定</button></div></div></div><div class="ring-overlay hidden" id="ring-overlay"><div class="ring-panel"><div class="ring-icon">♬</div><p class="ring-kicker">小小闹钟提醒</p><h2 id="ring-label">时间到了</h2><p>请长按 <span class="ring-key" id="ring-key">空格</span> <span class="ring-key" id="ring-hold">5</span> 秒关闭本次闹钟</p><div class="progress-track"><div id="space-progress"></div></div><small>已按住 <span id="hold-seconds">0</span> / <span id="hold-target">5</span> 秒</small></div></div>`;
const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 按时间段动态问候
function greeting(h: number) {
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  if (h < 23) return '晚上好';
  return '夜深了';
}

function matchDay(a: Alarm, now: Date): boolean {
  const day = (now.getDay() + 6) % 7; // 0=周一
  const key = todayKey(now);
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  const legalWorkday = holidays.workdays.includes(key) || (!isWeekend && !holidays.holidays.includes(key));
  switch (a.repeat) {
    case 'daily': return true;
    case 'weekdays': return !isWeekend;
    case 'weekends': return isWeekend;
    case 'legal': return legalWorkday;
    case 'custom': return a.days.includes(day);
    default: return true; // once
  }
}

function nextRing(a: Alarm): string {
  if (!a.enabled) return '已停用';
  const now = new Date();
  const [h, m] = a.time.split(':').map(Number);
  for (let add = 0; add < 8; add++) {
    const d = new Date(now); d.setDate(d.getDate() + add); d.setHours(h, m, 0, 0);
    if (d <= now) continue;
    if (a.repeat === 'once' && add > 0) continue;
    if (!matchDay(a, d)) continue;
    const sameDay = add === 0;
    const isTomorrow = add === 1;
    if (sameDay) return `今天 ${a.time}`;
    if (isTomorrow) return `明天 ${a.time}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${a.time}`;
  }
  return '不重复';
}

// ── 像素小窗渲染 ──
// 离下一个闹钟还有多久。把闹钟的时分投到今天/明天/下一个匹配日,取最近的未来时刻
type NextInfo = { at: Date; alarm: Alarm } | null;
function nextAlarmInfo(now: Date): NextInfo {
  let best: NextInfo = null;
  for (const a of alarms) {
    if (!a.enabled) continue;
    const [h, m] = a.time.split(':').map(Number);
    for (let add = 0; add < 8; add++) {
      const d = new Date(now); d.setDate(d.getDate() + add); d.setHours(h, m, 0, 0);
      if (d <= now) continue;
      if (a.repeat === 'once' && add > 0) continue;
      if (!matchDay(a, d)) continue;
      if (!best || d < best.at) best = { at: d, alarm: a };
      break; // 这个闹钟最近的一次已找到
    }
  }
  return best;
}
// 倒计时文案:>1 天用「N天H时」,>1 小时用「H时M分」,否则「M分S秒」
function countdownText(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400), hours = Math.floor(total % 86400 / 3600);
  const minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
  if (days > 0) return `${days}天${hours}时`;
  if (hours > 0) return `${hours}时${pad(minutes)}分`;
  return `${minutes}分${pad(seconds)}秒`;
}
function renderCompact(now: Date) {
  const clock = document.getElementById('px-clock');
  if (!clock) return; // 小窗面板不存在则跳过(理论上不会发生)
  clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const { at, alarm } = nextAlarmInfo(now) || { at: null, alarm: null };
  const dateEl = document.getElementById('px-date')!;
  const dotEl = document.getElementById('px-dot')!;
  const textEl = document.getElementById('px-next-text')!;
  const countEl = document.getElementById('px-next-count')!;
  if (alarm && at) {
    // 今天 / 明天 / 具体日期,给一个短前缀
    const today = todayKey(now), tomorrow = todayKey(new Date(now.getTime() + 86400000)), atKey = todayKey(at);
    const prefix = atKey === today ? '今天' : atKey === tomorrow ? '明天' : `${at.getMonth() + 1}/${at.getDate()}`;
    dateEl.textContent = now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
    dotEl.classList.remove('off');
    textEl.textContent = `${prefix} ${alarm.time} ${alarm.label || '闹钟'}`;
    countEl.textContent = countdownText(at.getTime() - now.getTime());
    countEl.classList.remove('off');
  } else {
    dateEl.textContent = now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
    dotEl.classList.add('off');
    textEl.textContent = alarms.length ? '闹钟都已停用' : '暂无闹钟';
    countEl.textContent = '';
    countEl.classList.add('off');
  }
}
function tick() { const now = new Date(); $('#clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`; $('#date').textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }); $('#greeting').textContent = greeting(now.getHours()); renderCompact(now); checkAlarms(now); }
function stopRinging() {
  if (ringTimer) window.clearTimeout(ringTimer);
  if (retryTimer) window.clearTimeout(retryTimer);
  ringTimer = retryTimer = null;
  audio.pause(); audio.currentTime = 0;
  ringingAlarm = null; retriesLeft = 0;
  $('#ring-overlay').classList.add('hidden');
  ($('#space-progress') as HTMLElement).style.width = '0%';
  ($('#hold-seconds') as HTMLElement).textContent = '0';
}
function playRing(a: Alarm) {
  ringingAlarm = a;
  $('#ring-label').textContent = a.label || '时间到了';
  $('#ring-overlay').classList.remove('hidden');
  audio.volume = volume;
  if (a.soundPath) { audio.src = a.soundPath; audio.loop = true; audio.play().catch(() => { }); }
  else { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = volume; osc.connect(gain).connect(ctx.destination); osc.frequency.value = 660; osc.start(); osc.stop(ctx.currentTime + 2); }
  ringTimer = window.setTimeout(() => {
    audio.pause();
    if (ringingAlarm !== a) return;
    if (retriesLeft > 0 && a.snoozeMinutes > 0) {
      retriesLeft--;
      retryTimer = window.setTimeout(() => playRing(a), a.snoozeMinutes * 60000);
    } else stopRinging();
  }, Math.max(1, a.ringSeconds || 30) * 1000);
}
// 应用(或热更新)关闭响铃配置:同步遮罩里的按键名与目标秒数,长按判定随之变化
function applyDismissConfig(key: string, seconds: number) {
  dismissCode = key || 'Space';
  dismissHoldSeconds = Math.min(10, Math.max(1, Math.round(Number(seconds)) || 5));
  const label = keyLabel(dismissCode);
  const keyEl = document.getElementById('ring-key');
  const holdEl = document.getElementById('ring-hold');
  const targetEl = document.getElementById('hold-target');
  if (keyEl) keyEl.textContent = label;
  if (holdEl) holdEl.textContent = String(dismissHoldSeconds);
  if (targetEl) targetEl.textContent = String(dismissHoldSeconds);
}
function beginHold() {
  if (!ringingAlarm || holdTimer) return;
  holdStarted = Date.now();
  holdTimer = window.setInterval(() => {
    const seconds = Math.min(dismissHoldSeconds, (Date.now() - holdStarted) / 1000);
    ($('#hold-seconds') as HTMLElement).textContent = seconds.toFixed(1);
    ($('#space-progress') as HTMLElement).style.width = `${seconds / dismissHoldSeconds * 100}%`;
    if (seconds >= dismissHoldSeconds) { if (holdTimer) window.clearInterval(holdTimer); holdTimer = null; stopRinging(); }
  }, 50);
}
function endHold() {
  if (holdTimer) window.clearInterval(holdTimer);
  holdTimer = null; ($('#space-progress') as HTMLElement).style.width = '0%'; ($('#hold-seconds') as HTMLElement).textContent = '0';
}

function checkAlarms(now: Date) {
  const current = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const stamp = `${now.toDateString()}-${current}`;
  if (stamp === lastTriggered) return;
  const due = alarms.find(a => a.enabled && a.time === current && matchDay(a, now));
  if (!due) return;
  lastTriggered = stamp;
  retriesLeft = due.snoozeCount || 0;
  playRing(due);
  if ('Notification' in window && Notification.permission === 'granted') new Notification('小小闹钟', { body: due.label || '时间到了，该开始啦！' });
  if (due.repeat === 'once') { due.enabled = false; persist().then(render); } else render();
}
function render() {
  const list = $('#alarm-list');
  $('#empty').classList.toggle('hidden', alarms.length > 0);
  list.innerHTML = alarms.map(a => `<article class="alarm-card ${a.enabled ? '' : 'muted'}"><div class="row"><div><div class="time">${a.time}</div><p class="tag">${a.label || '未命名'}</p></div><button class="toggle ${a.enabled ? 'on' : ''}" data-toggle="${a.id}"><i></i></button></div><p class="meta"><span class="next">⏰ ${nextRing(a)}</span></p><div class="actions"><button data-edit="${a.id}">编辑</button><button data-delete="${a.id}">删除</button></div></article>`).join('');
  const active = alarms.filter(a => a.enabled).length;
  $('#active-label').textContent = `${active} 个闹钟正在运行`;
  list.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => { const a = alarms.find(x => x.id === (b as HTMLElement).dataset.toggle); if (a) { a.enabled = !a.enabled; await persist(); render(); } }));
  list.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => { alarms = alarms.filter(x => x.id !== (b as HTMLElement).dataset.delete); await persist(); render(); }));
  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openModal(alarms.find(x => x.id === (b as HTMLElement).dataset.edit))));
}
async function persist() { await window.alarmAPI.save(alarms); }
let selectedRepeat: Repeat = 'once';
function syncDaysVisible() { $('#days').classList.toggle('hidden', selectedRepeat !== 'custom'); }
function openModal(alarm?: Alarm) {
  editingId = alarm?.id || null; $('#modal').classList.remove('hidden'); $('#modal-title').textContent = alarm ? '编辑闹钟' : '新建闹钟'; $('#save-btn').textContent = alarm ? '保存修改' : '保存闹钟';
  setTimeValue(alarm?.time || '08:00');
  ($('#label-input') as HTMLInputElement).value = alarm?.label || '';
  selectedSound = alarm ? { path: alarm.soundPath, name: alarm.soundName || '系统默认铃声' } : { path: '', name: '系统默认铃声' }; $('#sound-name').textContent = selectedSound.name;
  ($('#ring-seconds') as HTMLSelectElement).value = String(alarm?.ringSeconds || 30);
  ($('#snooze-minutes') as HTMLSelectElement).value = String(alarm?.snoozeMinutes || 5);
  ($('#snooze-count') as HTMLSelectElement).value = String(alarm?.snoozeCount || 0);
  selectedRepeat = alarm?.repeat || 'once';
  document.querySelectorAll<HTMLButtonElement>('#repeat-chips button').forEach(b => b.classList.toggle('selected', b.dataset.repeat === selectedRepeat));
  document.querySelectorAll<HTMLButtonElement>('#days button').forEach(b => b.classList.toggle('selected', alarm?.repeat === 'custom' && alarm.days.includes(Number(b.dataset.day)) || false));
  syncDaysVisible();
}
function closeModal() { stopPreview(); $('#modal').classList.add('hidden'); editingId = null; }
function stopPreview() { if (previewTimer) window.clearTimeout(previewTimer); previewTimer = null; audio.pause(); audio.currentTime = 0; }
// 铃声弹窗两种模式: picker=新建/编辑闹钟里的纯选择列表; manage=主界面「我的铃声」完整管理
let libMode: 'picker' | 'manage' = 'manage';
function openSoundLib(mode: 'picker' | 'manage') {
  libMode = mode;
  $('#lib-title').textContent = mode === 'picker' ? '选择铃声' : '我的铃声';
  $('#lib-import').classList.toggle('hidden', mode === 'picker');
  $('#lib-site').classList.toggle('hidden', mode === 'picker');
  document.querySelector('.lib-hint')?.classList.toggle('hidden', mode === 'picker');
  renderLib().then(() => $('#sound-lib-modal').classList.remove('hidden'));
}
async function renderLib() {
  const sounds = await window.alarmAPI.listSounds();
  const list = $('#lib-list');
  const manage = libMode === 'manage';
  const progress = (() => {
    if (!manage || !downloadState) return '';
    const { name, received, total } = downloadState;
    const pct = total > 0 ? Math.min(100, Math.round(received / total * 100)) : 0;
    const label = total > 0 ? `${pct}%` : `${(received / 1048576).toFixed(1)} MB`;
    return `<div class="dl-progress" id="dl-progress-row"><p>⬇ 正在下载 ${name}</p><div class="dl-track"><div id="dl-bar" style="width:${pct}%"></div></div><small id="dl-pct">${label}</small></div>`;
  })();
  const actions = (s: { path: string; name: string }) => manage
    ? `<button class="lib-test" data-test="${s.path}" data-testname="${s.name}" title="试听">▶</button><button class="lib-ren" data-ren="${s.name}" title="重命名">✎</button><button class="lib-del" data-del="${s.name}" title="删除">✕</button>`
    : '';
  list.innerHTML = [progress, `<div class="lib-item ${selectedSound.path ? '' : 'selected'}"><button class="lib-pick" data-path="" data-name="系统默认铃声"><span class="lib-name">系统默认铃声</span></button>${actions({ path: '', name: '系统默认铃声' })}</div>`]
    .concat(sounds.map(s => `<div class="lib-item ${selectedSound.path === s.path ? 'selected' : ''}${manage && s.name === freshSound ? ' fresh' : ''}"><button class="lib-pick" data-path="${s.path}" data-name="${s.name}">${s.cover ? `<img class="lib-cover" src="${s.cover}" alt="">` : '<span class="lib-note">♫</span>'}<span class="lib-name">${s.name}</span></button>${actions(s)}</div>`)).join('');
  list.querySelectorAll<HTMLButtonElement>('.lib-pick').forEach(b => b.addEventListener('click', () => {
    selectedSound = { path: b.dataset.path || '', name: b.dataset.name || '系统默认铃声' };
    $('#sound-name').textContent = selectedSound.name;
    if (libMode === 'picker') { stopPreview(); $('#sound-lib-modal').classList.add('hidden'); }
    else renderLib();
  }));
  list.querySelectorAll<HTMLButtonElement>('.lib-test').forEach(b => b.addEventListener('click', () => testSound(b.dataset.test || '', b.dataset.testname || '')));
  list.querySelectorAll<HTMLButtonElement>('.lib-ren').forEach(b => b.addEventListener('click', () => openRename(b.dataset.ren!)));
  list.querySelectorAll<HTMLButtonElement>('.lib-del').forEach(b => b.addEventListener('click', async () => { if (!confirm(`确定删除铃声「${b.dataset.del}」吗？`)) return; await window.alarmAPI.deleteSound(b.dataset.del!); if (selectedSound.name === b.dataset.del) { selectedSound = { path: '', name: '系统默认铃声' }; $('#sound-name').textContent = selectedSound.name; } renderLib(); }));
}
let renamingSound = '';
let pendingDownloadToken = '';
let renameBusy = false;
function testSound(path: string, name: string) {
  if (previewTimer) window.clearTimeout(previewTimer); previewTimer = null;
  audio.pause(); audio.currentTime = 0;
  audio.volume = volume;
  if (path) {
    audio.src = path;
    audio.play().catch(() => { });
  } else {
    const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain();
    gain.gain.value = volume; osc.connect(gain).connect(ctx.destination); osc.frequency.value = 660;
    osc.start(); osc.stop(ctx.currentTime + .25);
  }
  previewTimer = window.setTimeout(() => { audio.pause(); audio.currentTime = 0; previewTimer = null; }, 10000);
}
let renamePrefix = 'alarm-';
let renameExt = '';
function openRename(name: string, downloadToken = '') {
  renamingSound = name;
  pendingDownloadToken = downloadToken;
  $('#rename-title').textContent = downloadToken ? '命名并下载铃声' : '重命名铃声';
  renameExt = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '.mp3';
  const stem = name.slice(0, name.length - renameExt.length);
  renamePrefix = '';
  const middle = stem.startsWith('alarm-') ? stem.slice(6) : stem;
  ($('#rename-input') as HTMLInputElement).value = middle;
  ($('#rename-input') as HTMLInputElement).readOnly = false;
  $('#rename-format').textContent = `（新名称）${renameExt}`;
  $('#rename-prefix').textContent = renamePrefix;
  $('#rename-prefix').classList.add('hidden');
  $('#rename-ext').textContent = renameExt;
  $('#rename-modal').classList.remove('hidden');
  ($('#rename-input') as HTMLInputElement).focus();
}
function closeRename() { $('#rename-modal').classList.add('hidden'); renamingSound = ''; pendingDownloadToken = ''; renameBusy = false; }
async function cancelPendingDownload() { if (pendingDownloadToken) await window.alarmAPI.cancelDownload(pendingDownloadToken); closeRename(); }

setInterval(tick, 1000); tick();
// 自定义时间选择器:▲▼(长按连加)或滚轮调节,时 0-23 / 分 0-59 循环;值同步进隐藏 input 供保存
let tpHour = 8, tpMinute = 0;
function renderTimePicker() {
  ($('#tp-hour') as HTMLElement).textContent = pad(tpHour);
  ($('#tp-minute') as HTMLElement).textContent = pad(tpMinute);
  ($('#time-input') as HTMLInputElement).value = `${pad(tpHour)}:${pad(tpMinute)}`;
}
function setTimeValue(v: string) {
  const [h, m] = v.split(':').map(Number);
  tpHour = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 8;
  tpMinute = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0;
  renderTimePicker();
}
function stepTime(part: 'hour' | 'minute', dir: number) {
  if (part === 'hour') tpHour = (tpHour + dir + 24) % 24;
  else tpMinute = (tpMinute + dir + 60) % 60;
  renderTimePicker();
}
function bindTimeSteppers() {
  document.querySelectorAll<HTMLButtonElement>('.tp-btn').forEach(b => {
    const part = (b.dataset.step as 'hour' | 'minute'), dir = Number(b.dataset.dir);
    let delay: number | undefined, rep: number | undefined;
    const stop = () => { window.clearTimeout(delay); window.clearInterval(rep); delay = rep = undefined; };
    b.addEventListener('mousedown', () => {
      stepTime(part, dir);
      delay = window.setTimeout(() => { rep = window.setInterval(() => stepTime(part, dir), 80); }, 420);
    });
    ['mouseup', 'mouseleave', 'blur'].forEach(ev => b.addEventListener(ev, stop));
  });
  $<HTMLElement>('#time-picker').addEventListener('wheel', e => {
    e.preventDefault();
    const seg = (e.target as HTMLElement).closest('[data-wheel]')?.getAttribute('data-wheel');
    if (seg === 'hour' || seg === 'minute') stepTime(seg, e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}
bindTimeSteppers();
$('#add-btn').addEventListener('click', () => openModal()); $('#close').addEventListener('click', closeModal);
document.querySelectorAll<HTMLButtonElement>('#repeat-chips button').forEach(b => b.addEventListener('click', () => { selectedRepeat = b.dataset.repeat as Repeat; document.querySelectorAll<HTMLButtonElement>('#repeat-chips button').forEach(x => x.classList.toggle('selected', x === b)); syncDaysVisible(); }));
document.querySelectorAll<HTMLButtonElement>('#days button').forEach(b => b.addEventListener('click', () => b.classList.toggle('selected')));
$('#sound-btn').addEventListener('click', () => openSoundLib('picker'));
$('#test-sound').addEventListener('click', async () => { if (previewTimer) window.clearTimeout(previewTimer); audio.pause(); audio.currentTime = 0; audio.volume = volume; if (selectedSound.path) { audio.src = selectedSound.path; try { await audio.play(); } catch { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = volume; osc.connect(gain).connect(ctx.destination); osc.frequency.value = 660; osc.start(); osc.stop(ctx.currentTime + .25); } } else { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = volume; osc.connect(gain).connect(ctx.destination); osc.frequency.value = 660; osc.start(); osc.stop(ctx.currentTime + .25); } previewTimer = window.setTimeout(() => { audio.pause(); audio.currentTime = 0; previewTimer = null; }, 10000); });
$('#volume').addEventListener('input', e => { volume = Number((e.target as HTMLInputElement).value) / 100; audio.volume = volume; });
const volumeInput = $('#volume') as HTMLInputElement;
const setVolume = (v: number) => { const clamped = Math.max(0, Math.min(100, Math.round(v))); volumeInput.value = String(clamped); volume = clamped / 100; audio.volume = volume; };
volumeInput.addEventListener('wheel', e => { e.preventDefault(); setVolume(Number(volumeInput.value) + (e.deltaY < 0 ? 5 : -5)); }, { passive: false });
$('#sound-lib').addEventListener('click', () => openSoundLib('manage'));
$('#lib-close').addEventListener('click', () => { stopPreview(); $('#sound-lib-modal').classList.add('hidden'); freshSound = null; libMode = 'manage'; });
$('#test-sound').addEventListener('click', () => testSound(selectedSound.path, selectedSound.name));
$('#lib-site').addEventListener('click', () => { window.alarmAPI.openMusicApp(); });
$('#rename-ok').addEventListener('click', async () => {
  const middle = ($('#rename-input') as HTMLInputElement).value.trim().replace(/[\\/:*?"<>|]/g, '_');
  if (!renamingSound || renameBusy) return;
  if (!middle) { alert('请输入铃声名称'); return; }
  const fullNew = `${renamePrefix}${middle}${renameExt}`;
  renameBusy = true;
  ($('#rename-ok') as HTMLButtonElement).disabled = true;
  try {
    if (pendingDownloadToken) {
      const result = await window.alarmAPI.confirmDownload(pendingDownloadToken, fullNew);
      if (!result) { alert('下载命名失败：名称可能已存在'); return; }
    } else if (fullNew !== renamingSound) {
      const result = await window.alarmAPI.renameSound(renamingSound, fullNew);
      if (!result) { alert('重命名失败：名称可能已存在'); return; }
      if (selectedSound.name === renamingSound) { selectedSound = result; $('#sound-name').textContent = result.name; }
    }
    closeRename();
    renderLib();
  } finally {
    renameBusy = false;
    ($('#rename-ok') as HTMLButtonElement).disabled = false;
  }
});
$('#rename-cancel').addEventListener('click', async () => { await cancelPendingDownload(); });
$<HTMLInputElement>('#rename-input').addEventListener('keydown', e => { if (e.key === 'Enter') ($('#rename-ok') as HTMLButtonElement).click(); if (e.key === 'Escape') cancelPendingDownload(); });
window.alarmAPI.onSoundsUpdated(() => { if (!$('#sound-lib-modal').classList.contains('hidden')) renderLib(); });
window.alarmAPI.onDownloadBefore((token, name) => {
  downloadState = { name, received: 0, total: 0 };
  libMode = 'manage';
  renderLib().then(() => { $('#sound-lib-modal').classList.remove('hidden'); openRename(name, token); });
});
window.alarmAPI.onDownloadStarted((token, name) => { downloadState = { name, received: 0, total: 0 }; renderLib(); });
window.alarmAPI.onDownloadProgress((token, name, received, total) => {
  if (received < 0) { downloadState = null; if (!$('#sound-lib-modal').classList.contains('hidden')) renderLib(); return; }
  downloadState = { name, received, total };
  const bar = document.getElementById('dl-bar');
  if (bar) { const pct = total > 0 ? Math.min(100, Math.round(received / total * 100)) : 0; bar.style.width = `${pct}%`; const pctEl = document.getElementById('dl-pct'); if (pctEl) pctEl.textContent = total > 0 ? `${pct}%` : `${(received / 1048576).toFixed(1)} MB`; }
  else if (!$('#sound-lib-modal').classList.contains('hidden')) renderLib();
});
window.alarmAPI.onDownloadDone((token, finalName) => { downloadState = null; freshSound = finalName; renderLib(); closeRename(); });
window.alarmAPI.onDownloadFailed(token => { if (token === pendingDownloadToken) closeRename(); downloadState = null; if (!$('#sound-lib-modal').classList.contains('hidden')) renderLib(); });
$('#save-btn').addEventListener('click', async () => {
  const days = [...document.querySelectorAll<HTMLButtonElement>('#days .selected')].map(b => Number(b.dataset.day));
  const time = ($('#time-input') as HTMLInputElement).value; if (!time) return;
  const data = { time, label: ($('#label-input') as HTMLInputElement).value, repeat: selectedRepeat, days, soundPath: selectedSound.path, soundName: selectedSound.name, enabled: true, ringSeconds: Number(($('#ring-seconds') as HTMLSelectElement).value), snoozeMinutes: Number(($('#snooze-minutes') as HTMLSelectElement).value), snoozeCount: Number(($('#snooze-count') as HTMLSelectElement).value) };
  if (editingId) { const i = alarms.findIndex(a => a.id === editingId); if (i >= 0) alarms[i] = { ...alarms[i], ...data }; } else alarms.push({ id: crypto.randomUUID(), ...data });
  await persist(); closeModal(); render();
});
window.alarmAPI.loadHolidays().then(h => { holidays = h; render(); });
window.alarmAPI.load().then(data => { alarms = (data as Alarm[]).map(a => ({ ...a, days: a.days || [], repeat: a.repeat || (a.days?.length ? 'custom' : 'once'), soundPath: a.soundPath || '', soundName: a.soundName || '系统默认铃声', ringSeconds: a.ringSeconds || 30, snoozeMinutes: a.snoozeMinutes ?? 5, snoozeCount: a.snoozeCount || 0 })); render(); });
// 长按关闭:按键与时长均可在设置里改;只在响铃遮罩出现时拦截,避免影响输入框打字
window.addEventListener('keydown', e => {
  if (!ringingAlarm || e.code !== dismissCode) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  if (!e.repeat) beginHold();
});
window.addEventListener('keyup', e => { if (e.code === dismissCode) endHold(); });
window.alarmAPI.getSettings().then(s => applyDismissConfig(s.dismissKey, s.dismissHoldSeconds)).catch(() => { /* 读取失败沿用默认 */ });
window.alarmAPI.onSettingsChanged(prefs => applyDismissConfig(prefs.dismissKey, prefs.dismissHoldSeconds));
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();

// ── 窗口按钮:最小化 ·（切换像素小窗,暂缓）· 关闭 ──
// 标题栏按钮自绘,真实窗口尺寸由主进程调整;像素小窗入口受 PIXEL_UI_ENABLED 控制
function applyCompactUI(compact: boolean) {
  // 功能停用期间强制保持大窗:历史偏好里的 compact=true 不会把界面切进小窗又退不出来
  document.body.classList.toggle('compact', PIXEL_UI_ENABLED && compact);
  const btn = document.getElementById('win-compact');
  if (btn) {
    const title = PIXEL_UI_ENABLED && compact ? '切换回大窗' : '切换像素小窗';
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }
  renderCompact(new Date());
}
document.getElementById('win-min')?.addEventListener('click', () => { void window.alarmAPI.winMinimize(); });
document.getElementById('win-close')?.addEventListener('click', () => { void window.alarmAPI.winClose(); });
// 像素小窗入口:功能暂缓,按钮不渲染(见 PIXEL_UI_ENABLED);恢复入口时这段逻辑无需改动
document.getElementById('win-compact')?.addEventListener('click', async () => {
  const next = !document.body.classList.contains('compact');
  applyCompactUI(next); // 先让布局切过去,窗口再缩放,视觉上更连贯
  await window.alarmAPI.setCompact(next);
});
document.getElementById('px-open')?.addEventListener('click', () => openModal());
window.alarmAPI.onCompactChanged(applyCompactUI);
// 停用期间不查询、不套用历史小窗状态,始终以大窗呈现
if (PIXEL_UI_ENABLED) window.alarmAPI.isCompact().then(applyCompactUI).catch(() => { /* 读不到就按大窗处理 */ });
