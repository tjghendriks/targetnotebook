// Card geometry, scoring and group statistics for the supported NSRA 25 yard cards.
// All dimensions are millimetres. Card coordinates: origin at the card centre,
// x to the right, y down. Shot coordinates: origin at the diagram centre,
// x to the right, y UP (so a positive y is a high shot).
//
// A saved card holds one entry per shot in `shots`, grouped by diagram:
// shots for diagram d are at d * shotsPerDiagram ... + shotsPerDiagram - 1.

const CROSS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const SIDES = [[-1, 0], [1, 0]];
const COLS = [-127.5, -42.5, 42.5, 127.5];
const ROW = 73.3;

export const CARDS = {
  '2510BM': {
    id: '2510BM',
    label: '2510BM/89-18',
    name: 'British Match 1989, 10 bull',
    width: 352,
    height: 232,
    trim: { width: 312, height: 208 },
    aimingMarkDia: 51.4,
    centreDot: true,
    // Scoring ring diameters, to the outer edge of the printed line (checked
    // against the blank card). The edge of the black is the 5 ring: a shot
    // outside the 6 ring but wholly on the black scores 5.
    rings: [
      { score: 10, dia: 12.92 },
      { score: 9, dia: 20.23 },
      { score: 8, dia: 27.55 },
      { score: 7, dia: 34.86 },
      { score: 6, dia: 42.18 },
      { score: 5, dia: 51.4 },
    ],
    // A shot that breaks the edge of the black, partly on it and partly off,
    // scores 4. One wholly off the black scores 0.
    fringe: { score: 4, dia: 51.4 },
    // Outward: the whole gauge must lie on or inside the ring.
    gauging: 'outward',
    shotsPerDiagram: 1,
    // Printed numerals: radius of the band they sit in and where around it.
    numerals: [
      { text: '8', r: 11.95, at: CROSS },
      { text: '6', r: 19.26, at: CROSS },
    ],
    // Diagrams in reading order, as rows of 4, 2 and 4.
    rows: [4, 2, 4],
    diagrams: [
      ...COLS.map((x) => ({ x, y: -ROW })),
      { x: -85, y: 0 },
      { x: 85, y: 0 },
      ...COLS.map((x) => ({ x, y: ROW })),
    ],
    // The layout looks the same upside down; the print at the right-hand end tells which way up it is.
    symmetric: true,
    patchMm: 76,
    searchR: 35,
    // Firing orders, as diagram indices in the sequence they are shot.
    orders: {
      clockwise: { label: 'Clockwise loop', order: [0, 1, 2, 3, 5, 9, 8, 7, 6, 4] },
      z: { label: 'Z method', order: [0, 1, 4, 6, 7, 8, 9, 5, 2, 3] },
      rows: { label: 'Rows', order: [0, 1, 2, 3, 5, 4, 6, 7, 8, 9] },
    },
    mirror: [3, 2, 1, 0, 5, 4, 9, 8, 7, 6],
  },
  '2505CS': {
    id: '2505CS',
    label: '2505CS-18',
    name: 'Cadets and Schools 1971, 5 bull',
    width: 308,
    height: 202,
    trim: null,
    // The black is 1.84 in (46.8 mm) at 25 yards and is the 7 ring. The other
    // rings were measured off a photo of a blank card relative to the black,
    // and fit an even 12.6 mm step in diameter to within 0.3 mm.
    aimingMarkDia: 46.8,
    rings: [
      { score: 10, dia: 9.0 },
      { score: 9, dia: 21.6 },
      { score: 8, dia: 34.2 },
      { score: 7, dia: 46.8 },
      { score: 6, dia: 59.4 },
      { score: 5, dia: 72.0 },
    ],
    // Inward: the gauge need only touch the ring.
    gauging: 'inward',
    shotsPerDiagram: 2,
    numerals: [
      { text: '9', r: 7.4, at: SIDES },
      { text: '7', r: 20.2, at: SIDES },
      { text: '5', r: 32.9, at: SIDES },
    ],
    rows: [3, 2],
    diagrams: [
      { x: -98.5, y: -41.4 },
      { x: 0, y: -41.4 },
      { x: 98.5, y: -41.4 },
      { x: -50.5, y: 36.6 },
      { x: 50.5, y: 36.6 },
    ],
    symmetric: false,
    patchMm: 84,
    searchR: 40,
    orders: {
      clockwise: { label: 'Clockwise', order: [0, 1, 2, 4, 3] },
      rows: { label: 'Rows', order: [0, 1, 2, 3, 4] },
    },
    mirror: [2, 1, 0, 4, 3],
  },
};

export const DEFAULT_TYPE = '2510BM';
// Cards saved before other card types existed carry no type.
export const cardType = (rec) => CARDS[rec?.type] ?? CARDS[DEFAULT_TYPE];

export const DISTANCE_MM = 25 * 914.4;
// One minute of angle at 25 yards, in mm.
export const MOA_MM = DISTANCE_MM * Math.tan(Math.PI / 180 / 60);

export const isOrder = (a, n) =>
  Array.isArray(a) && a.length === n && [...a].sort((x, y) => x - y).every((v, i) => v === i);

// spec: { method: <key of card.orders> | 'custom', mirror, custom }
export function resolveOrder(card, spec) {
  if (spec?.method === 'custom' && isOrder(spec.custom, card.diagrams.length)) return [...spec.custom];
  const base = (card.orders[spec?.method] ?? card.orders.clockwise).order;
  return spec?.mirror ? base.map((p) => card.mirror[p]) : [...base];
}

export const DEFAULT_SETTINGS = {
  // 'right' or 'left'. Settings saved before this existed have none, and read as right.
  handedness: 'right',
  gaugeDia: 5.6,
  clickMoa: 1 / 6,
  // Default firing order: shotOrder for the 2510BM, shotOrders[type] for other cards.
  shotOrder: { method: 'clockwise', mirror: false, custom: null },
  shotOrders: {},
};

export const defaultOrderSpec = (settings, card) =>
  (card.id === DEFAULT_TYPE ? settings.shotOrder : settings.shotOrders?.[card.id]) ??
  { method: 'clockwise', mirror: false, custom: null };

// A card keeps the order it was scanned with; older cards follow the default.
export const cardOrder = (rec, settings) => {
  const card = cardType(rec);
  return resolveOrder(card, rec.orderSpec ?? defaultOrderSpec(settings, card));
};

const EPS = 1e-6;

export function scoreShot(x, y, card, settings = DEFAULT_SETTINGS) {
  const d = Math.hypot(x, y);
  const g = settings.gaugeDia / 2;
  const reach = card.gauging === 'inward' ? d - g : d + g;
  for (const ring of card.rings) {
    if (reach <= ring.dia / 2 + EPS) return ring.score;
  }
  // Beyond the rings, a shot still touching the fringe circle scores its value.
  if (card.fringe && d - g <= card.fringe.dia / 2 + EPS) return card.fringe.score;
  return 0;
}

// Every value a shot on this card can score, highest first, ending with 0.
export const shotValues = (card) => [...card.rings.map((r) => r.score), ...(card.fringe ? [card.fringe.score] : []), 0];

// Each entry in a card's `shots` is one of: a placed shot { x, y, ... }, a
// confirmed miss { miss: true } (no hole on the diagram, scores 0), or null
// (not yet accounted for: undetected and not confirmed either way).
export const isShot = (s) => !!s && Number.isFinite(s.x) && Number.isFinite(s.y);
export const isMiss = (s) => !!s?.miss;
export const cardShots = (rec) => rec.shots.filter(isShot);
export const shotValue = (s, card, settings) => (isShot(s) ? scoreShot(s.x, s.y, card, settings) : 0);
// Shots still to be placed or confirmed as misses. A card has no total until this is 0.
export const unaccounted = (rec) => rec.shots.filter((s) => !isShot(s) && !isMiss(s)).length;

export function cardTotal(rec, settings) {
  const card = cardType(rec);
  return rec.shots.reduce((t, s) => t + shotValue(s, card, settings), 0);
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
