// Card geometry, scoring and group statistics for the supported NSRA 25 yard cards.
// All dimensions are millimetres. Card coordinates: origin at the card centre,
// x to the right, y down. Shot coordinates: origin at the diagram centre,
// x to the right, y UP (so a positive y is a high shot).
//
// A saved card holds one entry per shot in `shots`, grouped by diagram:
// shots for diagram d are at d * shotsPerDiagram ... + shotsPerDiagram - 1.
// A Skirmisher card is different: any number of shots, each placed shot
// carrying `on`, the box it is in (see the card's `kind`).

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
  // Eight oval figures, one in each box of a 4 by 2 grid. Any number of shots;
  // each hit on an oval scores one, under the limits in skirmisherTally.
  // Ovals per NSRA appendix A: 1.05 in high, 0.7 in wide. Box and card sizes
  // were measured off photos of real cards against the ovals.
  SKM: {
    id: 'SKM',
    label: 'Skirmisher',
    name: 'NSRA Skirmisher',
    kind: 'skirmisher',
    width: 344,
    height: 236,
    trim: null,
    frame: { width: 312, height: 206 },
    box: { width: 78, height: 103 },
    oval: { width: 17.78, height: 26.67 },
    // Height of the oval, for anything that wants one size for the aiming mark.
    aimingMarkDia: 26.67,
    rings: [],
    numerals: [],
    gauging: 'inward',
    // Not fixed: shots are counted per box as they fall.
    shotsPerDiagram: null,
    rows: [4, 4],
    diagrams: [-51.5, 51.5].flatMap((y) => [-117, -39, 39, 117].map((x) => ({ x, y }))),
    symmetric: true,
    // Which way up: the title is printed along the top of the top-right box
    // and the copyright line along the bottom of the right half. On an
    // upside-down card both turn up where these strips are empty.
    print: {
      upright: [[90, 145, -100, -92], [10, 60, 92, 100]],
      inverted: [[-145, -90, 92, 100], [-60, -10, -100, -92]],
    },
    // Printed matter inside the boxes ([x0, x1, y0, y1], card mm, y down): the
    // logo, title, "25 YARDS" and copyright line. Not searched for holes.
    printed: [[-156, -136, -102, -84], [84, 154, -102, -93], [-156, -128, 91, 102], [-4, 156, 91, 102]],
    // Square photo kept per box, big enough to show all of it.
    patchMm: 106,
    // No firing order: shots go on any oval in any order.
    orders: null,
  },
};

export const isSkirmisher = (card) => card?.kind === 'skirmisher';

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
  // A card with no firing order (Skirmisher) is taken in reading order.
  if (!card.orders) return card.diagrams.map((_, i) => i);
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

// Signed distance (mm) from a point to the edge of an ellipse with semi-axes
// a (across) and b (up) centred on the origin: positive outside, negative inside.
export function ellipseDistance(px, py, a, b) {
  const x = Math.abs(px);
  const y = Math.abs(py);
  // Nearest point on the edge, found by iterating on its direction.
  let tx = Math.SQRT1_2;
  let ty = Math.SQRT1_2;
  for (let i = 0; i < 6; i++) {
    const ex = ((a * a - b * b) * tx ** 3) / a;
    const ey = ((b * b - a * a) * ty ** 3) / b;
    const r = Math.hypot(a * tx - ex, b * ty - ey);
    const q = Math.hypot(x - ex, y - ey) || 1e-9;
    tx = Math.min(1, Math.max(0, ((x - ex) * r) / q / a + ex / a));
    ty = Math.min(1, Math.max(0, ((y - ey) * r) / q / b + ey / b));
    const t = Math.hypot(tx, ty);
    tx /= t;
    ty /= t;
  }
  const d = Math.hypot(x - a * tx, y - b * ty);
  return (x / a) ** 2 + (y / b) ** 2 < 1 ? -d : d;
}

// Skirmisher: how far a shot's gauge is from touching the oval (mm); 0 or
// less is a hit, since inward gauging needs only a touch.
const ovalGap = (x, y, card, settings) =>
  ellipseDistance(x, y, card.oval.width / 2, card.oval.height / 2) - settings.gaugeDia / 2;

export function scoreShot(x, y, card, settings = DEFAULT_SETTINGS) {
  if (isSkirmisher(card)) return ovalGap(x, y, card, settings) <= EPS ? 1 : 0;
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
export const shotValues = (card) => isSkirmisher(card) ? [1, 0] : [...card.rings.map((r) => r.score), ...(card.fringe ? [card.fringe.score] : []), 0];

// Each entry in a card's `shots` is one of: a placed shot { x, y, ... }, a
// confirmed miss { miss: true } (no hole on the diagram, scores 0), or null
// (not yet accounted for: undetected and not confirmed either way).
// How far (mm) a shot's centre is from the nearest point at which its score
// would change. Below a few tenths of a millimetre a photo cannot settle it.
export function scoreMargin(x, y, card, settings = DEFAULT_SETTINGS) {
  if (isSkirmisher(card)) return Math.abs(ovalGap(x, y, card, settings));
  const d = Math.hypot(x, y);
  const g = settings.gaugeDia / 2;
  const reach = card.gauging === 'inward' ? d - g : d + g;
  let margin = Math.min(...card.rings.map((r) => Math.abs(reach - r.dia / 2)));
  if (card.fringe) margin = Math.min(margin, Math.abs(d - g - card.fringe.dia / 2));
  return margin;
}

export const isShot = (s) => !!s && Number.isFinite(s.x) && Number.isFinite(s.y);
export const isMiss = (s) => !!s?.miss;
export const cardShots = (rec) => rec.shots.filter(isShot);
export const shotValue = (s, card, settings) => (isShot(s) ? scoreShot(s.x, s.y, card, settings) : 0);
// Shots still to be placed or confirmed as misses. A card has no total until this is 0.
export const unaccounted = (rec) => rec.shots.filter((s) => !isShot(s) && !isMiss(s)).length;

// Which diagram a shot is on. Normally the one its slot belongs to, but a
// cross-fired shot (more shots on one diagram than it should take, fewer on
// another) is stored in the empty diagram's slot and marked with `on`.
// Cards saved before cross-fire was handled have no `on` anywhere.
export function shotOn(rec, i) {
  const card = cardType(rec);
  const on = rec.shots[i]?.on;
  if (Number.isInteger(on) && on >= 0 && on < card.diagrams.length) return on;
  return isSkirmisher(card) ? -1 : Math.floor(i / card.shotsPerDiagram);
}
export const slotsOn = (rec, d) => rec.shots.map((_, i) => i).filter((i) => shotOn(rec, i) === d);

// NSRA: with no more shots on the card than specified, every shot is scored
// but each one over the number a diagram should take costs a point.
export function crossFirePenalty(rec) {
  const card = cardType(rec);
  // Skirmisher (rule 5.3.4.2): cross-shots are recorded as misses, with no penalty.
  if (isSkirmisher(card)) return 0;
  return card.diagrams.reduce((t, _, d) =>
    t + Math.max(0, slotsOn(rec, d).filter((i) => isShot(rec.shots[i])).length - card.shotsPerDiagram), 0);
}

// Skirmisher scoring, rule 5.3.4.2. Each hit on an oval scores one, but no
// oval is credited with more hits than one more than the fewest attempts
// made in any box, and never fewer than two: so two hits per oval until every
// box has had two attempts, then three until every box has had three, and so
// on. An attempt is any shot in the box, hit or not. A card cannot show the
// order shots were fired, so the limits are applied to the finished card.
export function skirmisherTally(rec, settings) {
  const card = cardType(rec);
  const boxes = card.diagrams.map(() => ({ attempts: 0, hits: 0 }));
  rec.shots.forEach((s, i) => {
    const box = boxes[shotOn(rec, i)];
    if (!isShot(s) || !box) return;
    box.attempts++;
    box.hits += scoreShot(s.x, s.y, card, settings);
  });
  const cap = Math.max(2, Math.min(...boxes.map((b) => b.attempts)) + 1);
  for (const b of boxes) b.credited = Math.min(b.hits, cap);
  const hits = boxes.reduce((t, b) => t + b.hits, 0);
  const total = boxes.reduce((t, b) => t + b.credited, 0);
  return { boxes, cap, hits, total, disallowed: hits - total };
}

export function cardTotal(rec, settings) {
  const card = cardType(rec);
  if (isSkirmisher(card)) return skirmisherTally(rec, settings).total;
  return rec.shots.reduce((t, s) => t + shotValue(s, card, settings), 0) - crossFirePenalty(rec);
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
