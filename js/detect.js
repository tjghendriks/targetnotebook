// Photo -> ten rectified diagrams with a detected shot position in each.
// Pipeline: find the ten black aiming marks, fit a homography to the known
// card layout, rectify each diagram, refine its centre and scale from the edge
// of the aiming mark, then look for the one region that breaks the diagram's
// radial symmetry (the shot hole).

import { CARDS } from './model.js';

export class ScanError extends Error {}

export const PATCH_PPM = 10;

// ---------- image decoding ----------

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ScanError('That file could not be read as an image.'));
    img.src = url;
  });
}

export async function decodeImage(src, maxSide = 3600) {
  let bmp;
  if (src instanceof HTMLCanvasElement) {
    bmp = src;
  } else if (src instanceof Blob) {
    try {
      bmp = await createImageBitmap(src, { imageOrientation: 'from-image' });
    } catch {
      const url = URL.createObjectURL(src);
      try {
        bmp = await loadImg(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } else {
    bmp = await loadImg(src);
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  return { w, h, rgba };
}

// ---------- aiming mark detection ----------

function downscaleLuma(img, f) {
  const sw = Math.floor(img.w / f);
  const sh = Math.floor(img.h / f);
  const out = new Uint8Array(sw * sh);
  const { rgba, w } = img;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let sum = 0;
      for (let dy = 0; dy < f; dy++) {
        let p = ((y * f + dy) * w + x * f) * 4;
        for (let dx = 0; dx < f; dx++, p += 4) {
          sum += rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29;
        }
      }
      out[y * sw + x] = sum / (f * f * 256);
    }
  }
  return { data: out, w: sw, h: sh };
}

function otsu(data) {
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = data.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

function darkComponents(data, w, h, thr) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start] >= thr) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const c = { area: 0, sx: 0, sy: 0, minx: w, maxx: 0, miny: h, maxy: 0 };
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      c.sx += x;
      c.sy += y;
      if (x < c.minx) c.minx = x;
      if (x > c.maxx) c.maxx = x;
      if (y < c.miny) c.miny = y;
      if (y > c.maxy) c.maxy = y;
      const visit = (q) => {
        if (!seen[q] && data[q] < thr) {
          seen[q] = 1;
          stack[sp++] = q;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    out.push(c);
  }
  return out;
}

// The n round dark blobs most alike in size.
export function findMarks(img, n) {
  const f = Math.max(1, Math.ceil(Math.max(img.w, img.h) / 900));
  const small = downscaleLuma(img, f);
  const long = Math.max(small.w, small.h);
  const base = otsu(small.data);
  let bestCount = 0;
  for (const k of [1, 0.85, 1.15, 0.7]) {
    const round = darkComponents(small.data, small.w, small.h, base * k).filter((c) => {
      const bw = c.maxx - c.minx + 1;
      const bh = c.maxy - c.miny + 1;
      const fill = c.area / (bw * bh);
      return (
        bw >= 0.03 * long && bw <= 0.3 * long && bh >= 0.03 * long && bh <= 0.3 * long &&
        bw / bh > 0.6 && bw / bh < 1.67 && fill > 0.55 && fill < 0.9
      );
    });
    bestCount = Math.max(bestCount, Math.min(round.length, n));
    if (round.length < n) continue;
    round.sort((a, b) => a.area - b.area);
    let pick = 0;
    let spread = Infinity;
    for (let i = 0; i + n <= round.length; i++) {
      const s = round[i + n - 1].area / round[i].area;
      if (s < spread) {
        spread = s;
        pick = i;
      }
    }
    if (spread > 2.5) continue;
    return round.slice(pick, pick + n).map((c) => ({
      x: (c.sx / c.area + 0.5) * f - 0.5,
      y: (c.sy / c.area + 0.5) * f - 0.5,
      r: (Math.sqrt(c.area / Math.PI) * f),
    }));
  }
  throw new ScanError(`Found ${bestCount} of ${n} aiming marks.`);
}

// Order the marks to match card.diagrams (reading order, row by row).
function assignMarks(marks, card) {
  const n = marks.length;
  let mx = 0;
  let my = 0;
  for (const m of marks) {
    mx += m.x;
    my += m.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const m of marks) {
    sxx += (m.x - mx) ** 2;
    sxy += (m.x - mx) * (m.y - my);
    syy += (m.y - my) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(ang);
  let uy = Math.sin(ang);
  // Long axis of the card points right (or down, for a card photographed sideways).
  if (Math.abs(ux) >= Math.abs(uy) ? ux < 0 : uy < 0) {
    ux = -ux;
    uy = -uy;
  }
  const proj = marks.map((m) => ({
    m,
    u: (m.x - mx) * ux + (m.y - my) * uy,
    v: (m.y - my) * ux - (m.x - mx) * uy,
  }));
  proj.sort((a, b) => a.v - b.v);
  let flipped = false;
  if (!card.symmetric) {
    // Uneven rows give the card away when it is upside down: the widest gap
    // between rows then falls after the short row instead of the long one.
    const first = card.rows[0];
    const last = card.rows.at(-1);
    const gapUpright = proj[first].v - proj[first - 1].v;
    const gapInverted = proj[last].v - proj[last - 1].v;
    if (gapInverted > gapUpright) {
      flipped = true;
      for (const p of proj) {
        p.u = -p.u;
        p.v = -p.v;
      }
      proj.reverse();
    }
  }
  const ordered = [];
  let at = 0;
  for (const size of card.rows) {
    ordered.push(...proj.slice(at, at + size).sort((a, b) => a.u - b.u).map((p) => p.m));
    at += size;
  }
  return { ordered, flipped };
}

// RMS distance between the marks and the card layout after the best-fitting
// rotation, scale and shift (no perspective).
function layoutError(layout, marks) {
  const n = layout.length;
  const mean = (pts) => pts.reduce((a, p) => ({ x: a.x + p.x / n, y: a.y + p.y / n }), { x: 0, y: 0 });
  const lc = mean(layout);
  const mc = mean(marks);
  let re = 0;
  let im = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const px = layout[i].x - lc.x;
    const py = layout[i].y - lc.y;
    const qx = marks[i].x - mc.x;
    const qy = marks[i].y - mc.y;
    re += px * qx + py * qy;
    im += px * qy - py * qx;
    den += px * px + py * py;
  }
  re /= den;
  im /= den;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const px = layout[i].x - lc.x;
    const py = layout[i].y - lc.y;
    sum += (re * px - im * py - (marks[i].x - mc.x)) ** 2 + (im * px + re * py - (marks[i].y - mc.y)) ** 2;
  }
  return Math.sqrt(sum / n);
}

// ---------- homography ----------

function solve(A, b) {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < n; r++) {
      const k = A[r][col] / A[col][col];
      for (let c = col; c < n; c++) A[r][c] -= k * A[col][c];
      b[r] -= k * b[col];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

function normaliser(pts) {
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= pts.length;
  my /= pts.length;
  let d = 0;
  for (const p of pts) d += Math.hypot(p.x - mx, p.y - my);
  const s = Math.SQRT2 / (d / pts.length);
  return { s, mx, my };
}

function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

// Least-squares homography taking src points onto dst points.
export function homography(src, dst) {
  const ns = normaliser(src);
  const nd = normaliser(dst);
  const A = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const b = new Array(8).fill(0);
  const add = (row, rhs) => {
    for (let i = 0; i < 8; i++) {
      if (!row[i]) continue;
      b[i] += row[i] * rhs;
      for (let j = 0; j < 8; j++) A[i][j] += row[i] * row[j];
    }
  };
  for (let i = 0; i < src.length; i++) {
    const x = (src[i].x - ns.mx) * ns.s;
    const y = (src[i].y - ns.my) * ns.s;
    const u = (dst[i].x - nd.mx) * nd.s;
    const v = (dst[i].y - nd.my) * nd.s;
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const hn = [...solve(A, b), 1];
  const Ts = [ns.s, 0, -ns.s * ns.mx, 0, ns.s, -ns.s * ns.my, 0, 0, 1];
  const TdInv = [1 / nd.s, 0, nd.mx, 0, 1 / nd.s, nd.my, 0, 0, 1];
  return mul3(TdInv, mul3(hn, Ts));
}

export function applyH(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d };
}

// ---------- rectified patches ----------

// A square patch centred on card position (cx, cy). `scale` is card mm per
// patch mm, used to correct the local scale once the aiming mark is measured.
function extractPatch(img, H, cx, cy, sizeMm, ppm, scale = 1, wantRgb = false) {
  const n = Math.round(sizeMm * ppm);
  const c = (n - 1) / 2;
  const luma = new Float32Array(n * n);
  const blue = new Float32Array(n * n);
  const rgb = wantRgb ? new Uint8ClampedArray(n * n * 4) : null;
  const { w, h, rgba } = img;
  const k = scale / ppm;
  for (let j = 0; j < n; j++) {
    const my = cy + (j - c) * k;
    for (let i = 0; i < n; i++) {
      const mx = cx + (i - c) * k;
      const den = H[6] * mx + H[7] * my + H[8];
      let x = (H[0] * mx + H[1] * my + H[2]) / den;
      let y = (H[3] * mx + H[4] * my + H[5]) / den;
      x = x < 0 ? 0 : x > w - 1.001 ? w - 1.001 : x;
      y = y < 0 ? 0 : y > h - 1.001 ? h - 1.001 : y;
      const x0 = x | 0;
      const y0 = y | 0;
      const fx = x - x0;
      const fy = y - y0;
      const p = (y0 * w + x0) * 4;
      const q = p + w * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const r = rgba[p] * w00 + rgba[p + 4] * w10 + rgba[q] * w01 + rgba[q + 4] * w11;
      const g = rgba[p + 1] * w00 + rgba[p + 5] * w10 + rgba[q + 1] * w01 + rgba[q + 5] * w11;
      const bl = rgba[p + 2] * w00 + rgba[p + 6] * w10 + rgba[q + 2] * w01 + rgba[q + 6] * w11;
      const o = j * n + i;
      luma[o] = (r * 77 + g * 150 + bl * 29) / 256;
      blue[o] = bl;
      if (rgb) {
        rgb[o * 4] = r;
        rgb[o * 4 + 1] = g;
        rgb[o * 4 + 2] = bl;
        rgb[o * 4 + 3] = 255;
      }
    }
  }
  return { n, ppm, luma, blue, rgb };
}

function sample(a, n, x, y) {
  x = x < 0 ? 0 : x > n - 1.001 ? n - 1.001 : x;
  y = y < 0 ? 0 : y > n - 1.001 ? n - 1.001 : y;
  const x0 = x | 0;
  const y0 = y | 0;
  const fx = x - x0;
  const fy = y - y0;
  const p = y0 * n + x0;
  return (a[p] * (1 - fx) + a[p + 1] * fx) * (1 - fy) + (a[p + n] * (1 - fx) + a[p + n + 1] * fx) * fy;
}

function percentile(values, q) {
  const s = Float32Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// Fit a circle to the edge of the aiming mark. Returns the offset of its
// centre from the patch centre and its radius, in patch mm.
function fitMark(patch, markR) {
  const { n, ppm, luma } = patch;
  const c = (n - 1) / 2;
  const inner = [];
  const outer = [];
  for (let j = 0; j < n; j += 3) {
    for (let i = 0; i < n; i += 3) {
      const r = Math.hypot(i - c, j - c) / ppm;
      if (r < 0.85 * markR) inner.push(luma[j * n + i]);
      else if (r > markR + 2.8 && r < markR + 5.3) outer.push(luma[j * n + i]);
    }
  }
  const black = percentile(inner, 0.2);
  const paper = percentile(outer, 0.5);
  if (paper - black < 25) return null;
  const thr = (black + paper) / 2;
  let pts = [];
  const step = 0.05;
  for (let a = 0; a < 360; a++) {
    const ca = Math.cos((a * Math.PI) / 180);
    const sa = Math.sin((a * Math.PI) / 180);
    const from = markR + 3.8;
    let prev = sample(luma, n, c + ca * from * ppm, c + sa * from * ppm);
    if (prev < thr) continue;
    for (let r = from - step; r >= markR - 8.7; r -= step) {
      const v = sample(luma, n, c + ca * r * ppm, c + sa * r * ppm);
      if (v < thr) {
        const rr = r + (step * (thr - v)) / (prev - v);
        pts.push([ca * rr, sa * rr]);
        break;
      }
      prev = v;
    }
  }
  let fit = null;
  for (let iter = 0; iter < 4 && pts.length >= 20; iter++) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
    for (const [x, y] of pts) {
      const z = x * x + y * y;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      sxz += x * z; syz += y * z; sz += z;
    }
    const [D, E, F] = solve(
      [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, pts.length]],
      [-sxz, -syz, -sz]
    );
    const ox = -D / 2;
    const oy = -E / 2;
    const r = Math.sqrt(Math.max(0, ox * ox + oy * oy - F));
    fit = { ox, oy, r, points: pts.length };
    const res = pts.map(([x, y]) => Math.abs(Math.hypot(x - ox, y - oy) - r));
    const limit = Math.max(0.12, 2.5 * percentile(res, 0.5));
    pts = pts.filter((_, i) => res[i] <= limit);
  }
  if (!fit || fit.points < 150 || Math.abs(fit.r - markR) > 4) return null;
  return fit;
}

// ---------- shot detection ----------

function radialMedian(a, n, ppm, bins) {
  const c = (n - 1) / 2;
  const out = new Float32Array(bins);
  out[0] = sample(a, n, c, c);
  for (let k = 1; k < bins; k++) {
    const m = Math.max(16, Math.ceil(2 * Math.PI * k));
    const buf = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const t = (2 * Math.PI * i) / m;
      buf[i] = sample(a, n, c + k * Math.cos(t), c + k * Math.sin(t));
    }
    buf.sort();
    out[k] = buf[m >> 1];
  }
  return out;
}

function integral(a, n) {
  const I = new Float64Array((n + 1) * (n + 1));
  for (let y = 0; y < n; y++) {
    let row = 0;
    for (let x = 0; x < n; x++) {
      row += a[y * n + x];
      I[(y + 1) * (n + 1) + x + 1] = I[y * (n + 1) + x + 1] + row;
    }
  }
  return I;
}

function boxMean(I, n, x, y, half) {
  const x0 = Math.max(0, x - half);
  const y0 = Math.max(0, y - half);
  const x1 = Math.min(n, x + half + 1);
  const y1 = Math.min(n, y + half + 1);
  const s = I[y1 * (n + 1) + x1] - I[y0 * (n + 1) + x1] - I[y1 * (n + 1) + x0] + I[y0 * (n + 1) + x0];
  return s / ((x1 - x0) * (y1 - y0));
}

// Grey-scale erosion: each pixel becomes the smallest value within `rad` px.
// It wipes out anything thinner than the window (printed numerals, slivers
// along a ring) while a solid shot hole only shrinks a little.
function erode(a, n, rad) {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let m = Infinity;
      for (let k = Math.max(0, x - rad); k <= Math.min(n - 1, x + rad); k++) m = Math.min(m, a[y * n + k]);
      tmp[y * n + x] = m;
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let m = Infinity;
      for (let k = Math.max(0, y - rad); k <= Math.min(n - 1, y + rad); k++) m = Math.min(m, tmp[k * n + x]);
      out[y * n + x] = m;
    }
  }
  return out;
}

// Residual of the patch against its own radial median profile, 0..1.
export function residualMap(patch, card) {
  const { n, ppm, luma, blue } = patch;
  const c = (n - 1) / 2;
  const RMAX = card.searchR;
  const markR = card.aimingMarkDia / 2;
  const bins = Math.floor(RMAX * ppm) + 4;
  const El = radialMedian(luma, n, ppm, bins);
  const Eb = radialMedian(blue, n, ppm, bins);
  // A central shot covers most of the innermost circles, so the median there
  // would be the hole itself. Inside the 10 ring the card is plain black.
  const core = Math.round(Math.min(4.5, card.rings[0].dia / 2 - 0.6) * ppm);
  for (const E of [El, Eb]) {
    const black = percentile(E.subarray(core, Math.round(0.93 * markR * ppm)), 0.5);
    E.fill(black, 0, core);
  }
  const contrast = Math.max(20, El[Math.round((markR + 4.3) * ppm)] - El[Math.round(0.9 * markR * ppm)]);
  // Residual explained by a small misregistration of the printed rings.
  const slack = Math.max(1, Math.round(0.3 * ppm));
  const tol = (E) => {
    const t = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      for (let j = Math.max(0, k - slack); j <= Math.min(bins - 1, k + slack); j++) {
        t[k] = Math.max(t[k], Math.abs(E[j] - E[k]));
      }
    }
    return t;
  };
  const Tl = tol(El);
  const Tb = tol(Eb);
  const Rl = new Float32Array(n * n);
  const Rb = new Float32Array(n * n);
  const bin = new Int16Array(n * n).fill(-1);
  const sums = [0, 0, 0]; // N, Sxx, Syy
  const acc = { l: [0, 0, 0], b: [0, 0, 0] };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i - c;
      const y = j - c;
      const r = Math.hypot(x, y);
      if (r > RMAX * ppm) continue;
      const k0 = Math.floor(r);
      const f = r - k0;
      const o = j * n + i;
      bin[o] = Math.round(r);
      Rl[o] = luma[o] - (El[k0] * (1 - f) + El[k0 + 1] * f);
      Rb[o] = blue[o] - (Eb[k0] * (1 - f) + Eb[k0 + 1] * f);
      sums[0]++;
      sums[1] += x * x;
      sums[2] += y * y;
      acc.l[0] += Rl[o]; acc.l[1] += Rl[o] * x; acc.l[2] += Rl[o] * y;
      acc.b[0] += Rb[o]; acc.b[1] += Rb[o] * x; acc.b[2] += Rb[o] * y;
    }
  }
  // Remove a lighting gradient (least-squares plane; the mask is symmetric).
  const plane = (s) => [s[0] / sums[0], s[1] / sums[1], s[2] / sums[2]];
  const Pl = plane(acc.l);
  const Pb = plane(acc.b);
  // D discounts ring misregistration (used to find the hole); raw does not
  // (used to outline it, so a ring crossing the hole does not split it).
  const D = new Float32Array(n * n);
  const raw = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = j * n + i;
      const k = bin[o];
      if (k < 0) continue;
      const x = i - c;
      const y = j - c;
      const dl = Math.abs(Rl[o] - Pl[0] - Pl[1] * x - Pl[2] * y);
      const db = Math.abs(Rb[o] - Pb[0] - Pb[1] * x - Pb[2] * y);
      raw[o] = Math.max(dl, db) / contrast;
      D[o] = Math.max(0, dl - Tl[k], db - Tb[k]) / contrast;
    }
  }
  return { D, raw, profile: El, contrast, rmax: RMAX };
}

// Shared set-up for finding holes in a patch.
function shotSearch(patch, card) {
  const { n, ppm } = patch;
  const c = (n - 1) / 2;
  const { D, raw } = residualMap(patch, card);
  const thin = Math.round(0.45 * ppm);
  const Iw = integral(erode(D, n, thin), n);
  const Ir = integral(raw, n);
  const Ie = integral(erode(raw, n, thin), n);
  const half = Math.round((3.9 * ppm) / 2);
  const reach = (card.searchR - 2) * ppm;
  // Strongest gauge-sized response, keeping clear of the `avoid` circles ({x, y, r} in px).
  const peak = (avoid = []) => {
    let best = { v: 0, x: 0, y: 0 };
    for (let j = half; j < n - half; j += 2) {
      for (let i = half; i < n - half; i += 2) {
        if (Math.hypot(i - c, j - c) > reach) continue;
        if (avoid.some((a) => Math.hypot(i - a.x, j - a.y) < a.r)) continue;
        const v = boxMean(Iw, n, i, j, half);
        if (v > best.v) best = { v, x: i, y: j };
      }
    }
    return best;
  };
  const toShot = (hx, hy, confidence) => ({ x: (hx - c) / ppm, y: -(hy - c) / ppm, confidence });
  return { n, ppm, Ir, Ie, thin, half, peak, toShot };
}

// One shot per diagram: the single region that stands out.
function detectShot(patch, card) {
  const { n, ppm, Ir, half, peak, toShot } = shotSearch(patch, card);
  const p1 = peak();
  const p2 = peak([{ x: p1.x, y: p1.y, r: 7 * ppm }]);
  const ratio = p1.v / Math.max(p2.v, 1e-4);
  if (p1.v < 0.08 || ratio < 1.6) return [null];

  // Outline the hole and settle on its centroid (mean shift over a gauge-sized disc).
  const thr = 0.4 * boxMean(Ir, n, p1.x, p1.y, half);
  const sm = Math.max(1, Math.round(0.25 * ppm));
  const reachPx = 3.4 * ppm;
  let hx = p1.x;
  let hy = p1.y;
  let area = 0;
  for (let iter = 0; iter < 6; iter++) {
    let sx = 0;
    let sy = 0;
    area = 0;
    for (let y = Math.max(0, Math.floor(hy - reachPx)); y <= Math.min(n - 1, hy + reachPx); y++) {
      for (let x = Math.max(0, Math.floor(hx - reachPx)); x <= Math.min(n - 1, hx + reachPx); x++) {
        if (Math.hypot(x - hx, y - hy) > reachPx || boxMean(Ir, n, x, y, sm) <= thr) continue;
        sx += x;
        sy += y;
        area++;
      }
    }
    if (!area) return [null];
    hx = sx / area;
    hy = sy / area;
  }
  const eqDia = (2 * Math.sqrt(area / Math.PI)) / ppm;
  const sure = p1.v >= 0.2 && ratio >= 3 && eqDia > 3.5 && eqDia < 7.5;
  return [toShot(hx, hy, sure ? 'high' : 'low')];
}

// The connected hole-coloured region around a peak, described by its centroid,
// long axis, and its length and width along and across that axis (px).
function blobAt(search, p) {
  const { n, ppm, Ir, Ie, thin, half } = search;
  const win = Math.round(9 * ppm);
  const size = 2 * win + 1;
  const thr = 0.4 * boxMean(Ir, n, p.x, p.y, half);
  // Outlined on the eroded image so that printed numerals do not join on.
  // Erosion trims the same margin all round, which is added back below.
  const sm = Math.max(1, Math.round(0.25 * ppm));
  const mask = new Uint8Array(size * size).fill(255);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = p.x - win + i;
      const y = p.y - win + j;
      if (x >= 0 && y >= 0 && x < n && y < n && boxMean(Ie, n, x, y, sm) > thr) mask[j * size + i] = 0;
    }
  }
  // The component containing (or nearest to) the peak.
  const seen = new Uint8Array(size * size);
  let seed = -1;
  for (let rad = 0; rad <= 2 * ppm && seed < 0; rad++) {
    for (let j = win - rad; j <= win + rad && seed < 0; j++) {
      for (let i = win - rad; i <= win + rad; i++) {
        if (!mask[j * size + i]) {
          seed = j * size + i;
          break;
        }
      }
    }
  }
  if (seed < 0) return null;
  const stack = [seed];
  seen[seed] = 1;
  const xs = [];
  const ys = [];
  while (stack.length) {
    const q = stack.pop();
    const x = q % size;
    const y = (q - x) / size;
    xs.push(x);
    ys.push(y);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const o = ny * size + nx;
      if (!seen[o] && !mask[o]) {
        seen[o] = 1;
        stack.push(o);
      }
    }
  }
  const m = xs.length;
  const cx = xs.reduce((a, b) => a + b, 0) / m;
  const cy = ys.reduce((a, b) => a + b, 0) / m;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < m; i++) {
    sxx += (xs[i] - cx) ** 2;
    sxy += (xs[i] - cx) * (ys[i] - cy);
    syy += (ys[i] - cy) ** 2;
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ax = Math.cos(ang);
  const ay = Math.sin(ang);
  const along = new Float32Array(m);
  const across = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    along[i] = (xs[i] - cx) * ax + (ys[i] - cy) * ay;
    across[i] = (ys[i] - cy) * ax - (xs[i] - cx) * ay;
  }
  // Trimmed extents, so a stray whisker of torn paper does not stretch them.
  const span = (a) => {
    a.sort();
    return a[Math.floor(0.985 * (m - 1))] - a[Math.floor(0.015 * (m - 1))];
  };
  return { x: p.x - win + cx, y: p.y - win + cy, ax, ay, length: span(along) + 2 * thin, width: span(across) + 2 * thin };
}

// Two shots per diagram. They often overlap into one elongated hole: two
// equal circles a distance d apart make a shape that is d longer than it is
// wide, with the centres d/2 either side of its centroid along the long axis.
function detectPair(patch, card) {
  const search = shotSearch(patch, card);
  const { ppm, peak, toShot } = search;
  const p1 = peak();
  if (p1.v < 0.08) return [null, null];
  const b1 = blobAt(search, p1);
  if (!b1) return [null, null];
  const gap = (b1.length - b1.width) / ppm;
  const round = (b) => b.width / ppm > 3.5 && b.width / ppm < 7.5;
  const p2 = peak([{ x: b1.x, y: b1.y, r: b1.length / 2 + 2.2 * ppm }]);
  const noise = peak([{ x: b1.x, y: b1.y, r: b1.length / 2 + 4 * ppm }, { x: p2.x, y: p2.y, r: 7 * ppm }]);
  if (p1.v < 1.6 * noise.v) return [null, null];
  const strong = (p) => p.v >= 0.2 && p.v >= 3 * noise.v;

  // A second, separate hole.
  if (p2.v >= 0.08 && p2.v >= 1.6 * noise.v && p2.v >= 0.3 * p1.v) {
    const b2 = blobAt(search, p2);
    const first = toShot(b1.x, b1.y, round(b1) && gap < 1 && strong(p1) ? 'high' : 'low');
    if (!b2) return [first, null];
    const gap2 = (b2.length - b2.width) / ppm;
    return [first, toShot(b2.x, b2.y, round(b2) && gap2 < 1 && strong(p2) ? 'high' : 'low')];
  }

  // One elongated hole: the two shots overlap.
  if (gap >= 1) {
    const sure = gap >= 2.5 && round(b1) && strong(p1);
    const h = (gap * ppm) / 2;
    return [
      toShot(b1.x - b1.ax * h, b1.y - b1.ay * h, sure ? 'high' : 'low'),
      toShot(b1.x + b1.ax * h, b1.y + b1.ay * h, sure ? 'high' : 'low'),
    ];
  }

  // A single round hole: the other shot missed the diagram or went through
  // the same hole, which a photo cannot tell apart, so it is left unplaced.
  return [toShot(b1.x, b1.y, round(b1) && strong(p1) ? 'high' : 'low'), null];
}

// ---------- top level ----------

// Amount of fine print in the strip beyond the outer column of diagrams.
function printEnergy(img, H, side) {
  const p = extractPatch(img, H, side * 143, 0, 44, 4);
  const { n, luma } = p;
  const half = Math.round(10.5 * 4);
  const c = (n - 1) / 2;
  let sum = 0;
  let count = 0;
  for (let j = 1; j < n - 1; j++) {
    for (let i = Math.ceil(c - half); i < c + half; i++) {
      sum += Math.abs(luma[j * n + i + 1] - luma[j * n + i - 1]) + Math.abs(luma[(j + 1) * n + i] - luma[(j - 1) * n + i]);
      count++;
    }
  }
  return sum / count;
}

function patchToDataUrl(patch, outPx) {
  const src = document.createElement('canvas');
  src.width = src.height = patch.n;
  src.getContext('2d').putImageData(new ImageData(patch.rgb, patch.n, patch.n), 0, 0);
  const out = document.createElement('canvas');
  out.width = out.height = outPx;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, outPx, outPx);
  return out.toDataURL('image/jpeg', 0.85);
}

const tick = () => new Promise((r) => setTimeout(r));

async function scanAs(img, card, onProgress, debug) {
  const layout = card.diagrams;
  const count = layout.length;
  const markR = card.aimingMarkDia / 2;
  const found = findMarks(img, count);
  const { ordered: marks, flipped: inverted } = assignMarks(found, card);
  const meanR = marks.reduce((s, m) => s + m.r, 0) / count;
  if (layoutError(layout, marks) > 0.4 * meanR) {
    throw new ScanError(`The aiming marks do not match the ${card.label} layout.`);
  }
  const register = (ordered) => {
    let H = homography(layout, ordered);
    // Tighten the homography using the fitted centre of each aiming mark.
    for (let pass = 0; pass < 2; pass++) {
      const pts = layout.map((d, i) => {
        const fit = fitMark(extractPatch(img, H, d.x, d.y, 64, 6), markR);
        return fit ? applyH(H, d.x + fit.ox, d.y + fit.oy) : ordered[i];
      });
      H = homography(layout, pts);
    }
    return H;
  };
  onProgress('Squaring up the card');
  await tick();
  let H = register(marks);
  let flipped = inverted;
  if (card.symmetric) {
    // The pattern text is printed at the right-hand end of the card, so more
    // print on the left means it is inverted.
    flipped = printEnergy(img, H, -1) > 1.3 * printEnergy(img, H, 1);
    if (flipped) H = register([...marks].reverse());
  }

  const diagrams = [];
  for (let i = 0; i < count; i++) {
    const d = layout[i];
    onProgress(`Scoring diagram ${i + 1} of ${count}`);
    await tick();
    const fit = fitMark(extractPatch(img, H, d.x, d.y, 64, 6), markR);
    const scale = fit ? fit.r / markR : 1;
    const patch = extractPatch(
      img, H, d.x + (fit ? fit.ox : 0), d.y + (fit ? fit.oy : 0), card.patchMm, PATCH_PPM, scale, true
    );
    const shots = (card.shotsPerDiagram === 2 ? detectPair : detectShot)(patch, card);
    diagrams.push({
      image: patchToDataUrl(patch, 608),
      aligned: !!fit,
      shots: shots.map((s) => s && { x: round2(s.x), y: round2(s.y), source: 'auto', confidence: s.confidence }),
      ...(debug ? { patch, fit } : {}),
    });
  }
  return { type: card.id, diagrams, flipped, pixelsPerMm: meanR / markR, size: { w: img.w, h: img.h } };
}

// Works out which card it is from the number and layout of the aiming marks.
export async function scanCard(src, { onProgress = () => {}, debug = false } = {}) {
  onProgress('Reading photo');
  await tick();
  const img = await decodeImage(src);
  onProgress('Finding the aiming marks');
  await tick();
  for (const card of Object.values(CARDS)) {
    try {
      return await scanAs(img, card, onProgress, debug);
    } catch (err) {
      if (!(err instanceof ScanError)) throw err;
    }
  }
  throw new ScanError(
    `Could not find a ${Object.values(CARDS).map((c) => c.label).join(' or ')} card in the photo. ` +
      'Retake it with the whole card in frame, flat on a plain light surface and evenly lit.'
  );
}

const round2 = (v) => Math.round(v * 100) / 100;
