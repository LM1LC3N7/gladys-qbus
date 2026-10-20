// Generates cover.png (800x534) for gladys-qbus: plain Node, no dependency.
// A wired home automation panel (a controller with its modules and the
// links of its bus) next to the three things it drives here: a lamp, a
// shutter and a room thermostat, on a deep blue to teal gradient (no brand
// logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W + y / H) / 2;
    set(x, y, [20 + 10 * t, 50 + 90 * t, 110 + 40 * t]);
  }
}
const white = [255, 255, 255];
const dark = [24, 34, 58];
const panel = [232, 238, 245];
const amber = [255, 196, 70];
const green = [90, 220, 150];
const red = [240, 100, 80];
const disc = (cx, cy, r, color, alpha = 1) => {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const box = (x0, y0, x1, y1, r, color, alpha = 1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const cx = Math.min(Math.max(x, x0 + r), x1 - r);
      const cy = Math.min(Math.max(y, y0 + r), y1 - r);
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy) + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const line = (x0, y0, x1, y1, width, color, alpha = 1) => {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const a = Math.max(0, Math.min(1, width / 2 - d + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};

disc(400, 267, 270, white, 0.05);

// The panel: a controller and six DIN modules with their LEDs.
box(60, 90, 360, 444, 24, panel);
box(85, 115, 335, 175, 10, dark);
for (let i = 0; i < 5; i += 1) disc(110 + i * 22, 145, 5, i % 2 ? green : amber);
for (let row = 0; row < 2; row += 1) {
  for (let col = 0; col < 3; col += 1) {
    const x = 85 + col * 85;
    const y = 200 + row * 120;
    box(x, y, x + 70, y + 100, 8, white);
    box(x + 10, y + 12, x + 60, y + 40, 4, [200, 210, 225]);
    disc(x + 20, y + 70, 6, (row + col) % 2 ? green : amber);
    disc(x + 50, y + 70, 6, dark, 0.6);
  }
}

// The bus links from the panel to the three devices.
const links = [
  [360, 160, 520, 130],
  [360, 267, 520, 267],
  [360, 380, 520, 405],
];
for (const [x0, y0, x1, y1] of links) {
  line(x0, y0, x1, y1, 6, white, 0.5);
  for (let t = 0.25; t < 1; t += 0.25) disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 5, white, 0.9);
}

// A lamp (bulb and rays).
disc(600, 120, 46, amber);
box(582, 160, 618, 190, 6, white);
for (let k = 0; k < 8; k += 1) {
  const angle = (k * Math.PI) / 4;
  line(
    600 + Math.cos(angle) * 58,
    120 + Math.sin(angle) * 58,
    600 + Math.cos(angle) * 74,
    120 + Math.sin(angle) * 74,
    6,
    amber,
  );
}

// A shutter (a window with its slats half down).
box(530, 215, 700, 325, 10, white);
box(542, 227, 688, 313, 4, [160, 200, 240]);
for (let k = 0; k < 5; k += 1) box(542, 227 + k * 10, 688, 234 + k * 10, 2, [120, 130, 150]);

// A room thermostat (display and buttons).
box(540, 345, 690, 470, 22, white);
box(560, 362, 670, 412, 10, dark);
box(572, 372, 658, 402, 6, [190, 220, 240]);
disc(580, 440, 15, red);
disc(650, 440, 15, [90, 170, 240]);
line(572, 440, 588, 440, 4, white);
line(642, 440, 658, 440, 4, white);
line(650, 432, 650, 448, 4, white);

// PNG encoding.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
