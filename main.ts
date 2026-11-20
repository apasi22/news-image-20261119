// news-image-20261119 — code-drawn front page "Thursday 19 November 2026".
// Node 22, stdlib only, no network, deterministic. Writes entry.png.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// ================= TTF parsing =================
function u16(b: Buffer, o: number): number { return (b[o] << 8) | b[o + 1]; }
function i16(b: Buffer, o: number): number { const v = u16(b, o); return v >= 0x8000 ? v - 0x10000 : v; }
function u32(b: Buffer, o: number): number { return (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0); }

interface Pt { x: number; y: number; on: boolean }
interface Glyph { adv: number; contours: Pt[][] }

class Font {
  upm = 2048; ascent = 0; descent = 0;
  private cmap = new Map<number, number>();
  private advs: number[] = [];
  private glyf: Buffer;
  private offs: number[];
  private cache = new Map<number, Glyph>();
  constructor(file: string) {
    const b = fs.readFileSync(file);
    const nT = u16(b, 4);
    const tab = new Map<string, { off: number; len: number }>();
    for (let i = 0; i < nT; i++) {
      const o = 12 + i * 16;
      tab.set(b.toString('latin1', o, o + 4), { off: u32(b, o + 8), len: u32(b, o + 12) });
    }
    const T = (tag: string): Buffer => { const t = tab.get(tag)!; return b.subarray(t.off, t.off + t.len); };
    const head = T('head'); this.upm = u16(head, 18);
    const hhea = T('hhea'); this.ascent = i16(hhea, 4); this.descent = i16(hhea, 6);
    const maxp = T('maxp'); const nG = u16(maxp, 4);
    const loca = T('loca'); const fmt = i16(head, 50);
    this.offs = [];
    for (let i = 0; i <= nG; i++) this.offs.push(fmt === 0 ? u16(loca, i * 2) * 2 : u32(loca, i * 4));
    this.glyf = T('glyf');
    const numH = u16(hhea, 34); const hmtx = T('hmtx');
    for (let g = 0; g < nG; g++) this.advs.push(g < numH ? u16(hmtx, g * 4) : u16(hmtx, (numH - 1) * 4));
    const cmap = T('cmap');
    const nSub = u16(cmap, 2);
    let sub = -1;
    for (let i = 0; i < nSub; i++) { const off = u32(cmap, 8 + i * 8); if (u16(cmap, off) === 4) { sub = off; break; } }
    const segCount = u16(cmap, sub + 6) / 2;
    const endB = sub + 14, startB = endB + segCount * 2 + 2, deltaB = startB + segCount * 2, rangeB = deltaB + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = u16(cmap, endB + s * 2), start = u16(cmap, startB + s * 2);
      const delta = i16(cmap, deltaB + s * 2), rangeOff = u16(cmap, rangeB + s * 2);
      for (let c = start; c <= end; c++) {
        if (c === 0xffff) break;
        let g: number;
        if (rangeOff === 0) g = (c + delta) & 0xffff;
        else { g = u16(cmap, rangeB + s * 2 + rangeOff + 2 * (c - start)); if (g !== 0) g = (g + delta) & 0xffff; }
        if (g !== 0) this.cmap.set(c, g);
      }
    }
  }
  glyph(ch: string): Glyph | null {
    const id = this.cmap.get(ch.codePointAt(0)!);
    if (id === undefined) return null;
    let g = this.cache.get(id);
    if (!g) { g = this.loadGlyph(id); this.cache.set(id, g); }
    return g;
  }
  advance(ch: string, size: number): number {
    const id = this.cmap.get(ch.codePointAt(0)!);
    return ((id === undefined ? 0 : this.advs[id]) || 0) * (size / this.upm);
  }
  widthOf(text: string, size: number, ls = 0): number {
    let w = 0;
    for (const ch of text) w += this.advance(ch, size) + ls;
    return w - ls;
  }
  private loadGlyph(id: number): Glyph {
    const start = this.offs[id], end = this.offs[id + 1];
    const adv = this.advs[id] || 0;
    if (end <= start) return { adv, contours: [] };
    const g = this.glyf;
    const nCont = i16(g, start);
    const contours: Pt[][] = [];
    if (nCont >= 0) {
      const endPts: number[] = [];
      for (let i = 0; i < nCont; i++) endPts.push(u16(g, start + 10 + i * 2));
      const insLen = u16(g, start + 10 + nCont * 2);
      let p = start + 10 + nCont * 2 + 2 + insLen;
      const nPts = endPts[endPts.length - 1] + 1;
      const flags: number[] = [];
      while (flags.length < nPts) { const f = g[p++]; flags.push(f); if (f & 0x08) { const r = g[p++]; for (let i = 0; i < r; i++) flags.push(f); } }
      const xs: number[] = []; let x = 0;
      for (let i = 0; i < nPts; i++) { const f = flags[i]; if (f & 0x02) { const d = g[p++]; x += (f & 0x10) ? d : -d; } else if (!(f & 0x10)) { x += i16(g, p); p += 2; } xs.push(x); }
      const ys: number[] = []; let y = 0;
      for (let i = 0; i < nPts; i++) { const f = flags[i]; if (f & 0x04) { const d = g[p++]; y += (f & 0x20) ? d : -d; } else if (!(f & 0x20)) { y += i16(g, p); p += 2; } ys.push(y); }
      let s = 0;
      for (const e of endPts) { const c: Pt[] = []; for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 0x01) !== 0 }); contours.push(c); s = e + 1; }
    } else {
      let p = start + 10;
      for (;;) {
        const flags = u16(g, p); const comp = u16(g, p + 2); p += 4;
        let dx = 0, dy = 0, sx = 1, sy = 1;
        if (flags & 0x0002) {
          if (flags & 0x0001) { dx = i16(g, p); dy = i16(g, p + 2); p += 4; }
          else { dx = g[p] >= 128 ? g[p] - 256 : g[p]; dy = g[p + 1] >= 128 ? g[p + 1] - 256 : g[p + 1]; p += 2; }
        } else { p += (flags & 0x0001) ? 4 : 2; }
        if (flags & 0x0008) { const s = i16(g, p) / 16384; sx = sy = s; p += 2; }
        else if (flags & 0x0040) { sx = i16(g, p) / 16384; sy = i16(g, p + 2) / 16384; p += 4; }
        else if (flags & 0x0080) { sx = i16(g, p) / 16384; sy = i16(g, p + 6) / 16384; p += 8; }
        const sub = this.loadGlyph(comp);
        for (const c of sub.contours) contours.push(c.map((pt) => ({ x: pt.x * sx + dx, y: pt.y * sy + dy, on: pt.on })));
        if (!(flags & 0x0020)) break;
      }
    }
    return { adv, contours };
  }
}

// ================= Rasterizer =================
type Seg = [number, number, number, number]; // x0,y0,x1,y1 (y down, device px)

function flattenGlyph(g: Glyph, scale: number): Seg[] {
  const segs: Seg[] = [];
  for (const c of g.contours) {
    if (c.length === 0) continue;
    // ordered vertex walk
    let start: Pt;
    let seq: Pt[];
    if (c[0].on) { start = c[0]; seq = c.slice(1); }
    else if (c[c.length - 1].on) { start = c[c.length - 1]; seq = c.slice(0, c.length - 1); }
    else { start = { x: (c[0].x + c[c.length - 1].x) / 2, y: (c[0].y + c[c.length - 1].y) / 2, on: true }; seq = c.slice(); }
    let cur = { x: start.x * scale, y: -start.y * scale };
    let i = 0;
    const line = (a: { x: number; y: number }, b: { x: number; y: number }) => { segs.push([a.x, a.y, b.x, b.y]); };
    const quad = (a: { x: number; y: number }, cp: { x: number; y: number }, b: { x: number; y: number }) => {
      const n = 10; let px = a.x, py = a.y;
      for (let k = 1; k <= n; k++) {
        const t = k / n, mt = 1 - t;
        const x = mt * mt * a.x + 2 * mt * t * cp.x + t * t * b.x;
        const y = mt * mt * a.y + 2 * mt * t * cp.y + t * t * b.y;
        segs.push([px, py, x, y]); px = x; py = y;
      }
    };
    while (i < seq.length) {
      const p = seq[i];
      if (p.on) { line(cur, { x: p.x * scale, y: -p.y * scale }); cur = { x: p.x * scale, y: -p.y * scale }; i++; }
      else {
        const q = i + 1 < seq.length ? seq[i + 1] : start;
        if (q.on) { quad(cur, { x: p.x * scale, y: -p.y * scale }, { x: q.x * scale, y: -q.y * scale }); cur = { x: q.x * scale, y: -q.y * scale }; i += 2; }
        else { const m = { x: (p.x + q.x) / 2 * scale, y: -(p.y + q.y) / 2 * scale }; quad(cur, { x: p.x * scale, y: -p.y * scale }, m); cur = m; i += 1; }
      }
    }
    line(cur, { x: start.x * scale, y: -start.y * scale });
  }
  return segs;
}

// Non-zero winding fill of segments into a grayscale mask (device px, SS supersample)
function rasterMask(segs: Seg[], w: number, h: number, ss: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  if (segs.length === 0) return mask;
  const sw = w * ss, sh = h * ss;
  const cov = new Float32Array(w * h);
  for (let row = 0; row < sh; row++) {
    const y = (row + 0.5) / ss;
    const xs: { x: number; d: number }[] = [];
    for (const [x0, y0, x1, y1] of segs) {
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        const x = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
        xs.push({ x, d: y1 > y0 ? 1 : -1 });
      }
    }
    if (xs.length === 0) continue;
    xs.sort((a, b) => a.x - b.x);
    let wind = 0; let prev = 0;
    for (let k = 0; k < xs.length; k++) {
      const x = xs[k].x;
      if (wind !== 0 && x > prev) {
        const x0 = Math.max(0, Math.floor(prev * ss)), x1 = Math.min(sw, Math.ceil(x * ss));
        for (let px = x0; px < x1; px++) cov[Math.floor(row / ss) * w + Math.floor(px / ss)] += 1 / (ss * ss);
      }
      wind += xs[k].d; prev = x;
    }
  }
  for (let i = 0; i < w * h; i++) mask[i] = Math.min(255, Math.round(cov[i] * 255));
  return mask;
}

// ================= Canvas =================
type RGB = [number, number, number];
class Canvas {
  w: number; h: number; data: Uint8Array;
  private glyphCache = new Map<string, { w: number; h: number; ox: number; oy: number; mask: Uint8Array }>();
  constructor(w: number, h: number, bg: RGB) {
    this.w = w; this.h = h; this.data = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { this.data[i * 3] = bg[0]; this.data[i * 3 + 1] = bg[1]; this.data[i * 3 + 2] = bg[2]; }
  }
  blend(x: number, y: number, c: RGB, a: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 3; const ia = 1 - a;
    this.data[i] = Math.round(this.data[i] * ia + c[0] * a);
    this.data[i + 1] = Math.round(this.data[i + 1] * ia + c[1] * a);
    this.data[i + 2] = Math.round(this.data[i + 2] * ia + c[2] * a);
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w)), y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * this.w + xx) * 3; this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2];
    }
  }
  fillPoly(pts: [number, number][], c: RGB) {
    if (pts.length < 3) return;
    const segs: Seg[] = [];
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; segs.push([a[0], a[1], b[0], b[1]]); }
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const ox = Math.floor(minX), oy = Math.floor(minY);
    const w = Math.ceil(maxX) - ox, h = Math.ceil(maxY) - oy;
    if (w <= 0 || h <= 0) return;
    const shifted = segs.map(([x0, y0, x1, y1]): Seg => [x0 - ox, y0 - oy, x1 - ox, y1 - oy]);
    const mask = rasterMask(shifted, w, h, 4);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const a = mask[yy * w + xx] / 255;
      if (a > 0) this.blend(ox + xx, oy + yy, c, a);
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    this.fillPoly(pts, c);
  }
  ring(cx: number, cy: number, r: number, c: RGB) {
    const r0 = Math.max(0, Math.floor(cx - r - 1)), r1 = Math.ceil(cx + r + 1);
    const c0 = Math.max(0, Math.floor(cy - r - 1)), c1 = Math.ceil(cy + r + 1);
    for (let y = c0; y < c1; y++) for (let x = r0; x < r1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r && d >= r - 1.4) this.blend(x, y, c, 0.9);
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, wd: number, c: RGB) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (wd / 2), ny = (dx / len) * (wd / 2);
    this.fillPoly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], c);
  }
  // ---- text ----
  private glyphMask(font: Font, ch: string, size: number) {
    const key = (font === serifBold ? 'sb' : font === serifItalic ? 'si' : font === sans ? 's' : 'sb2') + '|' + size + '|' + ch;
    let m = this.glyphCache.get(key);
    if (m) return m;
    const g = font.glyph(ch);
    if (!g || g.contours.length === 0) { m = { w: 0, h: 0, ox: 0, oy: 0, mask: new Uint8Array(0) }; this.glyphCache.set(key, m); return m; }
    const scale = size / font.upm;
    const segs = flattenGlyph(g, scale);
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [x0, y0, x1, y1] of segs) { minX = Math.min(minX, x0, x1); minY = Math.min(minY, y0, y1); maxX = Math.max(maxX, x0, x1); maxY = Math.max(maxY, y0, y1); }
    const ox = Math.floor(minX) - 1, oy = Math.floor(minY) - 1;
    const w = Math.ceil(maxX) - ox + 2, h = Math.ceil(maxY) - oy + 2;
    const shifted = segs.map(([a, b, c2, d]): Seg => [a - ox, b - oy, c2 - ox, d - oy]);
    m = { w, h, ox, oy, mask: rasterMask(shifted, w, h, 4) };
    this.glyphCache.set(key, m);
    return m;
  }
  drawText(text: string, x: number, y: number, font: Font, size: number, c: RGB, ls = 0): number {
    let px = x;
    for (const ch of text) {
      if (ch === ' ') { px += font.advance(' ', size) + ls; continue; }
      const m = this.glyphMask(font, ch, size);
      if (m.w > 0) {
        for (let yy = 0; yy < m.h; yy++) for (let xx = 0; xx < m.w; xx++) {
          const a = m.mask[yy * m.w + xx] / 255;
          if (a > 0) this.blend(Math.round(px) + m.ox + xx, Math.round(y) + m.oy + yy, c, a);
        }
      }
      px += font.advance(ch, size) + ls;
    }
    return px;
  }
  drawTextRight(text: string, x: number, y: number, font: Font, size: number, c: RGB, ls = 0) {
    this.drawText(text, x - font.widthOf(text, size, ls), y, font, size, c, ls);
  }
  drawTextCenter(text: string, cx: number, y: number, font: Font, size: number, c: RGB, ls = 0) {
    this.drawText(text, cx - font.widthOf(text, size, ls) / 2, y, font, size, c, ls);
  }
  wrap(text: string, font: Font, size: number, maxW: number, ls = 0): string[] {
    const words = text.split(' ');
    const lines: string[] = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (font.widthOf(t, size, ls) <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
}

// ================= PNG =================
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, 'latin1'), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}
function writePNG(cv: Canvas, file: string) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(cv.w, 0); ihdr.writeUInt32BE(cv.h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(cv.h * (1 + cv.w * 3));
  for (let y = 0; y < cv.h; y++) {
    raw[y * (1 + cv.w * 3)] = 0;
    raw.set(cv.data.subarray(y * cv.w * 3, (y + 1) * cv.w * 3), y * (1 + cv.w * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

// ================= Fonts =================
const DIR = path.dirname(fileURLToPath(import.meta.url));
const serifBold = new Font(path.join(DIR, 'fonts', 'SerifBold.ttf'));
const serifItalic = new Font(path.join(DIR, 'fonts', 'SerifItalic.ttf'));
const sans = new Font(path.join(DIR, 'fonts', 'Sans.ttf'));
const sansBold = new Font(path.join(DIR, 'fonts', 'SansBold.ttf'));

// ================= Colors =================
const NAVY: RGB = [13, 27, 62];
const NAVY2: RGB = [24, 44, 92];
const GOLD: RGB = [216, 164, 65];
const RED: RGB = [178, 39, 30];
const REDBOX: RGB = [192, 57, 43];
const PAPER: RGB = [246, 241, 231];
const WHITE: RGB = [255, 255, 255];
const INK: RGB = [26, 26, 26];
const GREY: RGB = [107, 107, 107];
const LGREY: RGB = [154, 163, 178];
const BORDER: RGB = [216, 210, 196];
const BLUE: RGB = [29, 78, 158];
const TEAL: RGB = [14, 124, 123];
const ORANGE: RGB = [211, 84, 0];
const PURPLE: RGB = [108, 52, 131];
const GREEN: RGB = [30, 132, 73];

// ================= Content =================
interface Card { n: number; tag: string; tagC: RGB; head: string; body: string; src: string; art: number }
const LEAD: Card[] = [
  { n: 1, tag: 'SUMMIT', tagC: RED, head: 'Trump, Xi and Putin meet in first three-way summit', body: 'The leaders of the US, China and Russia sit down together in Shenzhen and sign a four-point \u201cDeclaration Towards Peace\u201d \u2014 on UN reform, energy supply, the ICC and nuclear risk. No mention of Ukraine.', src: 'REUTERS \u00b7 WHITE HOUSE', art: 1 },
  { n: 2, tag: 'COURT', tagC: BLUE, head: 'World court: Myanmar guilty of genocide', body: 'The ICJ rules 9\u20136 that Myanmar committed genocide against the Rohingya in 2017, the first time in 80 years it has held a state responsible. About 10,000 were killed.', src: 'ICJ \u00b7 CNN \u00b7 AP', art: 2 },
  { n: 3, tag: 'MISSILE', tagC: ORANGE, head: 'Houthi missile hits Riyadh\u2019s tallest tower', body: 'A missile strikes the 80-storey PIF Tower, headquarters of Saudi Arabia\u2019s sovereign fund, shattering windows across seven to eight floors. No injuries reported.', src: 'REUTERS \u00b7 SPA \u00b7 AFP', art: 3 },
];
const ROW2: Card[] = [
  { n: 4, tag: 'MARKETS', tagC: GREEN, head: 'Anthropic IPO at $81.3bn, largest ever', body: 'Shares priced at $83 open at $111.50 and close up 17% in the biggest listing in history.', src: 'REUTERS \u00b7 CNN', art: 4 },
  { n: 5, tag: 'GAMES', tagC: PURPLE, head: 'GTA VI goes on sale worldwide', body: 'The year\u2019s biggest game launches at midnight in every region, on PlayStation 5 and Xbox Series X|S, priced at $79.99. No PC version yet.', src: 'ROCKSTAR', art: 5 },
  { n: 6, tag: 'UNREST', tagC: RED, head: 'Violence grips Bangladesh as lockdown bites', body: 'The ancestral home of Muhammad Yunus is torched as unrest spreads to 28 districts, leaving at least four dead.', src: 'REUTERS', art: 6 },
  { n: 7, tag: 'WAR', tagC: BLUE, head: 'Kerch Bridge hit for a third time in a week', body: 'Ukrainian Neptune missiles damage the railway across the bridge to Crimea overnight; traffic is suspended.', src: 'REUTERS \u00b7 CNN', art: 7 },
];
const ROW3: Card[] = [
  { n: 8, tag: 'CLIMATE', tagC: TEAL, head: 'COP31 draft drops fossil fuels', body: 'The Antalya text, cut from 144 to 80 paragraphs, names no fuel and admits 1.5\u00b0C will be overshot.', src: 'REUTERS \u00b7 UN', art: 8 },
  { n: 9, tag: 'ENERGY', tagC: ORANGE, head: 'Hormuz crisis \u201cgreatest threat\u201d to energy', body: 'The IEA warns the Strait crisis is the biggest threat to global energy security it has ever seen.', src: 'IEA', art: 9 },
  { n: 10, tag: 'DEFENCE', tagC: BLUE, head: 'US offers Manila $2bn defence loan', body: 'A $2bn-plus military financing package for the Philippines, with $400m for the South China Sea.', src: 'WHITE HOUSE', art: 10 },
  { n: 11, tag: 'TRADE', tagC: GREEN, head: 'South Korea\u2019s exports pass $1 trillion', body: 'Chip sales lift annual exports past $1 trillion for the first time \u2014 only the fourth country ever to do so.', src: 'REUTERS', art: 11 },
];
const BRIEFS: { n: number; lead: string; body: string }[] = [
  { n: 12, lead: 'CYCLONE AKVAN', body: '300,000 evacuated in Odisha.' },
  { n: 13, lead: 'IMF: WORLD DEBT', body: 'Nears 100% of GDP; Georgieva warns APEC.' },
  { n: 14, lead: 'BLACKWELL CHIPS', body: 'Trump: Nvidia chips may reach China in 2\u20133 years.' },
  { n: 15, lead: 'IRAN: TANKERS HIT', body: 'Guards claim two tankers hit mines; unverified.' },
  { n: 16, lead: 'TAKAICHI\u2013PUTIN', body: 'Tokyo confirms 30-minute talks, first in 7 years.' },
  { n: 17, lead: 'GAZA TANK RAID', body: 'Israel ends the push past the Yellow Line.' },
  { n: 18, lead: 'TU-95 PAST TAIWAN', body: 'Two bombers enter the zone, second this week.' },
  { n: 19, lead: 'DARWIN PORT ROW', body: 'Albanese and Xi spar over the port at APEC.' },
  { n: 20, lead: 'SEOUL URGES TALKS', body: 'President Lee calls for dialogue to end the war.' },
  { n: 21, lead: 'SEOUL\u2013BEIJING PACT', body: 'Both sides agree to deepen their free-trade deal.' },
];

// ================= Illustrations =================
function skyline(cv: Canvas, x: number, y: number, w: number, h: number, c: RGB) {
  const bw = w / 7;
  for (let i = 0; i < 7; i++) {
    const bh = h * (0.35 + ((i * 37) % 50) / 100);
    cv.fillRect(x + i * bw + 1, y + h - bh, bw - 2, bh, c);
  }
}
function flag(cv: Canvas, x: number, y: number, w: number, h: number, kind: 'us' | 'cn' | 'ru' | 'ph') {
  cv.fillRect(x, y, 2, h + 14, [90, 90, 90]);
  if (kind === 'us') {
    for (let i = 0; i < 5; i++) cv.fillRect(x + 2, y + (i * h) / 5, w, h / 5, i % 2 === 0 ? RED : WHITE);
    cv.fillRect(x + 2, y, w * 0.45, (h * 2) / 5, BLUE);
  } else if (kind === 'cn') {
    cv.fillRect(x + 2, y, w, h, RED);
    cv.circle(x + 2 + w * 0.28, y + h * 0.3, 2.5, GOLD);
    cv.circle(x + 2 + w * 0.62, y + h * 0.25, 1.5, GOLD);
    cv.circle(x + 2 + w * 0.68, y + h * 0.5, 1.5, GOLD);
  } else if (kind === 'ru') {
    cv.fillRect(x + 2, y, w, h / 3, WHITE);
    cv.fillRect(x + 2, y + h / 3, w, h / 3, BLUE);
    cv.fillRect(x + 2, y + (2 * h) / 3, w, h / 3, RED);
  } else {
    // Philippines: blue top, red bottom, white triangle at hoist
    cv.fillRect(x + 2, y, w, h / 2, BLUE);
    cv.fillRect(x + 2, y + h / 2, w, h / 2, RED);
    cv.fillPoly([[x + 2, y], [x + 2, y + h], [x + 2 + w * 0.45, y + h / 2]], WHITE);
    cv.circle(x + 2 + w * 0.2, y + h / 2, 2, GOLD);
  }
}
function art(cv: Canvas, kind: number, x: number, y: number, w: number, h: number) {
  const big = h > 80;
  if (kind === 1) {
    cv.fillRect(x, y, w, h, [191, 227, 240]);
    cv.circle(x + w - 34, y + 26, 16, [255, 214, 120]);
    skyline(cv, x, y + h - 46, w, 46, NAVY2);
    flag(cv, x + 30, y + 22, 44, 30, 'us');
    flag(cv, x + w / 2 - 22, y + 14, 44, 30, 'cn');
    flag(cv, x + w - 76, y + 22, 44, 30, 'ru');
  } else if (kind === 2) {
    cv.fillRect(x, y, w, h, [232, 228, 220]);
    const cx = x + w / 2;
    cv.fillPoly([[cx - 52, y + 34], [cx + 52, y + 34], [cx, y + 12]], [178, 39, 30]);
    for (let i = 0; i < 4; i++) cv.fillRect(cx - 48 + i * 26, y + 36, 8, h - 44, [90, 90, 90]);
    cv.fillRect(cx - 58, y + h - 10, 116, 6, [90, 90, 90]);
    cv.circle(cx, y + 52, 7, GOLD);
    cv.line(cx - 22, y + 52, cx + 22, y + 52, 2, GOLD);
    cv.fillPoly([[cx - 26, y + 54], [cx - 20, y + 54], [cx - 23, y + 68]], GOLD);
    cv.fillPoly([[cx + 20, y + 54], [cx + 26, y + 54], [cx + 23, y + 68]], GOLD);
  } else if (kind === 3) {
    cv.fillRect(x, y, w, h, [42, 28, 66]);
    cv.fillRect(x, y + h - 22, w, 22, [24, 18, 40]);
    const tx = x + w / 2 - 16;
    cv.fillRect(tx, y + 12, 32, h - 30, [70, 80, 110]);
    for (let r = 0; r < 6; r++) for (let cI = 0; cI < 3; cI++) {
      const lit = (r * 3 + cI) % 3 !== 0;
      cv.fillRect(tx + 4 + cI * 9, y + 18 + r * 9, 6, 5, lit ? [255, 210, 110] : [30, 36, 58]);
    }
    // broken windows rows 2-3
    cv.fillRect(tx + 4, y + 36, 24, 5, [20, 22, 34]);
    cv.fillRect(tx + 4, y + 45, 24, 5, [20, 22, 34]);
    cv.fillPoly([[tx + 32, y + 40], [tx + 44, y + 34], [tx + 40, y + 46]], [255, 170, 60]);
    cv.fillPoly([[tx + 34, y + 42], [tx + 46, y + 44], [tx + 38, y + 52]], [255, 110, 40]);
    cv.line(x + 8, y + h - 30, tx + 6, y + 44, 2, [255, 255, 255]);
  } else if (kind === 4) {
    cv.fillRect(x, y, w, h, [16, 74, 54]);
    cv.fillRect(x + 16, y + h - 18, 18, 18, [46, 160, 120]);
    cv.fillRect(x + 42, y + h - 28, 18, 28, [70, 190, 140]);
    cv.fillRect(x + 68, y + h - 40, 18, 40, [120, 220, 170]);
    cv.line(x + 14, y + h - 16, x + w - 20, y + 12, 2.5, GOLD);
    cv.fillPoly([[x + w - 20, y + 12], [x + w - 30, y + 12], [x + w - 20, y + 22]], GOLD);
    cv.drawTextRight('$81.3bn', x + w - 8, y + 30, sansBold, 15, WHITE);
  } else if (kind === 5) {
    cv.fillRect(x, y, w, h, [255, 150, 80]);
    cv.fillRect(x, y + h * 0.55, w, h * 0.45, [255, 110, 120]);
    cv.circle(x + w - 30, y + 22, 13, [255, 230, 140]);
    skyline(cv, x, y + h - 26, w, 26, [90, 30, 70]);
    cv.fillRect(x + 18, y + h - 16, 34, 8, [40, 20, 50]);
    cv.circle(x + 26, y + h - 7, 4, [20, 20, 20]);
    cv.circle(x + 44, y + h - 7, 4, [20, 20, 20]);
  } else if (kind === 6) {
    cv.fillRect(x, y, w, h, [60, 30, 30]);
    skyline(cv, x, y + h - 30, w, 30, [30, 18, 18]);
    cv.fillPoly([[x + w / 2 - 12, y + h - 8], [x + w / 2 - 2, y + 12], [x + w / 2 + 4, y + h - 8]], [255, 170, 40]);
    cv.fillPoly([[x + w / 2 + 2, y + h - 8], [x + w / 2 + 12, y + 22], [x + w / 2 + 20, y + h - 8]], [255, 110, 30]);
  } else if (kind === 7) {
    cv.fillRect(x, y, w, h, [120, 190, 225]);
    cv.fillRect(x, y + h * 0.62, w, h * 0.38, [40, 110, 170]);
    cv.fillRect(x, y + h * 0.42, w, 5, [70, 70, 70]);
    for (let i = 0; i < 4; i++) cv.fillRect(x + 20 + i * ((w - 40) / 3), y + h * 0.47, 4, h * 0.2, [70, 70, 70]);
    cv.fillPoly([[x + w / 2 - 14, y + 8], [x + w / 2 - 4, y + 18], [x + w / 2 + 8, y + 6], [x + w / 2 + 4, y + 20], [x + w / 2 + 14, y + 14], [x + w / 2, y + 26]], [255, 170, 40]);
    cv.circle(x + w / 2, y + 16, 4, [255, 90, 30]);
  } else if (kind === 8) {
    cv.fillRect(x, y, w, h, [200, 230, 240]);
    cv.circle(x + w / 2, y + h / 2 + 2, 20, [70, 180, 110]);
    cv.fillPoly([[x + w / 2 - 14, y + h / 2 - 6], [x + w / 2 - 2, y + h / 2 - 12], [x + w / 2 + 8, y + h / 2 - 2], [x + w / 2 - 4, y + h / 2 + 10], [x + w / 2 - 16, y + h / 2 + 6]], [30, 140, 80]);
    cv.fillRect(x + w - 22, y + 8, 5, h - 16, [200, 200, 200]);
    cv.fillRect(x + w - 22, y + h - 22, 5, 14, [220, 60, 40]);
  } else if (kind === 9) {
    cv.fillRect(x, y, w, h, [30, 60, 100]);
    cv.fillRect(x, y + h * 0.66, w, h * 0.34, [20, 80, 130]);
    cv.fillRect(x + 24, y + 14, 6, h * 0.55, [40, 40, 40]);
    cv.fillRect(x + 44, y + 14, 6, h * 0.55, [40, 40, 40]);
    cv.fillRect(x + 18, y + 10, 38, 6, [40, 40, 40]);
    cv.fillPoly([[x + 30, y + 10], [x + 36, y - 2], [x + 42, y + 10]], [40, 40, 40]);
    cv.fillRect(x + w - 62, y + h - 16, 44, 8, [20, 20, 20]);
    cv.circle(x + w - 52, y + h - 7, 3.5, [15, 15, 15]);
    cv.circle(x + w - 28, y + h - 7, 3.5, [15, 15, 15]);
  } else if (kind === 10) {
    cv.fillRect(x, y, w, h, [190, 220, 240]);
    flag(cv, x + 16, y + 10, 30, 20, 'us');
    flag(cv, x + 56, y + 10, 30, 20, 'ph');
    cv.fillRect(x, y + h - 18, w, 18, [40, 110, 170]);
    cv.fillRect(x + w / 2 - 26, y + h - 30, 52, 12, [30, 30, 30]);
  } else {
    cv.fillRect(x, y, w, h, [230, 235, 245]);
    const cols: RGB[] = [RED, BLUE, TEAL, ORANGE, GREEN];
    for (let i = 0; i < 5; i++) cv.fillRect(x + 14 + i * 20, y + h - 26 - (i % 2) * 12, 17, 12 + (i % 2) * 12, cols[i]);
    cv.fillRect(x + w - 46, y + 8, 30, 4, [90, 90, 90]);
    cv.line(x + w - 46, y + 8, x + w - 46, y + h - 26, 2, [90, 90, 90]);
  }
}

// ================= Cards =================
function drawCard(cv: Canvas, c: Card, x: number, y: number, w: number, h: number, big: boolean) {
  cv.fillRect(x, y, w, h, WHITE);
  cv.line(x, y, x + w, y, 1, BORDER);
  cv.line(x, y + h, x + w, y + h, 1, BORDER);
  cv.line(x, y, x, y + h, 1, BORDER);
  cv.line(x + w, y, x + w, y + h, 1, BORDER);
  const artH = big ? 108 : 62;
  art(cv, c.art, x + 1, y + 1, w - 2, artH);
  // number badge
  cv.circle(x + 16, y + artH - 6, 11, c.tagC);
  cv.drawTextCenter(String(c.n), x + 16, y + artH - 6 + 4, sansBold, 12, WHITE);
  const tx = x + 12, tw = w - 24;
  let cy = y + artH + 12;
  cv.drawText(c.tag, tx, cy, sansBold, big ? 10 : 9, c.tagC, 1);
  cy += big ? 18 : 15;
  const hl = cv.wrap(c.head, serifBold, big ? 20 : 15.5, tw);
  for (const ln of hl) { cv.drawText(ln, tx, cy, serifBold, big ? 20 : 15.5, INK); cy += big ? 23 : 18; }
  cy += 2;
  const bl = cv.wrap(c.body, sans, big ? 12 : 11, tw);
  const maxBody = big ? 4 : 3;
  for (let i = 0; i < Math.min(bl.length, maxBody); i++) { cv.drawText(bl[i], tx, cy, sans, big ? 12 : 11, [60, 60, 60]); cy += big ? 15.5 : 13.5; }
  cv.drawText(c.src, tx, y + h - 13, sansBold, 9, GREY, 0.5);
}

// ================= Map =================
const LAND: [number, number, number, number][] = [
  [7, 3, 5.5, 2.8], [13.5, 1.2, 1.2, 0.8], [12, 8.5, 2.2, 3.5],
  [25, 2.8, 2.8, 1.8], [26, 8, 3, 3.5], [36, 3, 8, 2.8],
  [39, 7.5, 2, 1.8], [43, 10.5, 2.8, 1.4],
];
function inLand(gx: number, gy: number): boolean {
  for (const [cx, cy, rx, ry] of LAND) {
    const dx = (gx - cx) / rx, dy = (gy - cy) / ry;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}
const PINS: { lon: number; lat: number; c: RGB }[] = [
  { lon: 114, lat: 22, c: RED }, { lon: 4, lat: 52, c: BLUE }, { lon: 47, lat: 25, c: ORANGE },
  { lon: -122, lat: 38, c: PURPLE }, { lon: -80, lat: 26, c: PURPLE }, { lon: 90, lat: 24, c: RED },
  { lon: 36, lat: 45, c: BLUE }, { lon: 56, lat: 27, c: ORANGE }, { lon: 121, lat: 15, c: RED },
  { lon: 127, lat: 37, c: RED },
];
function drawMap(cv: Canvas, x: number, y: number, w: number, h: number) {
  const cell = 8, cols = 52, rows = 12;
  const ox = x + (w - cols * cell) / 2, oy = y + 4;
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
    if (inLand(gx + 0.5, gy + 0.5)) cv.circle(ox + gx * cell + 4, oy + gy * cell + 4, 1.7, LGREY);
  }
  for (const p of PINS) {
    const gx = ((p.lon + 180) / 360) * cols;
    const gy = ((80 - p.lat) / 135) * rows;
    const px = ox + gx * cell, py = oy + gy * cell;
    cv.circle(px, py, 4, p.c);
    cv.circle(px, py, 1.6, WHITE);
  }
}

// ================= Page =================
function drawPage(): Canvas {
  const W = 1024, H = 1024;
  const cv = new Canvas(W, H, PAPER);
  const MX = 24, CW = W - MX * 2;

  // ---- header ----
  cv.fillRect(0, 0, W, 130, NAVY);
  cv.fillRect(0, 130, W, 3, GOLD);
  cv.fillRect(MX, 18, 92, 94, REDBOX);
  cv.drawTextCenter('NOV', MX + 46, 30, sansBold, 13, WHITE, 2);
  cv.drawTextCenter('19', MX + 46, 62, serifBold, 34, WHITE);
  cv.drawTextCenter('THU', MX + 46, 92, sansBold, 11, WHITE, 2);
  cv.drawText('THE DAY IN WORLD NEWS', 132, 26, sansBold, 12, GOLD, 2.5);
  cv.drawText('Thursday 19 November 2026', 132, 62, serifBold, 42, WHITE);
  cv.drawText('Everything on this page happened, or was first reported, on Thursday 19 November 2026.', 132, 100, serifItalic, 14, [200, 205, 220]);
  const rx = W - MX;
  cv.drawTextRight('21 STORIES', rx, 30, sansBold, 13, WHITE, 1.5);
  cv.drawTextRight('4 CONTINENTS', rx, 52, sansBold, 13, WHITE, 1.5);
  cv.drawTextRight('ONE PAGE', rx, 74, sansBold, 13, GOLD, 1.5);

  // ---- lead row ----
  const lw = 317;
  for (let i = 0; i < 3; i++) drawCard(cv, LEAD[i], MX + i * (lw + 12), 142, lw, 258, true);

  // ---- rows 2 & 3 ----
  const sw = 235;
  for (let i = 0; i < 4; i++) drawCard(cv, ROW2[i], MX + i * (sw + 12), 408, sw, 178, false);
  for (let i = 0; i < 4; i++) drawCard(cv, ROW3[i], MX + i * (sw + 12), 594, sw, 178, false);

  // ---- bottom ----
  const by = 780, bh = 152;
  // map panel
  cv.fillRect(MX, by, 440, bh, WHITE);
  cv.line(MX, by, MX + 440, by, 1, BORDER);
  cv.line(MX, by + bh, MX + 440, by + bh, 1, BORDER);
  cv.line(MX, by, MX, by + bh, 1, BORDER);
  cv.line(MX + 440, by, MX + 440, by + bh, 1, BORDER);
  cv.drawText('WHERE IT HAPPENED', MX + 12, by + 13, sansBold, 11, INK, 1);
  drawMap(cv, MX + 12, by + 20, 416, 96);
  cv.drawText('$81.3bn IPO', MX + 12, by + bh - 12, sansBold, 10, INK);
  cv.drawText('9\u20136 ICJ VOTE', MX + 122, by + bh - 12, sansBold, 10, INK);
  cv.drawText('$1tn EXPORTS', MX + 232, by + bh - 12, sansBold, 10, INK);
  cv.drawText('385 m PIF TOWER', MX + 336, by + bh - 12, sansBold, 10, INK);
  // briefs panel
  const bx = MX + 452, bw = 524;
  cv.fillRect(bx, by, bw, bh, WHITE);
  cv.line(bx, by, bx + bw, by, 1, BORDER);
  cv.line(bx, by + bh, bx + bw, by + bh, 1, BORDER);
  cv.line(bx, by, bx, by + bh, 1, BORDER);
  cv.line(bx + bw, by, bx + bw, by + bh, 1, BORDER);
  cv.drawText('ALSO ON THURSDAY 19 NOVEMBER', bx + 12, by + 13, sansBold, 11, INK, 1);
  const colW = (bw - 24 - 12) / 2;
  for (let col = 0; col < 2; col++) {
    const cx0 = bx + 12 + col * (colW + 12);
    for (let r = 0; r < 5; r++) {
      const b = BRIEFS[col * 5 + r];
      const yy = by + 32 + r * 24;
      cv.drawText(String(b.n), cx0, yy, sansBold, 10.5, RED);
      const leadX = cx0 + 20;
      const lines = cv.wrap(b.lead + ' \u2014 ' + b.body, sansBold, 10.5, colW - 20);
      cv.drawText(lines[0] || '', leadX, yy, sansBold, 10.5, INK);
      if (lines[1]) cv.drawText(lines[1], leadX, yy + 12, sans, 10.5, [60, 60, 60]);
    }
  }

  // ---- date check ----
  cv.fillRect(MX, 938, CW, 34, [253, 237, 236]);
  cv.line(MX, 938, MX + CW, 938, 1.5, RED);
  cv.line(MX, 972, MX + CW, 972, 1.5, RED);
  cv.line(MX, 938, MX, 972, 1.5, RED);
  cv.line(MX + CW, 938, MX + CW, 972, 1.5, RED);
  cv.drawText('DATE CHECK \u2014 NOT 19 NOVEMBER:', MX + 10, 950, sansBold, 10.5, RED, 0.5);
  const dcW = sansBold.widthOf('DATE CHECK \u2014 NOT 19 NOVEMBER:', 10.5, 0.5);
  cv.drawText('Van Gogh $190.4m (18 Nov) \u00b7 Jeffries (18 Nov) \u00b7 Voyager 1 (18 Nov) \u00b7 EU \u20ac45bn (18 Nov) \u00b7 Gaza tanks (18 Nov) \u00b7 Epstein (16 Nov)', MX + 10 + dcW + 10, 950, sans, 10.5, [60, 60, 60]);

  // ---- footer ----
  cv.drawTextCenter('All 21 stories happened, or were first reported, on Thursday 19 November 2026.   Sources: Reuters \u00b7 AP \u00b7 AFP \u00b7 CNN \u00b7 ICJ \u00b7 IEA \u00b7 IMF \u00b7 Rockstar \u00b7 White House \u00b7 Yonhap.   Original drawings.', W / 2, 990, sans, 10.5, GREY);

  return cv;
}

function main() {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  fs.mkdirSync(outDir, { recursive: true });
  const cv = drawPage();
  writePNG(cv, path.join(outDir, 'entry.png'));
}

main();
