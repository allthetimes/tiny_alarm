// 生成 build/icon.ico: 应用主色圆角方块 + 白色时钟表盘(钟圈+指针)。
// 纯 Node 无依赖: ICO 内嵌 32bpp 未压缩 BMP。一次性脚本,产物已提交,勿需常跑。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 256;
const px = Buffer.alloc(SIZE * SIZE * 4); // BGRA

function put(x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = a;
}
// 圆角矩形覆盖判断(抗锯齿用距离软边)
function inRoundedRect(x, y, x0, y0, x1, y1, rad) {
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
  return Math.hypot(x - cx, y - cy) <= rad;
}
const PURPLE = [0x62, 0x64, 0xdd], WHITE = [0xff, 0xff, 0xff];

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 背景: 圆角方块,边缘 1.5px 软化
    const edge = 20;
    const inside = inRoundedRect(x, y, 0, 0, SIZE - 1, SIZE - 1, 52);
    if (!inside) continue;
    put(x, y, PURPLE);
    // 时钟表盘: 圆环外半径 88 内半径 68,圆心居中偏上
    const dx = x - 128, dy = y - 122, d = Math.hypot(dx, dy);
    if (d <= 88 && d >= 66) put(x, y, WHITE);
    // 指针: 12 点方向(竖线) + 4 点方向(斜线),从圆心出发
    else if (Math.abs(dx) <= 5 && dy <= -4 && dy >= -52) put(x, y, WHITE);
    else if (d <= 60) {
      // 斜向指针: 沿 (1, 0.8) 方向
      const t = dx / 0.78, u = dy / 0.62;
      if (t > 0 && u > 0 && Math.abs(t - u) < 6 && t < 46) put(x, y, WHITE);
    }
    // 顶部两个小铃耳: 圆心 (58,46) 与 (198,46) 半径 18
    if (Math.hypot(x - 52, y - 42) <= 17 || Math.hypot(x - 204, y - 42) <= 17) put(x, y, WHITE);
    // 底部小脚: 圆 (86,212) 与 (170,212) 半径 12
    if (Math.hypot(x - 84, y - 210) <= 11 || Math.hypot(x - 172, y - 210) <= 11) put(x, y, WHITE);
  }
}

// ICO: 目录头 + 单项目录 + BITMAPINFOHEADER + 像素(底行在前) + 全零 AND 掩码
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = SIZE; entry[1] = SIZE; entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
const bmpInfo = Buffer.alloc(40);
bmpInfo.writeUInt32LE(40, 0);
bmpInfo.writeInt32LE(SIZE, 4); bmpInfo.writeInt32LE(SIZE * 2, 8);
bmpInfo.writeUInt16LE(1, 12); bmpInfo.writeUInt16LE(32, 14);
bmpInfo.writeUInt32LE(0, 20);
const flipped = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) px.copy(flipped, (SIZE - 1 - y) * SIZE * 4, y * SIZE * 4, (y + 1) * SIZE * 4);
const mask = Buffer.alloc((SIZE / 8) * SIZE); // 全 0: alpha 决定透明
const image = Buffer.concat([bmpInfo, flipped, mask]);
entry.writeUInt32LE(image.length, 8); entry.writeUInt32LE(22, 12);
const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, entry, image]));
console.log('build/icon.ico written,', image.length + 22, 'bytes');
