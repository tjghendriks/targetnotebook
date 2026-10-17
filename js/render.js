// SVG drawings: the recreated card, a single diagram, the group plot and the score trend.
// Units are mm; SVG y runs down, shot y runs up.

import { scoreShot, isShot, isMiss, slotsOn } from './model.js?v=2026.10.18-8';

const INK = '#1f1b19';
const PAPER = '#e7caa2';
const f = (v) => (Math.round(v * 100) / 100).toString();

// Radius of everything printed for one diagram (rings can lie outside the black).
export const diagramReach = (card) => Math.max(card.aimingMarkDia, ...card.rings.map((r) => r.dia)) / 2;

export function diagramMarkup(card) {
  const markR = card.aimingMarkDia / 2;
  const rings = card.rings
    .filter((r) => Math.abs(r.dia / 2 - markR) > 0.2)
    .map((r) => `<circle r="${f(r.dia / 2 - 0.12)}" fill="none" stroke="${r.dia / 2 < markR ? PAPER : INK}" stroke-width="0.24"/>`)
    .join('');
  const numerals = card.numerals
    .flatMap((n) => n.at.map(([ux, uy]) =>
      `<text x="${f(ux * n.r)}" y="${f(uy * n.r)}" class="numeral" fill="${n.r < markR ? PAPER : INK}">${n.text}</text>`))
    .join('');
  const dot = card.centreDot ? `<circle r="0.35" fill="${PAPER}"/>` : '';
  return `<circle r="${markR}" fill="${INK}"/>${rings}${numerals}${dot}`;
}

const unsure = (shot) => shot.source === 'auto' && shot.confidence !== 'high';

export function shotMarkup(shot, settings, cls = '') {
  return `<circle class="shot ${unsure(shot) ? 'unsure' : ''} ${cls}" cx="${f(shot.x)}" cy="${f(-shot.y)}" r="${f(settings.gaugeDia / 2)}"/>`;
}

// `order` is the firing order of the diagrams; each is labelled with its place in it.
export function cardSvg(rec, card, settings, order) {
  const W = card.width;
  const H = card.height;
  const per = card.shotsPerDiagram;
  const reach = diagramReach(card);
  const diagrams = card.diagrams
    .map((d, i) => {
      // The shots on this diagram, including any cross-fired onto it.
      const shots = slotsOn(rec, i).map((j) => rec.shots[j]);
      const placed = shots.filter(isShot);
      const open = shots.filter((s) => !isShot(s) && !isMiss(s)).length;
      const check = open > 0 || placed.some(unsure);
      // One value per shot: its score, 0 for a confirmed miss, ? if still to be accounted for.
      const label = shots.map((s) => (isShot(s) ? scoreShot(s.x, s.y, card, settings) : isMiss(s) ? 0 : '?')).join(' ');
      return `<g class="dg" data-d="${i}" transform="translate(${d.x} ${d.y})" role="button" aria-label="Diagram ${order.indexOf(i) + 1}">
        <rect x="${-reach - 8}" y="${-reach - 6}" width="${2 * reach + 16}" height="${2 * reach + 12}" fill="transparent"/>
        ${open ? `<circle class="needs" r="${f(reach + 3)}"/>` : ''}
        ${diagramMarkup(card)}
        ${placed.map((s) => shotMarkup(s, settings)).join('')}
        <text class="dnum" x="${f(-reach * 0.92)}" y="${f(-reach * 0.8)}">${order.indexOf(i) + 1}</text>
        <text class="dscore ${check ? 'check' : ''} ${per > 1 ? 'pair' : ''}" x="${f(reach * 0.95)}" y="${f(-reach * 0.76)}">${label}</text>
      </g>`;
    })
    .join('');
  return `<svg class="card-svg" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="${PAPER}"/>
    ${card.trim ? `<rect x="${-card.trim.width / 2}" y="${-card.trim.height / 2}" width="${card.trim.width}" height="${card.trim.height}"
      fill="none" stroke="${INK}" stroke-width="0.3" stroke-dasharray="0.8 0.8"/>` : ''}
    ${diagrams}
  </svg>`;
}

// All shots overlaid on one diagram, with the mean point of impact.
export function groupSvg(card, shots, stats, settings) {
  const reach = Math.max(diagramReach(card) + 4, ...shots.map((s) => Math.hypot(s.x, s.y) + 5));
  const marks = shots.map((s) => shotMarkup({ ...s, source: 'manual' }, settings, 'faint')).join('');
  const mpi = stats
    ? `<circle cx="${f(stats.mx)}" cy="${f(-stats.my)}" r="${f(stats.meanRadius)}" class="mean-ring"/>
       <path class="mpi" d="M${f(stats.mx - 2.5)} ${f(-stats.my)}h5M${f(stats.mx)} ${f(-stats.my - 2.5)}v5"/>`
    : '';
  return `<svg class="group-svg" viewBox="${-reach} ${-reach} ${2 * reach} ${2 * reach}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${-reach}" y="${-reach}" width="${2 * reach}" height="${2 * reach}" fill="${PAPER}"/>
    ${diagramMarkup(card)}${marks}${mpi}
  </svg>`;
}

// The card, in its own colours, with each aiming mark showing when it is
// shot. `order` may be partly filled while a custom order is being tapped in.
export function orderSvg(card, order) {
  const W = card.width;
  const H = card.height;
  const at = (p) => card.diagrams[p];
  const r = card.aimingMarkDia / 2 + 3;
  const path = order.map((p, i) => `${i ? 'L' : 'M'}${at(p).x} ${at(p).y}`).join('');
  const spots = card.diagrams
    .map((d, p) => {
      const k = order.indexOf(p);
      return `<g class="op ${k < 0 ? 'empty' : ''}" data-p="${p}" transform="translate(${d.x} ${d.y})">
        <circle r="${f(r)}"/><text y="1.5">${k < 0 ? '' : k + 1}</text></g>`;
    })
    .join('');
  return `<svg class="order-svg" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="10" fill="${PAPER}"/>
    <path d="${path}" class="order-path"/>${spots}
  </svg>`;
}

// The card with each aiming mark coloured by how many points are dropped
// there: green for the best position through to red for the worst.
// `lost` holds the average points dropped per shot at each diagram, or null
// where there is no data.
export function positionSvg(card, lost) {
  const W = card.width;
  const H = card.height;
  const known = lost.filter((v) => v !== null);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const colour = (v) => {
    if (v === null) return '#9aa3ad';
    const t = hi > lo ? (v - lo) / (hi - lo) : 0;
    return `hsl(${Math.round(125 * (1 - t))} 62% ${Math.round(36 + 6 * Math.sin(Math.PI * t))}%)`;
  };
  const r = card.aimingMarkDia / 2 + 3;
  const marks = card.diagrams
    .map((d, i) => `<g transform="translate(${d.x} ${d.y})">
      <circle r="${f(r)}" fill="${colour(lost[i])}" stroke="${INK}" stroke-width="1.2"/>
      <text class="pos-value" y="1.5">${lost[i] === null ? '–' : lost[i].toFixed(1)}</text></g>`)
    .join('');
  return `<svg class="card-svg" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="${PAPER}"/>${marks}
  </svg>`;
}

// Average score at each step of the firing order. null = no data.
export function shotNumberSvg(values) {
  const W = 320;
  const H = 130;
  const known = values.filter((v) => v !== null);
  const lo = Math.max(0, Math.floor(Math.min(...known) - 1));
  const slot = W / values.length;
  const bars = values
    .map((v, i) => {
      const x = i * slot + 5;
      const h = v === null ? 0 : Math.max(3, ((v - lo) / (10 - lo)) * (H - 40));
      return `${v === null ? '' : `<rect x="${f(x)}" y="${f(H - 20 - h)}" width="${f(slot - 10)}" height="${f(h)}" rx="5" class="bar-fill"/>
        <text x="${f(x + (slot - 10) / 2)}" y="${f(H - 25 - h)}" class="axis" text-anchor="middle">${v.toFixed(1)}</text>`}
        <text x="${f(x + (slot - 10) / 2)}" y="${H - 5}" class="axis" text-anchor="middle">${i + 1}</text>`;
    })
    .join('');
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

// points: [{label, value}] in date order.
export function trendSvg(points) {
  const W = 320;
  const H = 150;
  const pad = { l: 30, r: 10, t: 10, b: 22 };
  const lo = Math.min(90, Math.floor(Math.min(...points.map((p) => p.value)) / 5) * 5);
  const x = (i) => pad.l + (points.length === 1 ? 0.5 : i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + ((100 - v) / (100 - lo)) * (H - pad.t - pad.b);
  const ticks = [];
  for (let v = lo; v <= 100; v += lo >= 80 ? 5 : 10) ticks.push(v);
  const grid = ticks
    .map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${f(y(v))}" y2="${f(y(v))}" class="grid"/>
      <text x="${pad.l - 5}" y="${f(y(v) + 3)}" class="axis" text-anchor="end">${v}</text>`)
    .join('');
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${f(x(i))} ${f(y(p.value))}`).join('');
  const dots = points
    .map((p, i) => `<circle cx="${f(x(i))}" cy="${f(y(p.value))}" r="2.6" class="dot"><title>${p.label}: ${p.value}</title></circle>`)
    .join('');
  const ends = points.length > 1
    ? `<text x="${pad.l}" y="${H - 6}" class="axis">${points[0].label}</text>
       <text x="${W - pad.r}" y="${H - 6}" class="axis" text-anchor="end">${points.at(-1).label}</text>`
    : `<text x="${W / 2}" y="${H - 6}" class="axis" text-anchor="middle">${points[0].label}</text>`;
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${grid}<path d="${line}" class="trend"/>${dots}${ends}
  </svg>`;
}
