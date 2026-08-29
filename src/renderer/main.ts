import type { Alarm, PickedAudio, Repeat, HolidayConfig } from './types';
import './style.css';

declare global { interface Window { alarmAPI: { load: () => Promise<Alarm[]>; save: (alarms: Alarm[]) => Promise<void>; pickAudio: () => Promise<PickedAudio>; loadHolidays: () => Promise<HolidayConfig>; openMusicSite: () => Promise<void>; openMusicApp: () => Promise<void>; onSoundsUpdated: (cb: () => void) => void; onDownloadDone: (cb: (saved: string, final: string) => void) => void; listSounds: () => Promise<{ path: string; name: string }[]>; renameSound: (oldName: string, newName: string) => Promise<{ path: string; name: string } | null>; deleteSound: (name: string) => Promise<boolean> } } }
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
audio.volume = volume;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<div class="phone"><header class="top"><div class="brand"><div class="brand-mark">✦</div><strong>小小闹钟</strong></div><div class="clock"><strong id="clock">--:--</strong><span id="date">----</span></div></header><div class="hero"><p class="hi">早上好</p><p class="active"><i></i><span id="active-label">0 个闹钟正在运行</span></p></div><section id="alarm-list" class="alarm-list"></section><section class="empty" id="empty"><div class="empty-icon">◷</div><h2>还没有闹钟</h2><p>创建一个闹钟，开启你的专注时刻</p></section><div class="dock"><div class="dock-side"><label class="volume"><span>♫</span><input id="volume" type="range" min="0" max="100" value="72" aria-label="音量"></label><button class="icon-btn" id="sound-lib">我的铃声</button></div><button class="fab" id="add-btn">＋ 新建</button></div></div><div class="modal-backdrop hidden" id="modal"><div class="modal"><button class="close" id="close">×</button><h2 id="modal-title">新建闹钟</h2><label>时间<div class="time-picker"><input id="time-input" type="time" value="08:00"></div></label><label>标签<input id="label-input" type="text" placeholder="例如：晨读"></label><label>重复<div class="repeat-chips" id="repeat-chips">${repeats.map(r => `<button data-repeat="${r.key}">${r.label}</button>`).join('')}</div><div class="days" id="days">${weekdays.map((d, i) => `<button data-day="${i}">${d}</button>`).join('')}</div></label><div class="settings-grid"><label>响铃时长<select id="ring-seconds"><option value="10">10 秒</option><option value="30" selected>30 秒</option><option value="60">1 分钟</option><option value="300">5 分钟</option></select></label><label>再响间隔<select id="snooze-minutes"><option value="0">不再响</option><option value="5" selected>5 分钟</option><option value="10">10 分钟</option><option value="15">15 分钟</option></select></label><label>最多再响<select id="snooze-count"><option value="0">0 次</option><option value="1">1 次</option><option value="3" selected>3 次</option><option value="5">5 次</option></select></label></div><label>铃声<div class="sound-row"><button class="sound-select" id="sound-btn">♫ <span id="sound-name">系统默认铃声</span></button><button class="test-btn" id="test-sound">试听</button></div></label><button class="primary full" id="save-btn">保存闹钟</button></div></div><div class="modal-backdrop hidden" id="sound-lib-modal"><div class="modal"><button class="close" id="lib-close">×</button><h2 id="lib-title">我的铃声</h2><div class="lib-list" id="lib-list"></div><button class="primary full" id="lib-import">＋ 导入铃声</button><button class="ghost full" id="lib-site">🌐 内嵌打开音乐网站</button><small class="lib-hint">在内嵌窗口下载的音频会自动加入铃声库</small></div></div><div class="modal-backdrop hidden" id="rename-modal"><div class="modal small"><h2 id="rename-title">重命名铃声</h2><p class="rename-format" id="rename-format">alarm-（新名称）.mp3</p><div class="rename-box"><span class="rename-fixed" id="rename-prefix">alarm-</span><input id="rename-input" type="text" placeholder="新名称"><span class="rename-fixed" id="rename-ext">.mp3</span></div><div class="rename-actions"><button class="ghost" id="rename-cancel">取消</button><button class="primary" id="rename-ok">确定</button></div></div></div><div class="ring-overlay hidden" id="ring-overlay"><div class="ring-panel"><div class="ring-icon">♬</div><p class="ring-kicker">小小闹钟提醒</p><h2 id="ring-label">时间到了</h2><p>请长按空格键 5 秒关闭本次闹钟</p><div class="progress-track"><div id="space-progress"></div></div><small>已按住 <span id="hold-seconds">0</span> / 5 秒</small></div></div>`;
const $ = <T extends Element>(s: string) => document.querySelector<T>(s)!;
const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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

function tick() { const now = new Date(); $('#clock').textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`; $('#date').textContent = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }); checkAlarms(now); }
function stopRinging() {
  if (ringTimer) window.clearTimeout(ringTimer);
  if (retryTimer) window.clearTimeout(retryTimer);
  ringTimer = retryTimer = null;
  audio.pause(); audio.currentTime = 0;
  ringingAlarm = null; retriesLeft = 0;
  $('#ring-overlay').classList.add('hidden');
  $('#space-progress').style.width = '0%';
  $('#hold-seconds').textContent = '0';
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
function beginHold() {
  if (!ringingAlarm || holdTimer) return;
  holdStarted = Date.now();
  holdTimer = window.setInterval(() => {
    const seconds = Math.min(5, (Date.now() - holdStarted) / 1000);
    $('#hold-seconds').textContent = seconds.toFixed(1);
    $('#space-progress').style.width = `${seconds * 20}%`;
    if (seconds >= 5) { if (holdTimer) window.clearInterval(holdTimer); holdTimer = null; stopRinging(); }
  }, 50);
}
function endHold() {
  if (holdTimer) window.clearInterval(holdTimer);
  holdTimer = null; $('#space-progress').style.width = '0%'; $('#hold-seconds').textContent = '0';
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
  ($('#time-input') as HTMLInputElement).value = alarm?.time || '08:00';
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
async function renderLib() {
  const sounds = await window.alarmAPI.listSounds();
  const list = $('#lib-list');
  list.innerHTML = [`<div class="lib-item ${selectedSound.path ? '' : 'selected'}"><button class="lib-pick" data-path="" data-name="系统默认铃声"><span class="lib-name">系统默认铃声</span></button><button class="lib-test" data-test="" data-testname="系统默认铃声" title="试听">▶</button></div>`]
    .concat(sounds.map(s => `<div class="lib-item ${selectedSound.path === s.path ? 'selected' : ''}"><button class="lib-pick" data-path="${s.path}" data-name="${s.name}"><span class="lib-name">♫ ${s.name}</span></button><button class="lib-test" data-test="${s.path}" data-testname="${s.name}" title="试听">▶</button><button class="lib-ren" data-ren="${s.name}" title="重命名">✎</button><button class="lib-del" data-del="${s.name}" title="删除">✕</button></div>`)).join('');
  list.querySelectorAll<HTMLButtonElement>('.lib-pick').forEach(b => b.addEventListener('click', () => { selectedSound = { path: b.dataset.path || '', name: b.dataset.name || '系统默认铃声' }; $('#sound-name').textContent = selectedSound.name; renderLib(); }));
  list.querySelectorAll<HTMLButtonElement>('.lib-test').forEach(b => b.addEventListener('click', () => testSound(b.dataset.test || '', b.dataset.testname || '')));
  list.querySelectorAll<HTMLButtonElement>('.lib-ren').forEach(b => b.addEventListener('click', () => openRename(b.dataset.ren!)));
  list.querySelectorAll<HTMLButtonElement>('.lib-del').forEach(b => b.addEventListener('click', async () => { if (!confirm(`确定删除铃声「${b.dataset.del}」吗？`)) return; await window.alarmAPI.deleteSound(b.dataset.del!); if (selectedSound.name === b.dataset.del) { selectedSound = { path: '', name: '系统默认铃声' }; $('#sound-name').textContent = selectedSound.name; } renderLib(); }));
}
let renamingSound = '';
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
function openRename(name: string) {
  renamingSound = name;
  renameExt = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '.mp3';
  const stem = name.slice(0, name.length - renameExt.length);
  renamePrefix = stem.startsWith('alarm-') ? 'alarm-' : '';
  const middle = renamePrefix ? stem.slice(6) : stem;
  ($('#rename-input') as HTMLInputElement).value = middle;
  ($('#rename-input') as HTMLInputElement).readOnly = false;
  $('#rename-format').textContent = `${renamePrefix}（新名称）${renameExt}`;
  $('#rename-prefix').textContent = renamePrefix;
  $('#rename-ext').textContent = renameExt;
  $('#rename-modal').classList.remove('hidden');
  ($('#rename-input') as HTMLInputElement).focus();
}
function closeRename() { $('#rename-modal').classList.add('hidden'); renamingSound = ''; }

setInterval(tick, 1000); tick();
$('#add-btn').addEventListener('click', () => openModal()); $('#close').addEventListener('click', closeModal);
document.querySelectorAll<HTMLButtonElement>('#repeat-chips button').forEach(b => b.addEventListener('click', () => { selectedRepeat = b.dataset.repeat as Repeat; document.querySelectorAll<HTMLButtonElement>('#repeat-chips button').forEach(x => x.classList.toggle('selected', x === b)); syncDaysVisible(); }));
document.querySelectorAll<HTMLButtonElement>('#days button').forEach(b => b.addEventListener('click', () => b.classList.toggle('selected')));
$('#sound-btn').addEventListener('click', () => { renderLib().then(() => $('#sound-lib-modal').classList.remove('hidden')); });
$('#test-sound').addEventListener('click', async () => { if (previewTimer) window.clearTimeout(previewTimer); audio.pause(); audio.currentTime = 0; audio.volume = volume; if (selectedSound.path) { audio.src = selectedSound.path; try { await audio.play(); } catch { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = volume; osc.connect(gain).connect(ctx.destination); osc.frequency.value = 660; osc.start(); osc.stop(ctx.currentTime + .25); } } else { const ctx = new AudioContext(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); gain.gain.value = volume; osc.connect(gain).connect(ctx.destination); osc.frequency.value = 660; osc.start(); osc.stop(ctx.currentTime + .25); } previewTimer = window.setTimeout(() => { audio.pause(); audio.currentTime = 0; previewTimer = null; }, 10000); });
$('#volume').addEventListener('input', e => { volume = Number((e.target as HTMLInputElement).value) / 100; audio.volume = volume; });
const volumeInput = $('#volume') as HTMLInputElement;
const setVolume = (v: number) => { const clamped = Math.max(0, Math.min(100, Math.round(v))); volumeInput.value = String(clamped); volume = clamped / 100; audio.volume = volume; };
volumeInput.addEventListener('wheel', e => { e.preventDefault(); setVolume(Number(volumeInput.value) + (e.deltaY < 0 ? 5 : -5)); }, { passive: false });
$('#sound-lib').addEventListener('click', () => { renderLib().then(() => $('#sound-lib-modal').classList.remove('hidden')); });
$('#lib-close').addEventListener('click', () => { stopPreview(); $('#sound-lib-modal').classList.add('hidden'); });
$('#test-sound').addEventListener('click', () => testSound(selectedSound.path, selectedSound.name));
$('#lib-site').addEventListener('click', () => { window.alarmAPI.openMusicApp(); });
$('#rename-ok').addEventListener('click', async () => {
  const middle = ($('#rename-input') as HTMLInputElement).value.trim().replace(/[\\/:*?"<>|]/g, '_');
  if (!renamingSound) return;
  if (!middle) { alert('请输入铃声名称'); return; }
  const fullNew = `${renamePrefix}${middle}${renameExt}`;
  if (fullNew !== renamingSound) {
    const result = await window.alarmAPI.renameSound(renamingSound, fullNew);
    if (!result) { alert('重命名失败：名称可能已存在'); return; }
    if (selectedSound.name === renamingSound) { selectedSound = result; $('#sound-name').textContent = result.name; }
  }
  closeRename(); renderLib();
});
$('#rename-cancel').addEventListener('click', closeRename);
$('#rename-input').addEventListener('keydown', e => { if (e.key === 'Enter') ($('#rename-ok') as HTMLButtonElement).click(); if (e.key === 'Escape') closeRename(); });
window.alarmAPI.onSoundsUpdated(() => { if (!$('#sound-lib-modal').classList.contains('hidden')) renderLib(); });
window.alarmAPI.onDownloadDone((_saved, finalName) => {
  if (!$('#sound-lib-modal').classList.contains('hidden')) openRename(finalName);
});
$('#save-btn').addEventListener('click', async () => {
  const days = [...document.querySelectorAll<HTMLButtonElement>('#days .selected')].map(b => Number(b.dataset.day));
  const time = ($('#time-input') as HTMLInputElement).value; if (!time) return;
  const data = { time, label: ($('#label-input') as HTMLInputElement).value, repeat: selectedRepeat, days, soundPath: selectedSound.path, soundName: selectedSound.name, enabled: true, ringSeconds: Number(($('#ring-seconds') as HTMLSelectElement).value), snoozeMinutes: Number(($('#snooze-minutes') as HTMLSelectElement).value), snoozeCount: Number(($('#snooze-count') as HTMLSelectElement).value) };
  if (editingId) { const i = alarms.findIndex(a => a.id === editingId); if (i >= 0) alarms[i] = { ...alarms[i], ...data }; } else alarms.push({ id: crypto.randomUUID(), ...data });
  await persist(); closeModal(); render();
});
window.alarmAPI.loadHolidays().then(h => { holidays = h; render(); });
window.alarmAPI.load().then(data => { alarms = (data as Alarm[]).map(a => ({ ...a, days: a.days || [], repeat: a.repeat || (a.days?.length ? 'custom' : 'once'), soundPath: a.soundPath || '', soundName: a.soundName || '系统默认铃声', ringSeconds: a.ringSeconds || 30, snoozeMinutes: a.snoozeMinutes ?? 5, snoozeCount: a.snoozeCount || 0 })); render(); });
window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); beginHold(); } });
window.addEventListener('keyup', e => { if (e.code === 'Space') endHold(); });
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
