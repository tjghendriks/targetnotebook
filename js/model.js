// Card geometry, scoring and group statistics for the NSRA 2510 B.M./89-18 card.
// All dimensions are millimetres. Card coordinates: origin at the card centre,
// x to the right, y down. Shot coordinates: origin at the diagram centre,
// x to the right, y UP (so a positive y is a high shot).

const COLS = [-127.5, -42.5, 42.5, 127.5];
const ROW = 73.3;

export const CARD = {
  id: '2510BM/89-18',
  name: 'NSRA British Match 1989, 25 yards, 10 bull',
  distanceMm: 25 * 914.4,
  width: 352,
  height: 232,
  trim: { width: 312, height: 208 },
  aimingMarkDia: 51.4,
  // Scoring ring diameters, to the outer edge of the printed line (checked
  // against the blank card). A shot scores a ring's value when it gauges inside
  // it; anything outside the 6 ring scores 0.
  rings: [
    { score: 10, dia: 12.92 },
    { score: 9, dia: 20.23 },
    { score: 8, dia: 27.55 },
    { score: 7, dia: 34.86 },
    { score: 6, dia: 42.18 },
  ],
  // Printed numerals (value, radius of the band they sit in).
  numerals: [
    { text: '8', r: 11.95 },
    { text: '6', r: 19.26 },
  ],
  // Diagrams numbered left to right, top to bottom.
  diagrams: [
    ...COLS.map((x, i) => ({ n: i + 1, x, y: -ROW })),
    { n: 5, x: -85, y: 0 },
    { n: 6, x: 85, y: 0 },
    ...COLS.map((x, i) => ({ n: i + 7, x, y: ROW })),
  ],
};

// Firing orders, as diagram indices (0-9, reading order: four across the top,
// two in the middle, four along the bottom) in the sequence they are shot.
export const ORDER_METHODS = {
  clockwise: { label: 'Clockwise loop', order: [0, 1, 2, 3, 5, 9, 8, 7, 6, 4] },
  z: { label: 'Z method', order: [0, 1, 4, 6, 7, 8, 9, 5, 2, 3] },
  rows: { label: 'Rows', order: [0, 1, 2, 3, 5, 4, 6, 7, 8, 9] },
};
const MIRROR = [3, 2, 1, 0, 5, 4, 9, 8, 7, 6];

export const isOrder = (a) =>
  Array.isArray(a) && a.length === 10 && [...a].sort((x, y) => x - y).every((v, i) => v === i);

// spec: { method: 'clockwise' | 'z' | 'rows' | 'custom', mirror, custom }
export function resolveOrder(spec) {
  if (spec?.method === 'custom' && isOrder(spec.custom)) return [...spec.custom];
  const base = (ORDER_METHODS[spec?.method] ?? ORDER_METHODS.clockwise).order;
  return spec?.mirror ? base.map((p) => MIRROR[p]) : [...base];
}

// A card keeps the order it was scanned with; older cards follow the default.
export const cardOrder = (card, settings) => resolveOrder(card.orderSpec ?? settings.shotOrder);

export const DEFAULT_SETTINGS = {
  gauging: 'outward', // 'outward' | 'inward'
  gaugeDia: 5.6,
  clickMoa: 1 / 6,
  shotOrder: { method: 'clockwise', mirror: false, custom: null },
};

// One minute of angle at 25 yards, in mm.
export const MOA_MM = CARD.distanceMm * Math.tan(Math.PI / 180 / 60);

const EPS = 1e-6;

export function scoreShot(x, y, settings = DEFAULT_SETTINGS) {
  const d = Math.hypot(x, y);
  const g = settings.gaugeDia / 2;
  // Outward gauging: the whole gauge must lie on or inside the ring.
  // Inward gauging: the gauge need only touch the ring.
  const reach = settings.gauging === 'inward' ? d - g : d + g;
  for (const ring of CARD.rings) {
    if (reach <= ring.dia / 2 + EPS) return ring.score;
  }
  return 0;
}

export function cardShots(card) {
  return card.shots.filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.y));
}

export function cardTotal(card, settings) {
  return cardShots(card).reduce((t, s) => t + scoreShot(s.x, s.y, settings), 0);
}

export function groupStats(shots) {
  const n = shots.length;
  if (!n) return null;
  let mx = 0;
  let my = 0;
  for (const s of shots) {
    mx += s.x;
    my += s.y;
  }
  mx /= n;
  my /= n;
  let vx = 0;
  let vy = 0;
  let meanRadius = 0;
  for (const s of shots) {
    vx += (s.x - mx) ** 2;
    vy += (s.y - my) ** 2;
    meanRadius += Math.hypot(s.x - mx, s.y - my);
  }
  meanRadius /= n;
  let extreme = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(shots[i].x - shots[j].x, shots[i].y - shots[j].y);
      if (d > extreme) extreme = d;
    }
  }
  return {
    n,
    mx,
    my,
    sdx: n > 1 ? Math.sqrt(vx / (n - 1)) : 0,
    sdy: n > 1 ? Math.sqrt(vy / (n - 1)) : 0,
    meanRadius,
    extreme, // centre to centre
  };
}

// Clicks needed to move the mean point of impact onto the centre.
export function sightCorrection(stats, settings = DEFAULT_SETTINGS) {
  if (!stats) return null;
  const clickMm = settings.clickMoa * MOA_MM;
  const axis = (offset, pos, neg) => {
    const clicks = Math.round(Math.abs(offset) / clickMm);
    return { clicks, dir: clicks === 0 ? null : offset > 0 ? neg : pos, mm: -offset };
  };
  return {
    clickMm,
    horizontal: axis(stats.mx, 'right', 'left'),
    vertical: axis(stats.my, 'up', 'down'),
  };
}
