// Photo -> ten rectified diagrams with a detected shot position in each.
// Pipeline: find the ten black aiming marks, fit a homography to the known
// card layout, rectify each diagram, refine its centre and scale from the edge
// of the aiming mark, then look for the one region that breaks the diagram's
// radial symmetry (the shot hole).

import { CARD } from './model.js';

export class ScanError extends Error {}

const MARK_R = CARD.aimingMarkDia / 2;
export const PATCH_MM = 76;
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

function findMarks(img) {
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
    bestCount = Math.max(bestCount, Math.min(round.length, 10));
    if (round.length < 10) continue;
    // Keep the ten most alike in size.
    round.sort((a, b) => a.area - b.area);
    let pick = 0;
    let spread = Infinity;
    for (let i = 0; i + 10 <= round.length; i++) {
      const s = round[i + 9].area / round[i].area;
      if (s < spread) {
        spread = s;
        pick = i;
      }
    }
    if (spread > 2.5) continue;
    return round.slice(pick, pick + 10).map((c) => ({
      x: (c.sx / c.area + 0.5) * f - 0.5,
      y: (c.sy / c.area + 0.5) * f - 0.5,
      r: (Math.sqrt(c.area / Math.PI) * f),
    }));
  }
  throw new ScanError(
    `Found ${bestCount} of the 10 aiming marks. Retake the photo with the whole card in frame, ` +
      'flat on a plain light surface and evenly lit.'
  );
}

// Order the ten marks to match CARD.diagrams (4 top, 2 middle, 4 bottom).
function assignMarks(marks) {
  let mx = 0;
  let my = 0;
  for (const m of marks) {
    mx += m.x;
    my += m.y;
  }
  mx /= 10;
  my /= 10;
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
  const vx = -uy;
  const vy = ux;
  const proj = marks.map((m) => ({
    m,
    u: (m.x - mx) * ux + (m.y - my) * uy,
    v: (m.x - mx) * vx + (m.y - my) * vy,
  }));
  proj.sort((a, b) => a.v - b.v);
  const rows = [proj.slice(0, 4), proj.slice(4, 6), proj.slice(6, 10)];
  return rows.flatMap((row) => row.sort((a, b) => a.u - b.u).map((p) => p.m));
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
function fitMark(patch) {
  const { n, ppm, luma } = patch;
  const c = (n - 1) / 2;
  const inner = [];
  const outer = [];
  for (let j = 0; j < n; j += 3) {
    for (let i = 0; i < n; i += 3) {
      const r = Math.hypot(i - c, j - c) / ppm;
      if (r < 22) inner.push(luma[j * n + i]);
      else if (r > 28.5 && r < 31) outer.push(luma[j * n + i]);
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
    let prev = sample(luma, n, c + ca * 29.5 * ppm, c + sa * 29.5 * ppm);
    if (prev < thr) continue;
    for (let r = 29.5 - step; r >= 17; r -= step) {
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
  if (!fit || fit.points < 150 || Math.abs(fit.r - MARK_R) > 4) return null;
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

// The printed numerals also break radial symmetry; weigh them down when
// searching so they are not mistaken for a faint hole.
function numeralWeight(xmm, ymm) {
  const ax = Math.abs(xmm);
  const ay = Math.abs(ymm);
  for (const { r } of CARD.numerals) {
    if ((ax < 1.5 && Math.abs(ay - r) < 1.9) || (ay < 1.9 && Math.abs(ax - r) < 1.5)) return 0.3;
  }
  return 1;
}

// Residual of the patch against its own radial median profile, 0..1.
export function residualMap(patch) {
  const { n, ppm, luma, blue } = patch;
  const c = (n - 1) / 2;
  const RMAX = 35;
  const bins = Math.floor(RMAX * ppm) + 4;
  const El = radialMedian(luma, n, ppm, bins);
  const Eb = radialMedian(blue, n, ppm, bins);
  // A central shot covers most of the innermost circles, so the median there
  // would be the hole itself. Inside the 10 ring the card is plain black.
  const core = Math.round(4.5 * ppm);
  for (const E of [El, Eb]) {
    const black = percentile(E.subarray(core, Math.round(24 * ppm)), 0.5);
    E.fill(black, 0, core);
  }
  const contrast = Math.max(20, El[Math.round(30 * ppm)] - El[Math.round(23 * ppm)]);
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

export function detectShot(patch) {
  const { n, ppm } = patch;
  const c = (n - 1) / 2;
  const { D, raw } = residualMap(patch);
  const weighted = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = j * n + i;
      if (D[o]) weighted[o] = D[o] * numeralWeight((i - c) / ppm, (j - c) / ppm);
    }
  }
  const Iw = integral(weighted, n);
  const half = Math.round((3.9 * ppm) / 2);
  const reach = 33 * ppm;
  const peak = (avoid) => {
    let best = { v: 0, x: 0, y: 0 };
    for (let j = half; j < n - half; j += 2) {
      for (let i = half; i < n - half; i += 2) {
        if (Math.hypot(i - c, j - c) > reach) continue;
        if (avoid && Math.hypot(i - avoid.x, j - avoid.y) < 7 * ppm) continue;
        const v = boxMean(Iw, n, i, j, half);
        if (v > best.v) best = { v, x: i, y: j };
      }
    }
    return best;
  };
  const p1 = peak(null);
  const p2 = peak(p1);
  const ratio = p1.v / Math.max(p2.v, 1e-4);
  if (p1.v < 0.08 || ratio < 1.6) return null;

  // Outline the hole and settle on its centroid (mean shift over a gauge-sized disc).
  const Ir = integral(raw, n);
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
    if (!area) return null;
    hx = sx / area;
    hy = sy / area;
  }
  const eqDia = (2 * Math.sqrt(area / Math.PI)) / ppm;
  const sure = p1.v >= 0.2 && ratio >= 3 && eqDia > 3.5 && eqDia < 7.5;
  return {
    x: (hx - c) / ppm,
    y: -(hy - c) / ppm,
    confidence: sure ? 'high' : 'low',
    strength: p1.v,
    ratio,
    eqDia,
  };
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

export async function scanCard(src, { onProgress = () => {}, debug = false } = {}) {
  onProgress('Reading photo');
  await tick();
  const img = await decodeImage(src);
  onProgress('Finding the aiming marks');
  await tick();
  const marks = assignMarks(findMarks(img));
  const meanR = marks.reduce((s, m) => s + m.r, 0) / 10;
  const register = (ordered) => {
    let H = homography(CARD.diagrams, ordered);
    const rms = Math.sqrt(
      CARD.diagrams.reduce((s, d, i) => {
        const p = applyH(H, d.x, d.y);
        return s + (p.x - ordered[i].x) ** 2 + (p.y - ordered[i].y) ** 2;
      }, 0) / 10
    );
    if (rms > 0.25 * meanR) {
      throw new ScanError(
        'The aiming marks do not match the 2510BM card layout. Make sure the whole card is in the photo.'
      );
    }
    // Tighten the homography using the fitted centre of each aiming mark.
    for (let pass = 0; pass < 2; pass++) {
      const pts = CARD.diagrams.map((d, i) => {
        const fit = fitMark(extractPatch(img, H, d.x, d.y, 64, 6));
        return fit ? applyH(H, d.x + fit.ox, d.y + fit.oy) : ordered[i];
      });
      H = homography(CARD.diagrams, pts);
    }
    return H;
  };
  onProgress('Squaring up the card');
  await tick();
  let H = register(marks);
  // The layout looks the same upside down. The pattern text is printed at the
  // right-hand end of the card, so more print on the left means it is inverted.
  const right = printEnergy(img, H, 1);
  const left = printEnergy(img, H, -1);
  const flipped = left > 1.3 * right;
  if (flipped) H = register([...marks].reverse());

  const diagrams = [];
  for (const d of CARD.diagrams) {
    onProgress(`Scoring diagram ${d.n} of 10`);
    await tick();
    const fit = fitMark(extractPatch(img, H, d.x, d.y, 64, 6));
    const scale = fit ? fit.r / MARK_R : 1;
    const patch = extractPatch(
      img, H, d.x + (fit ? fit.ox : 0), d.y + (fit ? fit.oy : 0), PATCH_MM, PATCH_PPM, scale, true
    );
    const found = detectShot(patch);
    diagrams.push({
      n: d.n,
      image: patchToDataUrl(patch, 608),
      aligned: !!fit,
      shot: found
        ? { x: round2(found.x), y: round2(found.y), source: 'auto', confidence: found.confidence }
        : null,
      ...(debug ? { patch, found, fit } : {}),
    });
  }
  return { diagrams, flipped, pixelsPerMm: meanR / MARK_R, size: { w: img.w, h: img.h } };
}

const round2 = (v) => Math.round(v * 100) / 100;
