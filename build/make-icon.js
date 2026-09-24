/**
 * 天枢台 应用图标生成器（零依赖）
 * 运行：node build/make-icon.js
 * 产出：build/icon.ico  （256x256，PNG 压缩的 ICO，供 electron-builder 使用）
 *
 * 图形：蓝紫渐变圆角方块 + 白色对话气泡 + 三个蓝色圆点（对话/翻译意象）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

// ---------- 基础几何工具 ----------
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** 点是否落在圆角矩形内 */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = clamp(x, x0 + r, x1 - r);
  const cy = clamp(y, y0 + r, y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 点是否落在三角形内（重心法） */
function inTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = x - ax;
  const v2y = y - ay;
  const den = v0x * v1y - v1x * v0y;
  if (den === 0) return false;
  const u = (v2x * v1y - v1x * v2y) / den;
  const v = (v0x * v2y - v2x * v0y) / den;
  return u >= 0 && v >= 0 && u + v <= 1;
}

/** 圆形 */
function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// ---------- 颜色 ----------
const BG_TOP = [79, 124, 255]; // #4F7CFF
const BG_BOTTOM = [30, 58, 138]; // #1E3A8A
const WHITE = [255, 255, 255];
const DOT = [37, 99, 235]; // #2563EB

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 采样单点颜色，返回 [r,g,b,a]（0-255） */
function sample(x, y) {
  // 图标整体圆角外轮廓
  if (!inRoundRect(x, y, 0.5, 0.5, SIZE - 0.5, SIZE - 0.5, 56)) {
    return [0, 0, 0, 0];
  }

  // 背景对角线渐变
  const t = clamp((x + y) / (2 * SIZE), 0, 1);
  let color = [
    lerp(BG_TOP[0], BG_BOTTOM[0], t),
    lerp(BG_TOP[1], BG_BOTTOM[1], t),
    lerp(BG_TOP[2], BG_BOTTOM[2], t),
  ];

  // 对话气泡（圆角矩形）
  const bubble = inRoundRect(x, y, 52, 44, 204, 166, 30);
  // 气泡尾巴（三角）
  const tail = inTriangle(x, y, 88, 150, 124, 150, 92, 208);
  if (bubble || tail) {
    color = WHITE.slice(0, 3);
    // 三个圆点
    if (
      inCircle(x, y, 94, 106, 12) ||
      inCircle(x, y, 128, 106, 12) ||
      inCircle(x, y, 162, 106, 12)
    ) {
      color = DOT.slice(0, 3);
    }
  }

  return [color[0], color[1], color[2], 255];
}

// ---------- 渲染（4x4 超采样抗锯齿） ----------
function renderRGBA() {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  const SS = 4;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS);
          const af = c[3] / 255;
          r += c[0] * af;
          g += c[1] * af;
          b += c[2] * af;
          a += af;
        }
      }
      const n = SS * SS;
      const alpha = a / n;
      const idx = (py * SIZE + px) * 4;
      if (alpha > 0) {
        data[idx] = Math.round(r / a);
        data[idx + 1] = Math.round(g / a);
        data[idx + 2] = Math.round(b / a);
      }
      data[idx + 3] = Math.round(alpha * 255);
    }
  }
  return data;
}

// ---------- 最小 PNG 编码器 ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])), 0);
  return Buffer.concat([len, typeBuf, body, crcBuf]);
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每行前置一个 filter 字节 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 最小 ICO 封装（内嵌 PNG） ----------
function encodeICO(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count

  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 0 => 256
  entry[1] = 0; // height 0 => 256
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8); // size
  entry.writeUInt32LE(6 + 16, 12); // offset

  return Buffer.concat([header, entry, png]);
}

// ---------- 执行 ----------
const rgba = renderRGBA();
const png = encodePNG(rgba, SIZE);
const ico = encodeICO(png);

const outDir = __dirname;
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('[icon] 已生成 build/icon.ico (' + ico.length + ' bytes)');
