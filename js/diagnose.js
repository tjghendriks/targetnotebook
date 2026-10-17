// Technique hints from the pattern of a group, after the rifle "Rapid
// Diagnosis Chart" (Fig. 12a): shots thrown in a particular direction from
// the rest of the group point to particular faults. The chart is drawn for a
// right-handed shooter; for a left-handed one it is read mirrored.
//
// Where the group as a whole sits is a matter for the sights, not technique,
// so everything here is measured from the group's own centre.

import { groupStats } from './model.js?v=2026.10.18-4';

// Each fault covers a span of the clock face, in degrees clockwise from 12,
// as drawn by the arrows on the chart. Neighbouring spans overlap, as they do
// on the chart, so a shot near a boundary counts towards both.
// `way` and `cause` are written for a right-handed shooter; {left} and
// {right} are swapped for a left-handed one, along with the chart itself.
export const FAULTS = [
  { key: 'F', from: 330, to: 40, way: 'high',
    cause: 'you are lifting the fore-end up into the aiming mark with your forward hand, rather than letting your natural position bring the sights on to it' },
  { key: 'B', from: 25, to: 105, way: 'to the {right}',
    cause: 'you are pressing the rifle over to the {right} to hold the sights on, or canting it to the {left}. Check that your position points naturally at the target and that the rifle is upright' },
  { key: 'C', from: 100, to: 160, way: 'low and to the {right}',
    cause: 'you are pulling the trigger rather than squeezing it, or pulling back steadily with your hand as the shot goes' },
  { key: 'G', from: 145, to: 215, way: 'low',
    cause: 'you are forcing the rifle down to the aiming mark rather than aligning your body correctly' },
  { key: 'D', from: 200, to: 250, way: 'low and to the {left}',
    cause: 'you are forcing your shoulder on to the butt, rather than letting the butt settle naturally into your shoulder' },
  { key: 'E', from: 240, to: 310, way: 'to the {left}',
    cause: 'you are pressing the rifle over to the {left} to hold the sights on, rather than moving your position so the rifle points naturally at the target' },
  { key: 'A', from: 290, to: 345, way: 'high and to the {left}',
    cause: 'the fore-end is resting towards the top of your palm, or you are canting the rifle to the {right}' },
];

// Fill in {left} and {right} for the shooter's hand.
export const sided = (text, leftHanded) =>
  text.replace(/\{(left|right)\}/g, (_, side) => (leftHanded ? (side === 'left' ? 'right' : 'left') : side));

// Clock angle (0 = 12 o'clock, 90 = 3 o'clock) of a direction (x right, y up),
// as read on a right-handed chart.
function clockAngle(dx, dy, leftHanded) {
  const a = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return leftHanded ? (360 - a) % 360 : a;
}

const inSpan = (a, f) => (f.from < f.to ? a >= f.from && a < f.to : a >= f.from || a < f.to);
// Every fault whose span includes this direction (two where spans overlap).
export const faultsAt = (angle) => FAULTS.filter((f) => inSpan(angle, f));

// Shots more than this many mean radii from the group centre count as thrown.
const WIDE = 1.5;
// A direction is worth mentioning when at least this many wide shots, and
// this share of them, went that way.
const SIGNIFICANT = { shots: 2, share: 0.2 };
// A group this many times longer than it is wide counts as strung out.
const STRUNG = 1.6;

export function diagnose(shots, { leftHanded = false } = {}) {
  const stats = groupStats(shots);
  if (!stats || shots.length < 10) return { enough: false, shots: shots.length };

  // Shots thrown away from the group, by direction.
  const offsets = shots.map((s) => ({ dx: s.x - stats.mx, dy: s.y - stats.my }));
  const isWide = (d) => Math.hypot(d.dx, d.dy) > WIDE * stats.meanRadius;
  const wide = offsets.filter(isWide);
  const tally = new Map(FAULTS.map((f) => [f.key, 0]));
  const dirs = new Map(FAULTS.map((f) => [f.key, { x: 0, y: 0 }]));
  for (const d of wide) {
    const len = Math.hypot(d.dx, d.dy);
    for (const f of faultsAt(clockAngle(d.dx, d.dy, leftHanded))) {
      tally.set(f.key, tally.get(f.key) + 1);
      dirs.get(f.key).x += d.dx / len;
      dirs.get(f.key).y += d.dy / len;
    }
  }
  const thrown = FAULTS
    .map((f) => ({
      ...f,
      count: tally.get(f.key),
      share: wide.length ? tally.get(f.key) / wide.length : 0,
      // Where those shots actually went on the card, as a clock angle.
      angle: clockAngle(dirs.get(f.key).x, dirs.get(f.key).y, false),
    }))
    .filter((f) => f.count >= SIGNIFICANT.shots && f.share >= SIGNIFICANT.share)
    .sort((a, b) => b.count - a.count);

  // The body of the group (thrown shots left out, as they are dealt with
  // above) strung out along one line points to the faults at both ends of it.
  const core = offsets.filter((d) => !isWide(d));
  const cx = core.reduce((t, d) => t + d.dx, 0) / core.length;
  const cy = core.reduce((t, d) => t + d.dy, 0) / core.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const d of core) {
    sxx += (d.dx - cx) ** 2;
    sxy += (d.dx - cx) * (d.dy - cy);
    syy += (d.dy - cy) ** 2;
  }
  const mean = (sxx + syy) / 2;
  const diff = Math.hypot((sxx - syy) / 2, sxy);
  const ratio = Math.sqrt((mean + diff) / Math.max(mean - diff, 1e-9));
  let strung = null;
  if (ratio >= STRUNG && core.length >= 8) {
    // Direction of the long axis (x right, y up), then both of its ends.
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const ends = [...new Set([...faultsAt(clockAngle(ax, ay, leftHanded)), ...faultsAt(clockAngle(-ax, -ay, leftHanded))])];
    strung = { ratio, ends, angles: [clockAngle(ax, ay, false), clockAngle(-ax, -ay, false)] };
  }

  return { enough: true, shots: shots.length, wide: wide.length, thrown, strung, tally, leftHanded };
}
