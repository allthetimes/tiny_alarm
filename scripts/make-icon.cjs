// 生成 build/icon.ico: 应用主色圆角方块 + 白色时钟表盘(钟圈+指针)。
// 纯 Node 无依赖,产物已提交;仅在需要调整图标外观时手动运行:  node scripts/make-icon.cjs
//
// 【为什么要输出多个尺寸】
// Windows 不会总是帮你缩放: 任务栏/Alt-Tab 用 32×32、列表用 16×16、资源管理器用 48×48。
// ICO 里若只放一张 256×256,部分外壳代码路径取不到合适尺寸,任务栏就会显示成空白。
// 所以这里固定产出 16/24/32/48/64/128/256 七个尺寸。
//
// 【抗锯齿】
// 图形按 4 倍超采样绘制再盒式降采样,小尺寸下指针和铃耳才不会糊成一团。
const fs = require('node:fs');
const path = require('node:path');

/** 要写入 ICO 的尺寸,从 16 到 256(ICO 目录项里 256 记作 0) */
const SIZES = [16, 24, 32, 48, 64, 128, 256];
/** 超采样倍数: 先用 size*SS 的分辨率绘制,再取平均降采样 */
const SS = 4;

const PURPLE = [0x62, 0x64, 0xdd];
const WHITE = [0xff, 0xff, 0xff];

/**
 * 把图形画在归一化坐标(0..1)上,这样同一套几何能输出任意尺寸。
 * 下列比例全部由原始 256px 设计稿换算而来,改外观时只动这里即可。
 */
const G = {
  corner: 52 / 256,          // 底板圆角半径
  face: { cx: 128 / 256, cy: 122 / 256, outer: 88 / 256, inner: 66 / 256 },
  handUp: { halfW: 5 / 256, from: 4 / 256, to: 52 / 256 },     // 竖直指针(从圆心向上)
  handDiag: { dirX: 0.78, dirY: 0.62, tol: 6 / 256, len: 46 / 256, reach: 60 / 256 },
  bells: [{ x: 52 / 256, y: 42 / 256, r: 17 / 256 }, { x: 204 / 256, y: 42 / 256, r: 17 / 256 }],
  feet: [{ x: 84 / 256, y: 210 / 256, r: 11 / 256 }, { x: 172 / 256, y: 210 / 256, r: 11 / 256 }]
};

/** 点是否落在圆角矩形内(矩形按外接正方形处理,半径 corner) */
function inRoundedRect(x, y, size, corner) {
  const lo = corner, hi = size - 1 - corner;
  const cx = Math.min(Math.max(x, lo), hi);
  const cy = Math.min(Math.max(y, lo), hi);
  return Math.hypot(x - cx, y - cy) <= corner;
}

/**
 * 小尺寸下线条会被降采样平均掉,表盘圈和指针都糊在一起。
 * 所以 24px 及以下把圆环加粗、指针加宽,保证轮廓还立得住。
 */
function smallBoost(size) {
  if (size <= 16) return 0.070;   // 16px: 显著加粗
  if (size <= 24) return 0.045;   // 24px: 适度加粗
  return 0;
}

/**
 * 在 size×size 的画布上绘制图标(已含超采样降采样)。
 * @returns {Buffer} BGRA 像素,自左到右、自上到下
 */
function renderIcon(size) {
  const W = size * SS;                 // 超采样画布边长
  const acc = new Float64Array(size * size * 3); // 累积 R,G,B
  const accA = new Float64Array(size * size);    // 累积 alpha
  const boost = smallBoost(size);      // 小尺寸的线条加粗量(归一化)
  const inner = Math.max(0.02, G.face.inner - boost);
  const halfW = G.handUp.halfW + boost * 0.45;

  for (let sy = 0; sy < W; sy++) {
    for (let sx = 0; sx < W; sx++) {
      // 归一化坐标(取超采样像素中心)
      const nx = (sx + 0.5) / W;
      const ny = (sy + 0.5) / W;
      const fx = nx * size, fy = ny * size;   // 目标尺寸下的坐标,便于用像素单位表达容差

      let color = null;

      if (inRoundedRect(nx * size, ny * size, size, G.corner * size)) {
        color = PURPLE;

        const dx = fx - G.face.cx * size;
        const dy = fy - G.face.cy * size;
        const d = Math.hypot(dx, dy);

        // 表盘圆环
        if (d <= G.face.outer * size && d >= inner * size) {
          color = WHITE;
        } else {
          // 竖直指针(12 点方向)
          const up = G.handUp;
          if (Math.abs(dx) <= halfW * size && dy <= -up.from * size && dy >= -up.to * size) {
            color = WHITE;
          } else if (d <= G.handDiag.reach * size) {
            // 斜向指针(约 4 点方向)
            const hd = G.handDiag;
            const t = dx / hd.dirX, u = dy / hd.dirY;
            if (t > 0 && u > 0 && Math.abs(t - u) < hd.tol * size && t < hd.len * size) color = WHITE;
          }
        }

        // 顶部两个铃耳
        for (const b of G.bells) {
          if (Math.hypot(fx - b.x * size, fy - b.y * size) <= b.r * size) color = WHITE;
        }
        // 底部两只小脚
        for (const f of G.feet) {
          if (Math.hypot(fx - f.x * size, fy - f.y * size) <= f.r * size) color = WHITE;
        }
      }

      // 降采样: 把超采样像素累加到目标像素
      const tx = (sx / SS) | 0, ty = (sy / SS) | 0;
      const ti = ty * size + tx;
      if (color) {
        acc[ti * 3] += color[0];
        acc[ti * 3 + 1] += color[1];
        acc[ti * 3 + 2] += color[2];
        accA[ti] += 1;
      }
    }
  }

  const per = SS * SS;                 // 每个目标像素覆盖的超采样点数
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const cover = accA[i] / per;       // 覆盖率即 alpha
    if (cover <= 0) continue;          // 全透明: BGRA 全 0
    // 已覆盖部分做颜色平均(避免边缘被黑色拉暗)
    const k = accA[i];
    out[i * 4] = Math.round(acc[i * 3 + 2] / k);      // B
    out[i * 4 + 1] = Math.round(acc[i * 3 + 1] / k);  // G
    out[i * 4 + 2] = Math.round(acc[i * 3] / k);      // R
    out[i * 4 + 3] = Math.round(cover * 255);         // A
  }
  return out;
}

/**
 * 把一张 BGRA 位图打包成 ICO 里的图像块:
 * BITMAPINFOHEADER + 自底向上的 BGRA 像素 + AND 掩码(透明处置 1)。
 */
function buildIcoImage(size, bgra) {
  const rowBytes = size * 4;
  const pixels = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    // BMP 是自底向上存的,翻转行序
    bgra.copy(pixels, y * rowBytes, (size - 1 - y) * rowBytes, (size - y) * rowBytes);
  }

  // AND 掩码: 每行按位存储,行宽补齐到 4 字节边界
  const maskRow = Math.ceil(size / 8);
  const maskPadded = (maskRow + 3) & ~3;
  const mask = Buffer.alloc(maskPadded * size); // 默认 0(不透明)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = bgra[(y * size + x) * 4 + 3];
      if (a !== 0) continue;
      // 完全透明的像素把掩码位置 1(高位在前),兼容仍读掩码的老式渲染路径
      mask[y * maskPadded + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);            // biSize
  info.writeInt32LE(size, 4);           // biWidth
  info.writeInt32LE(size * 2, 8);       // biHeight = XOR 图 + AND 掩码的高度
  info.writeUInt16LE(1, 12);            // biPlanes
  info.writeUInt16LE(32, 14);           // biBitCount
  info.writeUInt32LE(0, 16);            // biCompression = BI_RGB
  info.writeUInt32LE(pixels.length, 20); // biSizeImage

  return Buffer.concat([info, pixels, mask]);
}

function buildIco(sizes) {
  const images = sizes.map(s => ({ size: s, data: buildIcoImage(s, renderIcon(s)) }));

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);              // reserved
  dir.writeUInt16LE(1, 2);              // type = 1 (ICON)
  dir.writeUInt16LE(images.length, 4);  // 图像数量

  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + entries.length;
  images.forEach((img, i) => {
    const o = i * 16;
    entries[o] = img.size >= 256 ? 0 : img.size;      // 宽(256 记作 0)
    entries[o + 1] = img.size >= 256 ? 0 : img.size;  // 高
    entries[o + 2] = 0;                               // 调色板数
    entries[o + 3] = 0;                               // reserved
    entries.writeUInt16LE(1, o + 4);                  // 色平面
    entries.writeUInt16LE(32, o + 6);                 // 位深
    entries.writeUInt32LE(img.data.length, o + 8);    // 数据长度
    entries.writeUInt32LE(offset, o + 12);            // 数据偏移
    offset += img.data.length;
  });

  return Buffer.concat([dir, entries, ...images.map(i => i.data)]);
}

const ico = buildIco(SIZES);
const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'icon.ico');
fs.writeFileSync(outFile, ico);

console.log(`已写入 ${path.relative(process.cwd(), outFile)}`);
console.log(`  尺寸: ${SIZES.join(', ')}`);
console.log(`  大小: ${ico.length} bytes`);
