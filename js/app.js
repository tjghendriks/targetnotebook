import {
  CARDS, DEFAULT_TYPE, cardType, scoreShot, cardShots, cardTotal, groupStats, sightCorrection, MOA_MM,
  isShot, isMiss, shotValue, shotValues, unaccounted, scoreMargin, shotOn, slotsOn, crossFirePenalty,
  isOrder, resolveOrder, cardOrder, defaultOrderSpec,
} from './model.js?v=2026.10.18-4';
import * as store from './store.js?v=2026.10.18-4';
import { diagnose, sided, FAULTS as FAULT_LIST } from './diagnose.js?v=2026.10.18-4';
import { scanCard, ScanError } from './detect.js?v=2026.10.18-4';
import { cardSvg, groupSvg, trendSvg, orderSvg, shotNumberSvg, positionSvg, faultClockSvg } from './render.js?v=2026.10.18-4';

// Shown in Settings so it is clear which release a device is running. Set with dev/set-version.py.
const VERSION = '2026.10.18-4';

const view = document.getElementById('view');
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mm = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const niceDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
// How close (mm) to a scoring line a detected shot must be to be flagged.
const BORDERLINE_MM = 0.3;
const unsure = (s) => isShot(s) && s.source === 'auto' && s.confidence !== 'high';

let settings;
let current = null; // the card being viewed or edited
let dirty = false;
let note = null; // the training note being written or edited
let noteDirty = false;

// ---------- small UI helpers ----------

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

// The app's own question and message boxes. The browser's built-in confirm()
// and alert() are not used: some browsers and in-app views suppress them, which
// silently answers "no" and leaves buttons that seem to do nothing.
function dialog(message, buttons) {
  return new Promise((resolve) => {
    const el = $('#dialog');
    el.innerHTML = `<div class="dialog-box" role="alertdialog" aria-modal="true">
      <p>${esc(message)}</p>
      <div class="row">${buttons.map((b, i) => `<button data-i="${i}" class="${b.primary ? 'primary' : ''}">${esc(b.label)}</button>`).join('')}</div>
    </div>`;
    el.hidden = false;
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      el.hidden = true;
      el.innerHTML = '';
      resolve(buttons[Number(b.dataset.i)].value);
    }));
    el.querySelector('button.primary')?.focus();
  });
}
const ask = (message, yes, no = 'Cancel') =>
  dialog(message, [{ label: no, value: false }, { label: yes, value: true, primary: true }]);
const tell = (message) => dialog(message, [{ label: 'OK', value: true, primary: true }]);

function busy(text) {
  $('#busy').hidden = text === null;
  if (text !== null) $('#busy-text').textContent = text;
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// Shots in the order fired: [{ slot, diagram, number, shot }]. Where a diagram
// takes two shots, which of the pair came first is not known.
function firingSequence(rec) {
  const per = cardType(rec).shotsPerDiagram;
  return cardOrder(rec, settings).flatMap((d, k) =>
    Array.from({ length: per }, (_, j) => ({
      slot: d * per + j,
      diagram: d,
      number: k * per + j + 1,
      shot: rec.shots[d * per + j],
    }))
  );
}

function csvFor(recs) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  // shot = order fired; diagram = position on the card, reading left to right, top to bottom.
  const rows = ['card_id,card_type,date,name,shot,diagram,x_mm,y_mm,score,placed_by'];
  for (const rec of recs) {
    const card = cardType(rec);
    for (const { shot: s, number, diagram, slot } of firingSequence(rec)) {
      if (isMiss(s)) rows.push([rec.id, card.id, rec.date, q(rec.name), number, diagram + 1, '', '', 0, 'miss'].join(','));
      // A cross-fired shot is listed against the diagram it actually landed on.
      const on = shotOn(rec, slot) + 1;
      if (!isShot(s)) continue;
      rows.push([rec.id, card.id, rec.date, q(rec.name), number, on, s.x.toFixed(2), s.y.toFixed(2), scoreShot(s.x, s.y, card, settings), s.source].join(','));
    }
  }
  return rows.join('\n') + '\n';
}

function statsBlock(card, shots) {
  const st = groupStats(shots);
  if (!st || st.n < 2) return '<p class="muted">At least two shots are needed for group statistics.</p>';
  const corr = sightCorrection(st, settings);
  const part = (a) => (a.clicks ? `${a.clicks} click${a.clicks === 1 ? '' : 's'} ${a.dir}` : null);
  const moves = [part(corr.horizontal), part(corr.vertical)].filter(Boolean);
  return `
    ${groupSvg(card, shots, st, settings)}
    <div class="stats">
      <div class="stat"><b>${st.extreme.toFixed(1)} mm</b><span>Group size (centre to centre)</span></div>
      <div class="stat"><b>${st.meanRadius.toFixed(1)} mm</b><span>Mean radius</span></div>
      <div class="stat"><b>${mm(st.mx)} mm</b><span>Group centre, horizontal (+ right)</span></div>
      <div class="stat"><b>${mm(st.my)} mm</b><span>Group centre, vertical (+ high)</span></div>
      <div class="stat"><b>${st.sdx.toFixed(1)} / ${st.sdy.toFixed(1)}</b><span>Spread SD, horizontal / vertical (mm)</span></div>
      <div class="stat"><b>${st.n}</b><span>Shots</span></div>
    </div>
    <div class="correction">
      <span class="muted">Sight correction to centre this group</span><br>
      <b>${moves.length ? moves.join(', ') : 'None needed'}</b>
      <p class="muted">The group centre is ${Math.abs(st.mx).toFixed(1)} mm ${st.mx >= 0 ? 'right' : 'left'} and ${Math.abs(st.my).toFixed(1)} mm ${st.my >= 0 ? 'high' : 'low'}.
      One click moves the shot ${corr.clickMm.toFixed(2)} mm at 25 yards. Directions say which way the shots need to move.</p>
    </div>`;
}

// Suggested technique faults, from the direction shots were thrown from the group.
function hintsBlock(shots) {
  const leftHanded = settings.handedness === 'left';
  const d = diagnose(shots, { leftHanded });
  if (!d.enough) return `<p class="muted">At least 10 shots are needed to look for a pattern; this selection has ${d.shots}.</p>`;
  // A direction on the card (clock angle) as the nearest hour.
  const hour = (angle) => {
    const h = Math.round(angle / 30) % 12;
    return h === 0 ? 12 : h;
  };
  const say = (text) => esc(sided(text, leftHanded));
  const lines = [];
  if (d.strung) {
    const [ha, hb] = d.strung.angles.map(hour).sort((x, y) => x - y);
    lines.push(`<li><b>Your group is strung out between about ${ha} and ${hb} o'clock</b>, about ${d.strung.ratio.toFixed(1)} times longer than it is wide.
      ${d.strung.ends.map((x) => `<span>Shots ${say(x.way)}: this may indicate that ${say(x.cause)}.</span>`).join('')}</li>`);
  }
  for (const x of d.thrown) {
    lines.push(`<li><b>${x.count} of your ${d.wide} wide shots went ${say(x.way)} (about ${hour(x.angle)} o'clock).</b>
      <span>This may indicate that ${say(x.cause)}.</span></li>`);
  }
  return `
    ${faultClockSvg(FAULT_LIST, d.tally, leftHanded)}
    ${lines.length
      ? `<ul class="hints">${lines.join('')}</ul>`
      : `<p>No direction stands out: the ${d.wide} shot${d.wide === 1 ? '' : 's'} that went wide of the group ${d.wide === 1 ? 'is' : 'are'} not bunched on one side, and the group is not strung out.</p>`}
    <p class="muted">Suggestions only, from the rifle Rapid Diagnosis Chart (Fuller Fig. 12a)${leftHanded ? ', mirrored because Settings says you shoot left-handed' : ''}.
      They look at shots more than 1.5 times the mean radius from the group's centre, and at the group's shape.
      The numbers show how many wide shots went each way; as on the chart, neighbouring areas overlap, so a shot near a boundary counts in both.${d.shots < 30 ? ' With fewer than 30 shots a pattern can easily be chance.' : ''}</p>`;
}

// A firing-order chooser: a picture of the card for each method (tap to
// choose), a mirror option, and tap-to-number for a custom order. Calls
// onChange with a new spec whenever a complete order is chosen.
function mountOrderPicker(el, card, spec, onChange) {
  spec = { method: 'clockwise', mirror: false, custom: null, ...spec };
  const count = card.diagrams.length;
  let taps = null; // partly entered custom order
  const draw = () => {
    const custom = spec.method === 'custom';
    const tile = (key, label, order) => `
      <button class="order-tile ${spec.method === key ? 'on' : ''}" data-method="${key}" aria-pressed="${spec.method === key}">
        ${orderSvg(card, order)}<span>${label}</span>
      </button>`;
    const customOrder = isOrder(spec.custom, count) ? spec.custom : resolveOrder(card, spec);
    el.innerHTML = `
      <div class="order-tiles">
        ${Object.entries(card.orders).map(([key, m]) => tile(key, m.label, resolveOrder(card, { method: key, mirror: spec.mirror }))).join('')}
        ${tile('custom', 'Custom', customOrder)}
      </div>
      ${custom ? `
        <div class="order-entry">
          ${orderSvg(card, taps ?? customOrder)}
          <p class="muted">${taps
            ? `Tap the aiming marks in the order they are shot. ${count - taps.length} to go.`
            : 'Your custom order. To change it, clear it and tap the aiming marks in the order they are shot.'}</p>
          <button data-o="clear">Clear and re-enter</button>
        </div>`
        : `<label class="check"><input type="checkbox" data-o="mirror" ${spec.mirror ? 'checked' : ''}> Mirror image (left-handed)</label>`}`;
    el.querySelectorAll('.order-tile').forEach((b) => b.addEventListener('click', () => {
      const method = b.dataset.method;
      if (method === spec.method) return;
      // Start a custom order from whatever was chosen, so it is valid straight away.
      const seed = method === 'custom' && !isOrder(spec.custom, count) ? resolveOrder(card, spec) : spec.custom;
      spec = { ...spec, method, custom: seed };
      taps = null;
      onChange(spec);
      draw();
    }));
    el.querySelector('[data-o=mirror]')?.addEventListener('change', (e) => {
      spec = { ...spec, mirror: e.target.checked };
      onChange(spec);
      draw();
    });
    el.querySelector('[data-o=clear]')?.addEventListener('click', () => {
      taps = [];
      draw();
    });
    if (taps) {
      el.querySelectorAll('.order-entry .op').forEach((g) => g.addEventListener('click', () => {
        const p = Number(g.dataset.p);
        if (taps.includes(p)) return;
        taps.push(p);
        if (taps.length === count) {
          spec = { ...spec, custom: taps };
          taps = null;
          onChange(spec);
        }
        draw();
      }));
    }
  };
  draw();
}

// ---------- rifle set-up ----------

// Shrinks a photo to a sensible size for keeping on the device.
async function photoDataUrl(file, maxSide = 1400) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

// Short free-text fields, shown together on one line: key, label, longest entry.
const RIFLE_TEXT = [['name', 'Rifle name', 4], ['slingNumber', 'Sling number', 3], ['jacket', 'Jacket', 4]];
// Fields with − and + buttons: key, label, step. They can also be typed into.
const RIFLE_STEPS = [
  ['handstop', 'Handstop position', 0.5],
  ['sling', 'Sling length', 1],
  ['foresight', 'Foresight element (mm)', 0.1],
  ['spacers', 'Spacers', 1],
];
const RIFLE_PHOTOS = [['buttplate', 'Buttplate position'], ['cheekpiece', 'Cheekpiece position'], ['rearsight', 'Rearsight position']];

// The rifle set-up pane: every change is saved straight away.
async function mountRifle(el) {
  const rifle = { name: '', slingNumber: '', jacket: '', handstop: null, sling: null, foresight: null, spacers: 0, ...(await store.getRifle()) };
  rifle.photos = { ...rifle.photos };
  // Anything that is not a number (an old free-text entry, say) shows as empty.
  const has = (key) => rifle[key] !== null && rifle[key] !== '' && Number.isFinite(Number(rifle[key]));
  const shown = (key, step) => (!has(key) ? '' : step < 1 ? Number(rifle[key]).toFixed(1) : String(Number(rifle[key])));
  const save = async () => {
    await store.putRifle({ ...rifle, updatedAt: new Date().toISOString() });
    const note = el.querySelector('.saved');
    if (note) note.textContent = 'Saved';
  };
  const draw = () => {
    el.innerHTML = `
      <div class="text-line">
        ${RIFLE_TEXT.map(([key, label, max]) => `
          <label class="field">${label}<input type="text" maxlength="${max}" data-text="${key}" value="${esc(String(rifle[key] ?? '').slice(0, max))}"></label>`).join('')}
      </div>
      ${RIFLE_STEPS.map(([key, label, step]) => `
        <div class="field">${label}
          <div class="stepper">
            <button data-step="${-step}" data-key="${key}" aria-label="Decrease ${label}">−</button>
            <input type="number" inputmode="${step < 1 ? 'decimal' : 'numeric'}" step="${step}" min="0" data-num="${key}" value="${shown(key, step)}" placeholder="–">
            <button data-step="${step}" data-key="${key}" aria-label="Increase ${label}">+</button>
          </div>
        </div>`).join('')}
      <div class="photos">
        ${RIFLE_PHOTOS.map(([key, label]) => `
          <div class="photo">
            <span>${label}</span>
            ${rifle.photos[key]
              ? `<img src="${rifle.photos[key]}" alt="${label}" data-view="${key}">
                 <div class="row"><label class="btn">Replace<input type="file" accept="image/*" data-photo="${key}" hidden></label>
                 <button data-remove="${key}">Remove</button></div>`
              : `<label class="btn photo-add">Add photo<input type="file" accept="image/*" data-photo="${key}" hidden></label>`}
          </div>`).join('')}
      </div>
      <p class="muted saved">Changes are saved as you make them.</p>`;
    const step = (key) => RIFLE_STEPS.find((r) => r[0] === key)[2];
    const setNumber = (key, value) => {
      if (value === null || Number.isNaN(value)) rifle[key] = null;
      else rifle[key] = step(key) < 1 ? Math.max(0, Math.round(value * 10) / 10) : Math.max(0, Math.round(value));
      el.querySelector(`[data-num=${key}]`).value = shown(key, step(key));
      save();
    };
    el.querySelectorAll('[data-text]').forEach((input) => input.addEventListener('change', () => {
      rifle[input.dataset.text] = input.value.trim();
      save();
    }));
    el.querySelectorAll('[data-num]').forEach((input) => input.addEventListener('change', () =>
      setNumber(input.dataset.num, input.value === '' ? null : Number(input.value))));
    el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () =>
      setNumber(b.dataset.key, (has(b.dataset.key) ? Number(rifle[b.dataset.key]) : 0) + Number(b.dataset.step))));
    el.querySelectorAll('[data-photo]').forEach((input) => input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        rifle.photos[input.dataset.photo] = await photoDataUrl(file);
        await save();
        draw();
      } catch (err) {
        tell(err.message);
      }
    }));
    el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await ask('Remove this photo?', 'Remove'))) return;
      delete rifle.photos[b.dataset.remove];
      await save();
      draw();
    }));
    el.querySelectorAll('[data-view]').forEach((img) => img.addEventListener('click', () => {
      const viewer = $('#editor');
      viewer.innerHTML = `<div class="ed viewer"><div class="ed-head"><div class="ed-info"><small>${esc(img.alt)}</small></div>
        <button id="view-close" class="primary">Done</button></div><img src="${img.src}" alt="${esc(img.alt)}"></div>`;
      viewer.hidden = false;
      $('#view-close').addEventListener('click', () => {
        viewer.hidden = true;
        viewer.innerHTML = '';
      });
    }));
  };
  draw();
}

// ---------- cards list ----------

async function showCards() {
  const recs = await store.listCards();
  const notes = await store.listNotes();
  // Cards and training notes together: newest date first, and within a day
  // the most recently added first, each day under one heading.
  const items = [
    ...recs.map((rec) => ({ rec, date: rec.date, at: rec.createdAt ?? '' })),
    ...notes.map((n) => ({ note: n, date: n.date, at: n.createdAt ?? '' })),
  ].sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
  const byDate = new Map();
  for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  const days = [...byDate];
  const firstLine = (text) => text.trim().split('\n')[0];
  const clock = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };
  view.innerHTML = `
    <div class="add">
      <div class="top-actions">
        <button id="add" aria-expanded="false" aria-controls="add-menu">
          <svg class="add-icon" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="14"/><path d="M14 7.5v13M7.5 14h13"/></svg>
          <span>Add new</span>
        </button>
        <button id="rifle" aria-expanded="false" aria-controls="rifle-pane">
          <svg class="add-icon" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="14"/><circle class="ring" cx="14" cy="14" r="6"/><path d="M14 4.5v5M14 18.5v5M4.5 14h5M18.5 14h5"/></svg>
          <span>My Setup</span>
        </button>
      </div>
      <div id="add-menu" class="menu add-menu" hidden>
        <h4>Card</h4>
        <div class="menu-row">
          <label class="btn menu-btn">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 8.5h3.2l1.6-2.5h7.4l1.6 2.5h3.2v10.5h-17z"/><circle cx="12" cy="13.5" r="3.5"/></svg>
            Take photo<input id="cam" type="file" accept="image/*" capture="environment" hidden></label>
          <label class="btn menu-btn">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4 17.5l5-5 3.5 3.5 2.5-2.5 5 5"/></svg>
            Choose photo<input id="pick" type="file" accept="image/*" hidden></label>
        </div>
        <p class="muted">Lay the card flat on a plain light surface, with every aiming mark in frame and no strong shadows.</p>
        <a class="btn menu-btn" href="#/note/new">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14M5 10h14M5 14.5h14M5 19h8"/></svg>
          Training note</a>
      </div>
      <div id="rifle-pane" class="menu rifle" hidden></div>
    </div>
    <h2>Saved cards and notes</h2>
    ${items.length ? '' : '<p class="muted">Nothing saved yet.</p>'}
    ${days.map(([date, list]) => `
    <h3>${esc(longDate(date))}</h3>
    <ul class="card-list">
      ${list.map(({ rec, note: n }) => {
        if (n) {
          return `<li><a href="#/note/${esc(n.id)}">
            <span class="total note-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14M5 10h14M5 14.5h14M5 19h8"/></svg></span>
            <span class="meta"><b>${esc(firstLine(n.text) || 'Training note')}</b><span class="muted">Training note${clock(n.createdAt) ? ` · ${esc(clock(n.createdAt))}` : ''}</span></span>
            <span class="chev">›</span></a></li>`;
        }
        const open = unaccounted(rec);
        return `<li><a href="#/card/${esc(rec.id)}">
          <span class="total ${open ? 'pending' : ''}">${open ? '?' : cardTotal(rec, settings)}</span>
          <span class="meta">${rec.name ? `<b>${esc(rec.name)}</b>` : ''}<span class="muted">${esc(cardType(rec).label)}${open ? ` · ${open} shot${open === 1 ? '' : 's'} to confirm` : ''}${rec.notes ? ' · has notes' : ''}</span></span>
          <span class="chev">›</span></a></li>`;
      }).join('')}
    </ul>`).join('')}`;
  // The two top buttons each open a pane below; only one is open at a time.
  const panes = { add: $('#add-menu'), rifle: $('#rifle-pane') };
  const show = (which) => {
    for (const [key, pane] of Object.entries(panes)) {
      pane.hidden = key !== which;
      $(`#${key}`).setAttribute('aria-expanded', String(key === which));
    }
  };
  const toggle = (open) => show(open ? 'add' : null);
  $('#add').addEventListener('click', () => show(panes.add.hidden ? 'add' : null));
  $('#rifle').addEventListener('click', () => show(panes.rifle.hidden ? 'rifle' : null));
  mountRifle(panes.rifle);
  for (const id of ['cam', 'pick']) {
    $(`#${id}`).addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      toggle(false);
      if (file) scan(file);
    });
  }
}

async function scan(file) {
  busy('Reading photo');
  try {
    const result = await scanCard(file, { onProgress: busy });
    const card = CARDS[result.type];
    current = {
      id: store.newId(),
      isNew: true,
      type: card.id,
      date: today(),
      name: '',
      createdAt: new Date().toISOString(),
      // A shot within a fraction of a millimetre of a scoring line is flagged
      // for a closer look, however sure the detector was of the hole.
      shots: result.diagrams.flatMap((d) => d.shots).map((s) =>
        s && scoreMargin(s.x, s.y, card, settings) < BORDERLINE_MM ? { ...s, confidence: 'low', borderline: true } : s),
      images: result.diagrams.map((d) => d.image),
      orderSpec: structuredClone(defaultOrderSpec(settings, card)),
      // Diagrams with more holes than could be placed (shown on the new scan only, not saved).
      crowded: [],
    };
    // Cross-fire: holes beyond what a diagram takes go into the slots of a
    // diagram where nothing at all was found, marked as being on the crowded one.
    const per = card.shotsPerDiagram;
    const empty = card.diagrams.map((_, d) => d)
      .filter((d) => current.shots.slice(d * per, d * per + per).every((s) => !s))
      .flatMap((d) => Array.from({ length: per }, (_, j) => d * per + j));
    result.diagrams.forEach((d, i) => {
      for (const extra of d.extras ?? []) {
        const free = empty.shift();
        if (free === undefined) {
          if (!current.crowded.includes(i)) current.crowded.push(i);
          continue;
        }
        current.shots[free] = { ...extra, on: i };
      }
    });
    dirty = true;
    busy(null);
    if (location.hash === '#/card/new') showCard('new');
    else location.hash = '#/card/new';
  } catch (err) {
    busy(null);
    console.error(err);
    tell(err instanceof ScanError ? err.message : `Sorry, that photo could not be processed. (${err.message})`);
  }
}

// ---------- one card ----------

async function showCard(id) {
  if (id === 'new') {
    if (!current?.isNew) return void (location.hash = '#/');
  } else if (current?.id !== id || current.isNew) {
    current = await store.getCard(id);
    dirty = false;
    if (!current) return void (location.hash = '#/');
  }
  renderCard();
}

function renderCard() {
  const rec = current;
  const card = cardType(rec);
  const order = cardOrder(rec, settings);
  const shots = cardShots(rec);
  const missing = unaccounted(rec);
  const toCheck = rec.shots.filter(unsure).length;
  // Each notice is [kind, text]: 'check' (amber) asks for a look at doubtful
  // shots, 'penalty' (red) reports points taken off, '' is general guidance.
  const notes = [];
  if (missing) {
    notes.push(['', `${missing} shot${missing === 1 ? ' was' : 's were'} not detected. Tap the ringed diagram${missing === 1 ? '' : 's'} and either place ` +
      `the shot or confirm there is none. The score is shown once every shot is accounted for.`]);
  }
  const close = rec.shots.filter((s) => unsure(s) && s.borderline).length;
  if (toCheck) {
    notes.push(['check', `${toCheck} shot${toCheck === 1 ? '' : 's'} (pale, dashed) should be checked. Tap to confirm or adjust.` +
      (close ? ` ${close} of ${close === 1 ? 'them sits' : 'them sit'} right on a scoring line, too close for a photo to call. ` +
        'Zoom in on it, or check the card with a gauge.' : '')]);
  }
  const penalty = crossFirePenalty(rec);
  if (penalty) {
    const busy = card.diagrams.map((_, d) => d).filter((d) => slotsOn(rec, d).filter((i) => isShot(rec.shots[i])).length > card.shotsPerDiagram);
    notes.push(['penalty', `Cross-shots on diagram${busy.length === 1 ? '' : 's'} ${busy.map((d) => order.indexOf(d) + 1).sort((x, y) => x - y).join(', ')}. ` +
      `Penalty −${penalty} point${penalty === 1 ? '' : 's'}. −1 per cross-shot, rule 5.3.3.`]);
  }
  if (rec.crowded?.length) {
    const which = rec.crowded.map((d) => order.indexOf(d) + 1).sort((x, y) => x - y);
    notes.push(['check', `More holes than expected on diagram${which.length === 1 ? '' : 's'} ${which.join(', ')}, and no empty diagram to count them against. ` +
      `The strongest ${card.shotsPerDiagram === 1 ? 'one is' : 'two are'} placed; check ${which.length === 1 ? 'it' : 'them'} against the card.`]);
  }
  view.innerHTML = `
    <a class="back" href="#/">‹ Dashboard</a>
    <div class="panel">
      ${cardSvg(rec, card, settings, order)}
      ${missing
        ? `<div class="score-line"><span class="big pending">?</span><span class="of">Score not shown yet</span></div>`
        : `<div class="score-line"><span class="big">${cardTotal(rec, settings)}</span><span class="of">/ 100${crossFirePenalty(rec) ? ` (after ${crossFirePenalty(rec)} penalty)` : ''}</span></div>`}
      ${notes.map(([kind, text]) => `<p class="notice ${kind}">${text}</p>`).join('')}
      <p class="muted">${esc(card.label)}, ${card.gauging} gauging. Tap any diagram to check the shots against the photo and move them if needed. The small numbers are the order fired.</p>
      <div class="row">
        <label class="field">Date<input id="f-date" type="date" value="${esc(rec.date)}"></label>
        <label class="field">Competition / session<input id="f-name" type="text" maxlength="80" placeholder="e.g. BSSRA Round 1" value="${esc(rec.name)}"></label>
      </div>
      <label class="field notes-field">Notes for this card (optional)<textarea id="f-notes" rows="3" maxlength="4000"
        placeholder="Anything about this card: set-up changes, time limit, technique points to review">${esc(rec.notes ?? '')}</textarea></label>
    </div>
    <h2>Shots</h2>
    <div class="panel">
      <table>
        <tr><th>Shot</th><th>Score</th><th>X mm</th><th>Y mm</th><th>From centre</th></tr>
        ${firingSequence(rec).map(({ shot: s, number }) => isShot(s)
          ? `<tr><td>${number}</td><td><b>${scoreShot(s.x, s.y, card, settings)}</b></td><td>${mm(s.x)}</td><td>${mm(s.y)}</td><td>${Math.hypot(s.x, s.y).toFixed(1)}</td></tr>`
          : isMiss(s)
            ? `<tr><td>${number}</td><td><b>0</b></td><td colspan="3" class="muted">no shot on the diagram</td></tr>`
            : `<tr><td>${number}</td><td colspan="4" class="muted">not detected, to be confirmed</td></tr>`).join('')}
      </table>
      <p class="muted">In the order fired${card.shotsPerDiagram > 1 ? ' (the two shots on a diagram are listed together; which came first is not known)' : ''}. X is right of centre, Y is above centre.</p>
    </div>
    <h2>Group</h2>
    <div class="panel">${statsBlock(card, shots)}</div>
    <h2>Shot order for this card</h2>
    <div class="panel" id="card-order"></div>
    <div class="row">
      ${card.symmetric ? '<button id="flip">Card was upside down</button>' : ''}
      <button id="csv">Export CSV</button>
    </div>
    <div class="actions">
      <button id="save" class="primary" ${dirty ? '' : 'disabled'}>${rec.isNew ? 'Save card' : dirty ? 'Save changes' : 'Saved'}</button>
      <button id="del" class="danger">${rec.isNew ? 'Discard' : 'Delete card'}</button>
    </div>`;

  view.querySelectorAll('.dg').forEach((g) => g.addEventListener('click', () => openEditor(Number(g.dataset.d))));
  const touch = () => {
    rec.date = $('#f-date').value || today();
    rec.name = $('#f-name').value.trim();
    rec.notes = $('#f-notes').value.trim();
    dirty = true;
    $('#save').disabled = false;
    $('#save').textContent = rec.isNew ? 'Save card' : 'Save changes';
  };
  $('#f-date').addEventListener('input', touch);
  $('#f-name').addEventListener('input', touch);
  $('#f-notes').addEventListener('input', touch);
  $('#save').addEventListener('click', saveCard);
  $('#del').addEventListener('click', async () => {
    const sure = rec.isNew
      ? await ask('Discard this scan?', 'Discard')
      : await ask('Delete this card and its shots? This cannot be undone.', 'Delete');
    if (!sure) return;
    if (!rec.isNew) await store.deleteCard(rec.id);
    current = null;
    dirty = false;
    location.hash = '#/';
  });
  mountOrderPicker($('#card-order'), card, rec.orderSpec ?? defaultOrderSpec(settings, card), (spec) => {
    rec.orderSpec = spec;
    dirty = true;
    const y = window.scrollY;
    renderCard();
    window.scrollTo(0, y);
  });
  $('#flip')?.addEventListener('click', flipCard);
  $('#csv').addEventListener('click', () => download(`targetnotebook-${rec.date}.csv`, csvFor([rec]), 'text/csv'));
}

async function saveCard() {
  const { isNew, crowded: _seen, ...record } = current;
  // Saving a new card accepts the detector's placements: shots it was unsure
  // of count as reviewed from here on, whether or not each was opened.
  if (isNew) {
    record.shots = record.shots.map((s) => (unsure(s) ? { ...s, confidence: 'high' } : s));
  }
  await store.putCard(record);
  current = null;
  dirty = false;
  toast('Card saved on this device');
  location.hash = '#/';
}

// Turn the whole card through 180 degrees (only for layouts that look the same
// either way up): the first diagram becomes the last, and so on.
async function flipCard() {
  const turn = (url) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        const g = cv.getContext('2d');
        g.translate(cv.width, cv.height);
        g.rotate(Math.PI);
        g.drawImage(img, 0, 0);
        resolve(cv.toDataURL('image/jpeg', 0.9));
      };
      img.src = url;
    });
  const last = cardType(current).diagrams.length - 1;
  const turnOn = (s) => (s && Number.isInteger(s.on) ? { ...s, on: last - s.on } : s);
  current.shots = current.shots.map((s) => turnOn(isShot(s) ? { ...s, x: -s.x, y: -s.y } : s)).reverse();
  if (current.images) current.images = (await Promise.all(current.images.map(turn))).reverse();
  dirty = true;
  renderCard();
}

// ---------- diagram editor ----------

function openEditor(diagram) {
  const el = $('#editor');
  const card = cardType(current);
  const per = card.shotsPerDiagram;
  const size = card.patchMm;
  const half = size / 2;
  const order = cardOrder(current, settings);
  let zoom = 1;
  let drag = null;
  let active = 0; // which of this diagram's shots is being moved

  // The slots shown here: this diagram's own, less any cross-fired onto
  // another diagram, plus any cross-fired onto this one.
  let slots = [];
  const refresh = () => {
    slots = slotsOn(current, diagram);
    active = Math.min(active, Math.max(0, slots.length - 1));
  };
  const slot = (j = active) => slots[j];
  const home = (i) => Math.floor(i / per);
  // This diagram's own slots that hold a shot cross-fired onto another diagram.
  const away = () => Array.from({ length: per }, (_, j) => diagram * per + j).filter((i) => shotOn(current, i) !== diagram);
  // A slot that could take an extra shot here: one with nothing in it, on a
  // diagram with nothing at all on it if possible.
  const spare = () => {
    const open = current.shots.map((s, i) => i).filter((i) => !current.shots[i] && home(i) !== diagram);
    const emptyDiagram = (i) => slotsOn(current, home(i)).every((k) => !current.shots[k]);
    return open.find(emptyDiagram) ?? open[0];
  };
  const originFor = (s) => `${((s.x + half) / size) * 100}% ${((half - s.y) / size) * 100}%`;
  const pick = () => {
    refresh();
    // Start on the first shot that needs attention.
    const j = slots.findIndex((i) => { const s = current.shots[i]; return (!isShot(s) && !isMiss(s)) || unsure(s); });
    active = j < 0 ? 0 : j;
  };

  const draw = () => {
    const entry = current.shots[slot()];
    const shot = isShot(entry) ? entry : null;
    const miss = isMiss(entry);
    const image = current.images?.[diagram];
    const step = order.indexOf(diagram);
    const g = settings.gaugeDia / 2;
    const markR = card.aimingMarkDia / 2;
    const others = slots.map((_, j) => j).filter((j) => j !== active && isShot(current.shots[slot(j)]));
    const extra = (j) => slot(j) !== undefined && home(slot(j)) !== diagram; // cross-fired onto this diagram
    // Every shot meant for this diagram is counted on another one.
    const none = !slots.length;
    const gone = away();
    const canAdd = spare() !== undefined;
    el.innerHTML = `<div class="ed">
      <div class="ed-head">
        <span class="ed-score" id="ed-score">${none ? '–' : shot ? scoreShot(shot.x, shot.y, card, settings) : miss ? 0 : '?'}</span>
        <div class="ed-info"><small>${per > 1 ? `Diagram ${step + 1} of ${order.length}` : `Shot ${step + 1} of ${order.length}`}</small>
          <small id="ed-pos">${none ? 'No shots on this diagram' : shot ? `X ${mm(shot.x)}  Y ${mm(shot.y)} mm` : miss ? 'Confirmed: no shot here' : 'No shot detected'}</small>
          <small>${none ? 'Its shots are counted elsewhere' : shot ? (shot.source === 'auto' ? `Detected${shot.confidence === 'high' ? '' : ', please check'}` : 'Placed by hand') : miss ? 'Tap the hole if there is one after all' : 'Tap the hole, or confirm there is none'}</small></div>
        <button id="ed-done" class="primary">Done</button>
      </div>
      ${slots.length > 1 ? `<div class="row pickers">${slots.map((_, j) => {
        const s = current.shots[slot(j)];
        return `<button data-pick="${j}" class="${j === active ? 'primary' : ''}">Shot ${String.fromCharCode(65 + j)}${extra(j) ? ' (extra)' : ''}: ${isShot(s) ? scoreShot(s.x, s.y, card, settings) : isMiss(s) ? '0, no shot' : 'to confirm'}</button>`;
      }).join('')}</div>` : ''}
      ${gone.length ? `<p class="hint">${gone.length} shot${gone.length === 1 ? '' : 's'} meant for this diagram ${gone.length === 1 ? 'is' : 'are'} counted on diagram
        ${[...new Set(gone.map((i) => order.indexOf(shotOn(current, i)) + 1))].join(', ')} as a cross-fire. <button id="ed-back" class="inline">Count ${gone.length === 1 ? 'it' : 'them'} here instead</button></p>` : ''}
      <div class="stage" id="stage">
        <div class="zoomer" id="zoomer" style="transform:scale(${zoom});transform-origin:${shot ? originFor(shot) : '50% 50%'}">
          ${image ? `<img src="${image}" alt="Photo of diagram ${step + 1}">` : ''}
          <svg viewBox="${-half} ${-half} ${size} ${size}">
            ${image ? '' : `<rect x="${-half}" y="${-half}" width="${size}" height="${size}" fill="#e7caa2"/><circle r="${markR}" fill="#1f1b19"/>`}
            ${card.rings.map((r) => `<circle class="ov-ring" r="${r.dia / 2}"/>`).join('')}
            ${others.map((j) => { const o = current.shots[slot(j)]; return `<circle class="ov-other" cx="${o.x}" cy="${-o.y}" r="${g}"/>`; }).join('')}
            ${shot ? `<circle class="ov-gauge" id="ov-gauge" cx="${shot.x}" cy="${-shot.y}" r="${g}"/>
              <path class="ov-cross" id="ov-cross" d="M${shot.x - 1} ${-shot.y}h2M${shot.x} ${-shot.y - 1}v2"/>` : ''}
          </svg>
        </div>
      </div>
      <p class="hint">${none ? '' : shot
        ? `Drag anywhere to slide the blue gauge circle over the hole. The fine pale lines are the scoring rings.${slots.length > 1 ? ' Dashed circles are the other shots.' : ''}`
        : `Tap the centre of the shot hole.${per > 1 ? ' If both shots went through one hole, tap it again for this shot.' : ''}`}</p>
      <div class="nudge" ${none ? 'hidden' : ''}>
        <button data-nx="-0.1" data-ny="0" aria-label="Nudge left">←</button>
        <button data-nx="0" data-ny="0.1" aria-label="Nudge up">↑</button>
        <button data-nx="0" data-ny="-0.1" aria-label="Nudge down">↓</button>
        <button data-nx="0.1" data-ny="0" aria-label="Nudge right">→</button>
      </div>
      <div class="row">
        <button id="ed-zoom">${zoom > 1 ? 'Zoom out' : 'Zoom in'}</button>
        ${none ? '' : shot || miss
          ? `<button id="ed-remove">${shot ? (extra(active) ? 'Remove extra shot' : 'Remove shot') : 'Undo "no shot"'}</button>`
          : extra(active)
            ? '<button id="ed-remove">Cancel extra shot</button>'
            : '<button id="ed-miss">No shot here (scores 0)</button>'}
      </div>
      ${canAdd ? `<div class="row"><button id="ed-extra">+ Extra shot on this diagram (cross-fire)</button></div>` : ''}
      <div class="row">
        <button id="ed-prev" ${step ? '' : 'disabled'}>‹ Previous</button>
        <button id="ed-next" ${step < order.length - 1 ? '' : 'disabled'}>Next ›</button>
      </div>
    </div>`;
    wire();
  };

  const setShot = (x, y) => {
    const lim = half - 1;
    const on = current.shots[slot()]?.on;
    current.shots[slot()] = {
      x: Math.round(Math.max(-lim, Math.min(lim, x)) * 100) / 100,
      y: Math.round(Math.max(-lim, Math.min(lim, y)) * 100) / 100,
      source: 'manual',
      ...(Number.isInteger(on) ? { on } : {}),
    };
    dirty = true;
  };

  const wire = () => {
    const stage = $('#stage');
    stage.addEventListener('pointerdown', (e) => {
      const rect = stage.getBoundingClientRect();
      const scale = rect.width / size;
      if (!slots.length) return;
      const shot = current.shots[slot()];
      if (!isShot(shot)) {
        setShot((e.clientX - rect.left) / scale - half, half - (e.clientY - rect.top) / scale);
        return draw();
      }
      drag = { x: e.clientX, y: e.clientY, sx: shot.x, sy: shot.y, scale: scale * zoom };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      setShot(drag.sx + (e.clientX - drag.x) / drag.scale, drag.sy - (e.clientY - drag.y) / drag.scale);
      // Move the gauge in place; a full redraw would drop the pointer capture.
      const s = current.shots[slot()];
      $('#ov-gauge').setAttribute('cx', s.x);
      $('#ov-gauge').setAttribute('cy', -s.y);
      $('#ov-cross').setAttribute('d', `M${s.x - 1} ${-s.y}h2M${s.x} ${-s.y - 1}v2`);
      $('#zoomer').style.transformOrigin = originFor(s);
      $('#ed-score').textContent = scoreShot(s.x, s.y, card, settings);
      $('#ed-pos').textContent = `X ${mm(s.x)}  Y ${mm(s.y)} mm`;
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      draw();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    el.querySelectorAll('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => {
        confirmShots([active]);
        active = Number(b.dataset.pick);
        zoom = 1;
        draw();
      })
    );
    el.querySelectorAll('.nudge button').forEach((b) =>
      b.addEventListener('click', () => {
        const s = current.shots[slot()];
        if (!isShot(s)) return;
        setShot(s.x + Number(b.dataset.nx), s.y + Number(b.dataset.ny));
        draw();
      })
    );
    $('#ed-zoom').addEventListener('click', () => {
      zoom = zoom > 1 ? 1 : 3;
      draw();
    });
    $('#ed-remove')?.addEventListener('click', () => {
      // An extra shot's slot goes back to its own diagram, empty.
      current.shots[slot()] = null;
      dirty = true;
      zoom = 1;
      refresh();
      draw();
    });
    $('#ed-extra')?.addEventListener('click', () => {
      const i = spare();
      if (i === undefined) return;
      current.shots[i] = { on: diagram };
      dirty = true;
      zoom = 1;
      refresh();
      active = slots.indexOf(i);
      draw();
    });
    $('#ed-back')?.addEventListener('click', () => {
      for (const i of away()) current.shots[i] = null;
      dirty = true;
      refresh();
      draw();
    });
    $('#ed-miss')?.addEventListener('click', () => {
      current.shots[slot()] = { miss: true, source: 'manual' };
      dirty = true;
      draw();
    });
    const go = (step) => {
      confirmShots();
      diagram = order[order.indexOf(diagram) + step];
      zoom = 1;
      pick();
      draw();
    };
    $('#ed-prev').addEventListener('click', () => go(-1));
    $('#ed-next').addEventListener('click', () => go(1));
    $('#ed-done').addEventListener('click', () => {
      confirmShots();
      el.hidden = true;
      el.innerHTML = '';
      renderCard();
    });
  };

  // Looking at a detected shot and moving on counts as checking it.
  const confirmShots = (which = slots.map((_, j) => j)) => {
    for (const j of which) {
      const s = current.shots[slot(j)];
      if (unsure(s)) {
        s.confidence = 'high';
        dirty = true;
      }
    }
  };

  el.hidden = false;
  pick();
  draw();
}

// ---------- analysis ----------

let scope = { type: null, last: 'all', name: '' };

async function showAnalysis() {
  const everything = await store.listCards();
  const types = Object.values(CARDS).filter((c) => everything.some((rec) => cardType(rec) === c));
  // Different cards have different rings and gauging, so they are analysed separately.
  const card = types.find((c) => c.id === scope.type) ?? types[0] ?? CARDS[DEFAULT_TYPE];
  const all = everything.filter((rec) => cardType(rec) === card);
  const names = [...new Set(all.map((rec) => rec.name).filter(Boolean))].sort();
  let recs = scope.name ? all.filter((rec) => rec.name === scope.name) : all;
  if (scope.last !== 'all') recs = recs.slice(0, Number(scope.last));
  const shots = recs.flatMap(cardShots);
  const score = (s) => scoreShot(s.x, s.y, card, settings);
  // Only cards with every shot accounted for have a total.
  const full = recs.filter((rec) => !unaccounted(rec)).reverse();
  const misses = recs.flatMap((rec) => rec.shots.filter(isMiss)).length;
  const totals = full.map((rec) => cardTotal(rec, settings)); // oldest first
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  // NSRA average: the most recent six cards with the lowest one dropped.
  const nsra = totals.length >= 6 ? mean(totals.slice(-6).sort((a, b) => b - a).slice(0, 5)) : null;
  const lastFive = totals.length >= 5 ? mean(totals.slice(-5)) : null;
  const per = card.shotsPerDiagram;
  const byStep = card.diagrams.map((_, k) => {
    const scores = recs
      .flatMap((rec) => {
        const d = cardOrder(rec, settings)[k];
        return rec.shots.slice(d * per, d * per + per);
      })
      .filter((s) => isShot(s) || isMiss(s))
      .map((s) => shotValue(s, card, settings));
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  });
  // Points dropped at each place on the card, whatever order it was shot in.
  const byPlace = card.diagrams.map((_, d) => {
    const scores = recs
      .flatMap((rec) => slotsOn(rec, d).map((i) => rec.shots[i]))
      .filter((s) => isShot(s) || isMiss(s))
      .map((s) => shotValue(s, card, settings));
    return scores.length ? { lost: 10 - mean(scores), shots: scores.length } : null;
  });
  const places = byPlace.filter(Boolean);
  const worst = places.length ? byPlace.indexOf(places.reduce((a, b) => (b.lost > a.lost ? b : a))) : -1;
  const even = places.length > 0 && places.every((p) => Math.abs(p.lost - places[0].lost) < 0.05);
  const where = (d) => {
    let row = 0;
    let at = d;
    while (at >= card.rows[row]) at -= card.rows[row++];
    const rowName = card.rows.length === 2 ? ['top', 'bottom'][row] : ['top', 'middle', 'bottom'][row];
    const size = card.rows[row];
    const colName = size === 2 ? ['left', 'right'][at] : size === 3 ? ['left', 'centre', 'right'][at] : ['far left', 'centre left', 'centre right', 'far right'][at];
    return `${rowName} row, ${colName}`;
  };
  const values = shotValues(card);
  const dist = values.map((v) => ({ v, n: shots.filter((s) => score(s) === v).length + (v === 0 ? misses : 0) }));
  view.innerHTML = `
    <div class="panel"><div class="row">
      ${types.length > 1 ? `<label class="field">Card type<select id="a-type">
        ${types.map((c) => `<option value="${c.id}" ${c === card ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select></label>` : ''}
      <label class="field">Cards<select id="a-last">
        ${[['all', 'All cards'], ['1', 'Latest card'], ['5', 'Last 5'], ['10', 'Last 10'], ['20', 'Last 20']]
          .map(([v, t]) => `<option value="${v}" ${scope.last === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></label>
      <label class="field">Competition / session<select id="a-name">
        <option value="">All</option>
        ${names.map((n) => `<option value="${esc(n)}" ${scope.name === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select></label>
    </div></div>
    ${recs.length ? `
    <h2>Scores</h2>
    <div class="panel">
      ${totals.length ? `
        <div class="stats">
          <div class="stat"><b>${mean(totals).toFixed(1)}</b><span>Average, all ${totals.length} selected card${totals.length === 1 ? '' : 's'}</span></div>
          <div class="stat"><b>${nsra === null ? '–' : nsra.toFixed(1)}</b><span>NSRA average (best 5 of last 6)${nsra === null ? ', needs 6 cards' : ''}</span></div>
          <div class="stat"><b>${lastFive === null ? '–' : lastFive.toFixed(1)}</b><span>Average, last 5 cards${lastFive === null ? ', needs 5 cards' : ''}</span></div>
          <div class="stat"><b>${Math.max(...totals)}</b><span>Best card</span></div>
        </div>
        ${trendSvg(full.map((rec, i) => ({ label: esc(niceDate(rec.date)), value: totals[i] })))}`
        : '<p class="muted">No cards in this selection have every shot accounted for yet.</p>'}
      <table style="margin-top:10px"><tr><th>Shot value</th>${dist.map((d) => `<th>${d.v}</th>`).join('')}</tr>
        <tr><td>Count</td>${dist.map((d) => `<td>${d.n}</td>`).join('')}</tr></table>
    </div>
    <h2>Average score by ${per > 1 ? 'diagram' : 'shot number'}</h2>
    <div class="panel">
      ${shots.length ? shotNumberSvg(byStep) : ''}
      <p class="muted">${per > 1 ? 'First diagram shot to last' : 'First shot fired to last'}, using each card's shot order.</p>
    </div>
    <h2>Points lost by position on the card</h2>
    <div class="panel">
      ${places.length ? `
        ${positionSvg(card, byPlace.map((p) => (p ? p.lost : null)))}
        <div class="scale"><span>Fewest lost</span><i></i><span>Most lost</span></div>
        <p class="muted">Average points dropped per shot at each aiming mark, across ${recs.length} card${recs.length === 1 ? '' : 's'}, whatever order they were shot in.
        Colours run from the best position (green) to the worst (red), so they compare positions with each other; the numbers show how big the difference really is.</p>
        <p class="muted">${even
          ? 'No position stands out: the same is dropped everywhere.'
          : `Most is dropped at the ${where(worst)}: ${byPlace[worst].lost.toFixed(1)} per shot over ${byPlace[worst].shots} shot${byPlace[worst].shots === 1 ? '' : 's'}.`}
        ${recs.length < 5 ? 'With only a few cards this can be chance; it means more as cards build up.' : ''}</p>`
        : '<p class="muted">No shots in this selection yet.</p>'}
    </div>
    <h2>Group, all ${shots.length} shots overlaid</h2>
    <div class="panel">${statsBlock(card, shots)}</div>
    <h2>Technique hints</h2>
    <div class="panel">${hintsBlock(shots)}</div>` : '<p class="muted">No saved cards match this selection.</p>'}`;
  $('#a-type')?.addEventListener('change', (e) => { scope = { type: e.target.value, last: 'all', name: '' }; showAnalysis(); });
  $('#a-last').addEventListener('change', (e) => { scope.last = e.target.value; showAnalysis(); });
  $('#a-name').addEventListener('change', (e) => { scope.name = e.target.value; showAnalysis(); });
}

// ---------- settings ----------

async function showSettings() {
  const state = await store.persistence();
  const used = await store.usage();
  const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(n ? 1 : 0, Math.round(n / 1e3))} KB`);
  const storageNote = {
    persistent: 'Storage is marked persistent, so the browser will not clear it automatically.',
    'best-effort': 'The browser may clear this data if the device runs low on space or the app goes unused. Add the app to your home screen and keep a backup.',
    unsupported: 'This browser cannot guarantee long-term storage. Keep a backup.',
  }[state];
  view.innerHTML = `
    <h2>Shooter</h2>
    <div class="panel">
      <label class="field">Shoots<select id="s-hand">
        <option value="right" ${settings.handedness === 'left' ? '' : 'selected'}>Right-handed</option>
        <option value="left" ${settings.handedness === 'left' ? 'selected' : ''}>Left-handed</option>
      </select></label>
      <p class="muted">Choosing left-handed ticks "Mirror image" on the shot orders below, and right-handed unticks it. You can still change those boxes yourself afterwards.</p>
    </div>
    ${Object.values(CARDS).map((c) => `
    <h2>Default shot order, ${esc(c.label)}</h2>
    <div class="panel">
      <div id="s-order-${c.id}"></div>
      <p class="muted">Used for new scans${c.id === DEFAULT_TYPE ? ', and for saved cards that have no order of their own' : ''}. It can be changed on any individual card.</p>
    </div>`).join('')}
    <h2>Storage and backup</h2>
    <div class="panel">
      <div class="stats">
        <div class="stat"><b>${size(used.bytes)}</b><span>Used on this device</span></div>
        <div class="stat"><b>${used.cards}</b><span>Saved card${used.cards === 1 ? '' : 's'}</span></div>
        ${used.quota ? `<div class="stat"><b>${size(used.quota)}</b><span>Space the browser allows</span></div>` : ''}
      </div>
      <p class="muted">${used.cards
        ? `About ${size(used.bytes / used.cards)} per card. The diagram photos kept for checking shots make up ${size(used.photoBytes)} of the total.`
        : 'Each saved card takes roughly half a megabyte, nearly all of it the diagram photos kept for checking shots.'}</p>
      <p class="muted">Everything is stored only in this browser on this device. ${storageNote}</p>
      <div class="row">
        <button id="x-full">Backup with photos</button>
        <button id="x-data">Backup data only</button>
        <button id="x-csv">All shots as CSV</button>
        <label class="btn">Restore backup<input id="x-import" type="file" accept="application/json,.json" hidden></label>
      </div>
    </div>
    <div class="advanced">
      <h2>Advanced</h2>
      <p class="muted">Leave these alone unless you know what you're doing.</p>
    </div>
    <h3>Scoring</h3>
    <div class="panel">
      <label class="field">Gauge diameter (mm)<input id="s-gauge" type="number" step="0.01" min="4" max="7" value="${settings.gaugeDia}"></label>
      <p class="muted">${Object.values(CARDS).map((c) => `${esc(c.label)} cards are gauged ${c.gauging}`).join('; ')}.
      Outward means the whole gauge must be on or inside a ring to score it; inward means the gauge need only touch the ring.
      Scores are always worked out from the stored shot positions, so changing the gauge re-scores every saved card.</p>
    </div>
    <h3>Sights</h3>
    <div class="panel">
      <label class="field">Clicks per minute of angle<input id="s-clicks" type="number" step="1" min="1" max="20" value="${Math.round(1 / settings.clickMoa)}"></label>
      <p class="muted">One click moves the shot ${(settings.clickMoa * MOA_MM).toFixed(2)} mm at 25 yards.</p>
    </div>
    <p class="muted" style="text-align:center">Target Notebook version ${VERSION}</p>`;
  const save = async () => {
    const gauge = Number($('#s-gauge').value);
    const clicks = Number($('#s-clicks').value);
    settings = {
      ...settings,
      gaugeDia: gauge >= 4 && gauge <= 7 ? gauge : settings.gaugeDia,
      clickMoa: clicks >= 1 && clicks <= 20 ? 1 / clicks : settings.clickMoa,
    };
    await store.putSettings(settings);
    showSettings();
  };
  for (const id of ['s-gauge', 's-clicks']) $(`#${id}`).addEventListener('change', save);
  $('#s-hand').addEventListener('change', async (e) => {
    const handedness = e.target.value === 'left' ? 'left' : 'right';
    // Changing hand sets the mirror option on every default order to match.
    // Saved cards keep the order they were scanned with.
    const mirror = handedness === 'left';
    const orders = {};
    for (const c of Object.values(CARDS)) {
      if (c.id !== DEFAULT_TYPE) orders[c.id] = { ...defaultOrderSpec(settings, c), mirror };
    }
    settings = {
      ...settings,
      handedness,
      shotOrder: { ...defaultOrderSpec(settings, CARDS[DEFAULT_TYPE]), mirror },
      shotOrders: { ...settings.shotOrders, ...orders },
    };
    await store.putSettings(settings);
    showSettings();
  });
  for (const c of Object.values(CARDS)) {
    mountOrderPicker($(`#s-order-${c.id}`), c, defaultOrderSpec(settings, c), async (spec) => {
      settings = c.id === DEFAULT_TYPE
        ? { ...settings, shotOrder: spec }
        : { ...settings, shotOrders: { ...settings.shotOrders, [c.id]: spec } };
      await store.putSettings(settings);
    });
  }
  const stamp = today();
  $('#x-full').addEventListener('click', async () =>
    download(`targetnotebook-backup-${stamp}.json`, JSON.stringify(await store.exportData({ images: true })), 'application/json'));
  $('#x-data').addEventListener('click', async () =>
    download(`targetnotebook-data-${stamp}.json`, JSON.stringify(await store.exportData({ images: false }), null, 1), 'application/json'));
  $('#x-csv').addEventListener('click', async () =>
    download(`targetnotebook-shots-${stamp}.csv`, csvFor(await store.listCards()), 'text/csv'));
  $('#x-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const count = await store.importData(JSON.parse(await file.text()));
      toast(`Restored ${count} card${count === 1 ? '' : 's'}`);
    } catch (err) {
      tell(`That backup could not be restored. ${err.message}`);
    }
  });
}

// ---------- training notes ----------

async function showNote(id) {
  if (id === 'new') {
    if (!note?.isNew) {
      note = { id: store.newId(), isNew: true, date: today(), text: '', createdAt: new Date().toISOString() };
      noteDirty = false;
    }
  } else if (note?.id !== id || note.isNew) {
    note = await store.getNote(id);
    noteDirty = false;
    if (!note) return void (location.hash = '#/');
  }
  const n = note;
  view.innerHTML = `
    <a class="back" href="#/">‹ Dashboard</a>
    <div class="panel">
      <label class="field">Date<input id="n-date" type="date" value="${esc(n.date)}"></label>
      <label class="field notes-field">Training note<textarea id="n-text" rows="12" maxlength="20000"
        placeholder="What you worked on, what went well, what to change next time">${esc(n.text)}</textarea></label>
    </div>
    <div class="actions">
      <button id="n-save" class="primary" ${noteDirty && n.text.trim() ? '' : 'disabled'}>${n.isNew ? 'Save note' : noteDirty ? 'Save changes' : 'Saved'}</button>
      <button id="n-del" class="danger">${n.isNew ? 'Discard' : 'Delete note'}</button>
    </div>`;
  const touch = () => {
    n.date = $('#n-date').value || today();
    n.text = $('#n-text').value;
    noteDirty = true;
    $('#n-save').disabled = !n.text.trim();
    $('#n-save').textContent = n.isNew ? 'Save note' : 'Save changes';
  };
  $('#n-date').addEventListener('input', touch);
  $('#n-text').addEventListener('input', touch);
  $('#n-save').addEventListener('click', async () => {
    const { isNew, ...record } = n;
    record.text = record.text.trim();
    record.updatedAt = new Date().toISOString();
    await store.putNote(record);
    note = null;
    noteDirty = false;
    toast('Note saved on this device');
    location.hash = '#/';
  });
  $('#n-del').addEventListener('click', async () => {
    const sure = n.isNew
      ? !n.text.trim() || (await ask('Discard this note?', 'Discard'))
      : await ask('Delete this note? This cannot be undone.', 'Delete');
    if (!sure) return;
    if (!n.isNew) await store.deleteNote(n.id);
    note = null;
    noteDirty = false;
    location.hash = '#/';
  });
  if (n.isNew && !n.text) $('#n-text').focus();
}

// ---------- routing ----------

async function route() {
  const hash = location.hash || '#/';
  const leavingCard = current && dirty && !hash.startsWith('#/card/');
  if (leavingCard && !(await ask('Leave without saving this card?', 'Leave', 'Stay'))) {
    history.replaceState(null, '', current.isNew ? '#/card/new' : `#/card/${current.id}`);
    return;
  }
  if (!hash.startsWith('#/card/')) {
    current = null;
    dirty = false;
  }
  const leavingNote = note && noteDirty && note.text.trim() && !hash.startsWith('#/note/');
  if (leavingNote && !(await ask('Leave without saving this note?', 'Leave', 'Stay'))) {
    history.replaceState(null, '', note.isNew ? '#/note/new' : `#/note/${note.id}`);
    return;
  }
  if (!hash.startsWith('#/note/')) {
    note = null;
    noteDirty = false;
  }
  $('#editor').hidden = true;
  const tab = hash.startsWith('#/analysis') ? 'analysis' : hash.startsWith('#/settings') ? 'settings' : 'cards';
  // A card has its own bottom bar (save and delete) in place of the tabs.
  document.body.classList.toggle('card-open', hash.startsWith('#/card/') || hash.startsWith('#/note/'));
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  try {
    if (hash.startsWith('#/card/')) await showCard(decodeURIComponent(hash.slice(7)));
    else if (hash.startsWith('#/note/')) await showNote(decodeURIComponent(hash.slice(7)));
    else if (tab === 'analysis') await showAnalysis();
    else if (tab === 'settings') await showSettings();
    else await showCards();
  } catch (err) {
    // Say so rather than leave the previous page showing under the new tab.
    console.error(err);
    view.innerHTML = `<div class="panel">
      <p><b>This page could not be shown.</b></p>
      <p class="muted">Reloading usually fixes it. If it keeps happening, the message below says what went wrong.</p>
      <p class="muted">${esc(err?.message ?? err)} (version ${VERSION})</p>
      <button class="primary" id="reload">Reload</button>
    </div>`;
    $('#reload').addEventListener('click', () => location.reload());
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => {
  if (dirty || (noteDirty && note?.text.trim())) e.preventDefault();
});

settings = await store.getSettings();
await route();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
