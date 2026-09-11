#!/usr/bin/env node
/**
 * 小小闹钟 —— 一键发版脚本
 *
 *   npm run release -- 1.5.0
 *   npm run release -- 1.5.0 --notes "自定义说明"
 *   npm run release -- 1.5.0 --dry-run        # 只跑预检，不做任何改动
 *   npm run release -- 1.5.0 --skip-build     # 复用现有产物，不重新打包
 *
 * 这个脚本存在的意义：把发版时反复踩的坑全部前置成"预检 + 明确报错"。
 * 已知坑位（都在下面有对应处理）：
 *   1. gh auth status 会说"没登录"，但 gh auth token 其实读得到凭证 —— 以 token 为准
 *   2. token 的 scope 为空时，写操作返回 404（GitHub 用 404 隐藏权限不足）—— 预检就拦掉
 *   3. electron-builder 打包会因 release\win-unpacked 被运行中的实例占用而失败 —— 自动换目录重试
 *   4. gh 是 Windows 程序，不认 Git Bash 的 /tmp 路径 —— 说明一律内联传递
 *   5. 打包产物名与 latest.yml 不一致 —— 靠 package.json 的 artifactName 固定
 *   6. .git 残留锁文件导致 commit/push 报 cannot lock ref —— 预检时清理
 *   7. 发完不核验，传坏了也不知道 —— 结束时比对远端 sha256 与本地
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'allthetimes/tiny_alarm';
const isWin = process.platform === 'win32';

// ── 终端着色（无 TTY 时自动降级）──
const useColor = process.stdout.isTTY;
const c = (n, s) => (useColor ? `\u001b[${n}m${s}\u001b[0m` : s);
const ok = s => console.log(c(32, '  ✓ ') + s);
const info = s => console.log(c(36, '  · ') + s);
const warn = s => console.log(c(33, '  ! ') + s);
const step = s => console.log('\n' + c(1, '▸ ' + s));
function fail(msg, hint) {
  console.log('\n' + c(31, '✗ ' + msg));
  if (hint) {
    const lines = Array.isArray(hint) ? hint : String(hint).split('\n');
    console.log('\n' + lines.map(l => '  ' + l).join('\n'));
  }
  process.exit(1);
}

// ── 子进程封装：默认继承 stdio 以便看到构建输出 ──
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} 退出码 ${r.status}`);
  }
  return r.status;
}
function capture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}
/** Windows 上 npm/npx 是 .cmd 批处理，必须走 shell。
 *  Node 22 起 spawnSync 直接执行 .cmd/.bat 会抛 EINVAL（CVE-2024-27980 的安全收紧），
 *  所以这类命令要用 shell:true；git.exe / gh.exe 是真可执行文件，保持 shell:false
 *  以免参数里的空格和换行被 shell 重新拆词（提交信息里就有换行）。 */
const npmOpts = () => (isWin ? { shell: true } : {});

// ════════════════════════════════ 参数解析 ════════════════════════════════
const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const positional = argv.filter(a => !a.startsWith('--'));
const flagValue = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const version = positional[0];
const DRY = flags.has('--dry-run');
const SKIP_BUILD = flags.has('--skip-build');

if (!version) {
  fail('缺少版本号', `用法：npm run release -- 1.5.0 [--notes "…"] [--dry-run] [--skip-build]`);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  fail(`版本号格式不对："${version}"`, `要是 x.y.z 的形式，比如 1.5.0`);
}

const tag = `v${version}`;
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const current = pkg.version;

console.log(c(1, `\n小小闹钟 发版  ${current} → ${version}`) + (DRY ? c(33, '   [dry-run]') : ''));

// ════════════════════════════════ 1. 预检 ════════════════════════════════
step('预检');

// 1.1 git 仓库可用 + 清理残留锁
try {
  capture('git', ['rev-parse', '--is-inside-work-tree']);
} catch {
  fail('当前目录不是有效的 git 仓库', [
    '常见原因：.git 被删过，缺 objects/ 或 refs/ 子目录。',
    '修复：git init   （只会补齐缺失的目录结构，保留原有 config 和历史）',
  ]);
}
const gitDir = path.resolve(ROOT, capture('git', ['rev-parse', '--git-dir']));
const lockFiles = findLocks(gitDir);
if (lockFiles.length) {
  warn(`发现 ${lockFiles.length} 个残留锁文件，正在清理：`);
  lockFiles.forEach(f => info(path.relative(gitDir, f)));
  lockFiles.forEach(f => { try { fs.rmSync(f, { force: true }); } catch {} });
}
ok('git 仓库可用');

function findLocks(dir) {
  const out = [];
  const walk = d => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'objects') walk(p); }
      else if (e.name.endsWith('.lock')) out.push(p);
    }
  };
  walk(dir);
  // objects 里的锁（如 maintenance.lock）单独扫一层即可
  try {
    for (const n of fs.readdirSync(path.join(dir, 'objects'))) {
      if (n.endsWith('.lock')) out.push(path.join(dir, 'objects', n));
    }
  } catch {}
  return [...new Set(out)];
}

// 1.2 工作区状态
const dirty = capture('git', ['status', '--porcelain']).split('\n').filter(Boolean);
if (dirty.length) {
  warn(`工作区有 ${dirty.length} 处未提交改动，这些会一并进入本次发版提交：`);
  dirty.slice(0, 10).forEach(l => info(l));
  if (dirty.length > 10) info(`… 另有 ${dirty.length - 10} 处`);
} else {
  ok('工作区干净');
}

// 1.3 分支与远端
const branch = capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') warn(`当前分支是 ${branch}，脚本会把提交推到该分支`);
const remoteUrl = capture('git', ['remote', 'get-url', 'origin']);
ok(`origin = ${remoteUrl}`);

// 1.4 SSH 连通性（git push 走的就是它）
try {
  capture('git', ['ls-remote', '--heads', 'origin'], { timeout: 30000 });
  ok('SSH 远端可达');
} catch {
  fail('连不上远端仓库（SSH）', [
    '排查顺序：',
    '1. 网络是否通：先开代理（Clash 等），确保 github.com 能访问',
    '2. SSH key 是否加载：ssh -T git@github.com',
    '3. 若网络只能走 HTTP 代理，可临时改 remote：',
    '   git remote set-url origin https://github.com/' + REPO + '.git',
  ]);
}

// 1.5 GitHub token —— 发 Release 的唯一硬门槛
const token = resolveToken();
function resolveToken() {
  const envTok = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envTok) return { value: envTok, from: '环境变量 GH_TOKEN/GITHUB_TOKEN' };
  try {
    const t = capture('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] });
    if (t) return { value: t, from: 'gh 凭证库（gh auth token）' };
  } catch {}
  return null;
}
if (!token) {
  fail('找不到 GitHub 凭证，无法创建 Release', [
    '三种拿到凭证的方式，任选其一：',
    '',
    '  A. 让 gh 自己登录（推荐，会带正确的 scope）：',
    '       gh auth login          → GitHub.com → SSH → Yes → Login with a web browser',
    '',
    '  B. 用已有的 token 喂给 gh：',
    '       echo YOUR_TOKEN | gh auth login --with-token',
    '',
    '  C. 只在本次会话临时用（不改 gh 配置）：',
    '       set GH_TOKEN=ghp_xxxx     (PowerShell: $env:GH_TOKEN="ghp_xxxx")',
    '',
    'token 到 https://github.com/settings/tokens 生成（classic，必须勾 repo）。',
  ]);
}
info(`凭证来源：${token.from}`);

// 1.6 token 有效性 + scope —— 这一步最能省时间
const api = 'https://api.github.com';
function apiRequest(url, method = 'GET', body) {
  const args = ['-sS', '-m', '30', '-X', method, '-D', '-', '-o', '-',
    '-H', `Authorization: Bearer ${token.value}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: tiny-alarm-release'];
  if (body) { args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body)); }
  args.push(url);
  const raw = execFileSync('curl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const sep = raw.indexOf('\r\n\r\n');
  const rest = sep >= 0 ? raw.slice(sep + 4) : raw;
  const sep2 = rest.indexOf('\r\n\r\n');
  const headers = sep2 >= 0 ? rest.slice(0, sep2) : '';
  const payload = sep2 >= 0 ? rest.slice(sep2 + 4) : rest;
  const status = Number((raw.match(/HTTP\/[\d.]+ (\d{3})/g) || []).pop()?.split(' ')[1] || 0);
  const scopes = (headers.match(/^x-oauth-scopes:\s*(.*)$/im) || [])[1]?.trim() ?? '';
  let json = null;
  try { json = JSON.parse(payload); } catch {}
  return { status, scopes, json, payload };
}

{
  const who = apiRequest(`${api}/user`);
  if (who.status === 401) {
    fail('凭证已失效（HTTP 401）', [
      '可能是 token 已被吊销。重新登录或换一个新 token：',
      '  gh auth logout --hostname github.com',
      '  gh auth login',
      '',
      '注意：gh 凭证库里可能还留着失效的旧 token，这种情况 gh auth token',
      '照样会返回内容，所以必须以 /user 的实际返回码为准。',
    ]);
  }
  if (who.status !== 200 || !who.json?.login) {
    fail(`凭证校验失败（HTTP ${who.status}）`, `响应：${who.payload.slice(0, 200)}`);
  }
  ok(`凭证有效，身份：${who.json.login}`);

  // classic PAT 会在 x-oauth-scopes 里列出 scope；fine-grained 为空但可能仍有写权限，
  // 所以空值只警告、不直接拦，留给后面的实际写入去判定。
  const classic = /ghp_|gho_/.test(token.value);
  if (classic) {
    if (!/\brepo\b/.test(who.scopes)) {
      fail(
        who.scopes
          ? `token 缺少 repo 权限（当前：${who.scopes}）`
          : 'token 的 scope 是空的 —— 这样的 token 连公开仓库都只能读',
        [
          '这是"发 Release 报 404"最常见的原因（GitHub 用 404 而不是 403 隐藏权限不足）。',
          '',
          '修复：https://github.com/settings/tokens 新建 classic token，勾上 repo。',
          '或者直接 gh auth login 走浏览器授权，会自动带上 repo / read:org / gist / workflow。',
        ]
      );
    }
    ok(`token 权限：${who.scopes}`);
  } else {
    info('非 classic token（fine-grained 或 OAuth），跳过 scope 检查，以实际写入为准');
  }

  // 仓库可达 + 有写权限（用只读接口无法判定写权限，这里确认仓库存在且归属正确）
  const repo = apiRequest(`${api}/repos/${REPO}`);
  if (repo.status !== 200) {
    fail(`仓库 ${REPO} 不可访问（HTTP ${repo.status}）`, '确认仓库名与 token 授权范围。');
  }
  ok(`仓库可达：${repo.json.full_name}`);

  // 版本不能回退
  const rel = apiRequest(`${api}/repos/${REPO}/releases/tags/${tag}`);
  if (rel.status === 200) {
    fail(`Release ${tag} 已经存在`, [
      `链接：${rel.json.html_url}`,
      '',
      '如果确实想重发，先删掉旧的：',
      `  gh release delete ${tag} --yes --cleanup-tag`,
      '  git push origin :refs/tags/' + tag,
    ]);
  } else {
    ok(`Release ${tag} 尚不存在，可以创建`);
  }

  const tagExists = (() => {
    try { return capture('git', ['rev-parse', '--verify', `refs/tags/${tag}`]) ? true : false; }
    catch { return false; }
  })();
  if (tagExists) {
    fail(`本地已存在标签 ${tag}`, `先删除：git tag -d ${tag}`);
  }
  ok(`本地无同名标签`);
}

if (DRY) {
  console.log('\n' + c(33, 'dry-run：预检全部通过，未做任何改动。') + '\n');
  process.exit(0);
}

// ════════════════════════════════ 2. 改版本号 ════════════════════════════════
step(`更新版本号 ${current} → ${version}`);
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
ok('package.json 已更新');

// ════════════════════════════════ 3. 构建 + 打包 ════════════════════════════════
let outDir = path.join(ROOT, 'release');
if (!SKIP_BUILD) {
  step('构建渲染层（tsc + vite）');
  run('npm', ['run', 'build'], npmOpts());
  ok('构建完成');

  step('打包 Windows 安装程序（electron-builder）');
  // 坑：release\win-unpacked 若被正在运行的应用占用，EnsureEmptyDir 会失败。
  // 先用默认目录，失败则自动换到带版本号的目录重试。
  let packed = false;
  try {
    run('npx', ['electron-builder'], npmOpts());
    packed = true;
  } catch {
    warn('默认输出目录 release\\ 打包失败（多半是被运行中的应用占用了文件）');
    info('改用 release-' + version + '\\ 重试…');
    outDir = path.join(ROOT, `release-${version}`);
    run('npx', ['electron-builder', `--config.directories.output=release-${version}`], npmOpts());
    packed = true;
  }
  if (!packed) fail('打包失败');
  ok(`打包完成 → ${path.relative(ROOT, outDir)}`);
} else {
  // 复用已有产物时，挑一个包含目标版本的目录
  const candidates = [path.join(ROOT, 'release'), path.join(ROOT, `release-${version}`)]
    .filter(d => fs.existsSync(path.join(d, `tiny-alarm-setup-${version}.exe`)));
  if (!candidates.length) fail(`没找到 ${version} 的安装包`, '去掉 --skip-build 重新打包。');
  outDir = candidates[0];
  info(`复用已有产物：${path.relative(ROOT, outDir)}`);
}

const assets = [
  `tiny-alarm-setup-${version}.exe`,
  `tiny-alarm-setup-${version}.exe.blockmap`,
  'latest.yml',
];
for (const a of assets) {
  const p = path.join(outDir, a);
  if (!fs.existsSync(p)) fail(`缺少产物：${a}`, `在 ${path.relative(ROOT, outDir)} 里没找到。`);
}
ok(`产物齐全：${assets.join('、')}`);

// 3.1 自检：latest.yml 里的 sha512 必须与 exe 一致，否则 electron-updater 会拒绝更新
{
  const yml = fs.readFileSync(path.join(outDir, 'latest.yml'), 'utf8');
  const declared = (yml.match(/sha512:\s*(\S+)/) || [])[1];
  const actual = base64Sha512(path.join(outDir, `tiny-alarm-setup-${version}.exe`));
  if (declared && declared !== actual) {
    fail('latest.yml 里的 sha512 与实际安装包不一致', '自动更新会失败，请重新打包。');
  }
  ok('latest.yml 的 sha512 与安装包一致（自动更新可用）');
}

function base64Sha512(file) {
  const h = crypto.createHash('sha512');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('base64');
}

// ════════════════════════════════ 4. 提交并推送 ════════════════════════════════
step('提交代码并打标签');
run('git', ['add', '-A']);
const subject = `${tag}: 版本发布`;
run('git', ['commit', '-m', subject, '--allow-empty']);
ok(`提交完成：${subject}`);

// 从提交信息主体取发布说明，除非显式给了 --notes
const notesFromFlag = flagValue('--notes');
let notes = notesFromFlag || '';
if (!notes) {
  try {
    const body = capture('git', ['log', '-1', '--pretty=%b']);
    notes = body.trim() || `${tag} 版本发布。`;
  } catch { notes = `${tag} 版本发布。`; }
}

run('git', ['tag', '-a', tag, '-m', `${tag}: ${notes.split('\n')[0]}`]);
ok(`标签 ${tag} 已创建（附注标签）`);

run('git', ['push', 'origin', branch]);
run('git', ['push', 'origin', tag]);
ok('代码与标签已推送');

// ════════════════════════════════ 5. 创建 Release 并上传 ════════════════════════════════
step(`创建 Release ${tag} 并上传 ${assets.length} 个文件`);
const ghEnv = { ...process.env, GH_TOKEN: token.value };
// 坑：不要用 --notes-file 传 /tmp 路径，gh 是 Windows 程序认不出。这里一律内联。
run('gh', ['release', 'create', tag, ...assets.map(a => path.join(outDir, a)),
  '--title', tag, '--notes', notes], { env: ghEnv });
ok('Release 已创建');

// ════════════════════════════════ 6. 核验 ════════════════════════════════
step('核验远端资产');
const check = apiRequest(`${api}/repos/${REPO}/releases/tags/${tag}`);
if (check.status !== 200) {
  warn(`暂时读不到 Release（HTTP ${check.status}），请手动确认`);
} else {
  const remote = new Map(check.json.assets.map(a => [a.name, a]));
  let allOk = true;
  for (const a of assets) {
    const localPath = path.join(outDir, a);
    const localSize = fs.statSync(localPath).size;
    const localSha = crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex');
    const r = remote.get(a);
    if (!r) { warn(`${a} 远端缺失`); allOk = false; continue; }
    const digest = String(r.digest || '');
    const shaOk = digest ? digest === `sha256:${localSha}` : r.size === localSize;
    if (r.size === localSize && shaOk) ok(`${a}  ${localSize} 字节  校验通过`);
    else { warn(`${a} 不匹配：远端 ${r.size} / 本地 ${localSize}`); allOk = false; }
  }
  if (!allOk) fail('有资产未通过核验，请到 Releases 页面检查');
}

console.log('\n' + c(32, c(1, `发版完成 ${tag}`)));
console.log(`  https://github.com/${REPO}/releases/tag/${tag}\n`);
