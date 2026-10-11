// SVG drawings: the recreated card, a single diagram, the group plot and the score trend.
// Units are mm; SVG y runs down, shot y runs up.

import { CARD, scoreShot } from './model.js';

const INK = '#1f1b19';
const PAPER = '#e7caa2';
const MARK_R = CARD.aimingMarkDia / 2;
const f = (v) => (Math.round(v * 100) / 100).toString();

export function diagramMarkup() {
  const rings = CARD.rings
    .map((r) => `<circle r="${f(r.dia / 2 - 0.12)}" fill="none" stroke="${PAPER}" stroke-width="0.24"/>`)
    .join('');
  const numerals = CARD.numerals
    .flatMap((n) =>
      [[0, -1], [0, 1], [-1, 0], [1, 0]].map(
        ([ux, uy]) => `<text x="${f(ux * n.r)}" y="${f(uy * n.r)}" class="numeral">${n.text}</text>`
      )
    )
    .join('');
  return `<circle r="${MARK_R}" fill="${INK}"/>${rings}${numerals}<circle r="0.35" fill="${PAPER}"/>`;
}

export function shotMarkup(shot, settings, cls = '') {
  const unsure = shot.source === 'auto' && shot.confidence !== 'high';
  return `<circle class="shot ${unsure ? 'unsure' : ''} ${cls}" cx="${f(shot.x)}" cy="${f(-shot.y)}" r="${f(settings.gaugeDia / 2)}"/>`;
}

// `order` is the firing order; each diagram is labelled with its shot number.
export function cardSvg(card, settings, order) {
  const W = CARD.width;
  const H = CARD.height;
  const diagrams = CARD.diagrams
    .map((d, i) => {
      const shot = card.shots[i];
      const score = shot ? scoreShot(shot.x, shot.y, settings) : null;
      const unsure = shot && shot.source === 'auto' && shot.confidence !== 'high';
      return `<g class="dg" data-n="${d.n}" transform="translate(${d.x} ${d.y})" role="button" aria-label="Diagram ${d.n}">
        <rect x="-36" y="-34" width="72" height="68" fill="transparent"/>
        ${diagramMarkup()}
        ${shot ? shotMarkup(shot, settings) : ''}
        <text class="dnum" x="-27" y="-22">${order.indexOf(i) + 1}</text>
        <text class="dscore ${!shot || unsure ? 'check' : ''}" x="27" y="-19">${shot ? score : '?'}</text>
      </g>`;
    })
    .join('');
  return `<svg class="card-svg" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="${PAPER}"/>
    <rect x="${-CARD.trim.width / 2}" y="${-CARD.trim.height / 2}" width="${CARD.trim.width}" height="${CARD.trim.height}"
      fill="none" stroke="${INK}" stroke-width="0.3" stroke-dasharray="0.8 0.8"/>
    ${diagrams}
  </svg>`;
}

// All shots overlaid on one diagram, with the mean point of impact.
export function groupSvg(shots, stats, settings) {
  const reach = Math.max(30, ...shots.map((s) => Math.hypot(s.x, s.y) + 5));
  const marks = shots.map((s) => shotMarkup({ ...s, source: 'manual' }, settings, 'faint')).join('');
  const mpi = stats
    ? `<circle cx="${f(stats.mx)}" cy="${f(-stats.my)}" r="${f(stats.meanRadius)}" class="mean-ring"/>
       <path class="mpi" d="M${f(stats.mx - 2.5)} ${f(-stats.my)}h5M${f(stats.mx)} ${f(-stats.my - 2.5)}v5"/>`
    : '';
  return `<svg class="group-svg" viewBox="${-reach} ${-reach} ${2 * reach} ${2 * reach}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${-reach}" y="${-reach}" width="${2 * reach}" height="${2 * reach}" fill="${PAPER}"/>
    ${diagramMarkup()}${marks}${mpi}
  </svg>`;
}

// The card layout with each diagram showing when it is shot. `order` may be
// partly filled while a custom order is being tapped in.
export function orderSvg(order) {
  const W = CARD.width;
  const H = CARD.height;
  const at = (p) => CARD.diagrams[p];
  const path = order.map((p, i) => `${i ? 'L' : 'M'}${at(p).x} ${at(p).y}`).join('');
  const spots = CARD.diagrams
    .map((d, p) => {
      const k = order.indexOf(p);
      return `<g class="op ${k < 0 ? 'empty' : ''}" data-p="${p}" transform="translate(${d.x} ${d.y})">
        <circle r="27"/><text y="1">${k < 0 ? '' : k + 1}</text></g>`;
    })
    .join('');
  return `<svg class="order-svg" viewBox="${-W / 2} ${-H / 2} ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="14" class="order-bg"/>
    <path d="${path}" class="order-path"/>${spots}
  </svg>`;
}

// Average score for each shot number (1st shot fired, 2nd, ...). null = no data.
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
