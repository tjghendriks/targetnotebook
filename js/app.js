import {
  CARD, scoreShot, cardShots, cardTotal, groupStats, sightCorrection, MOA_MM,
  ORDER_METHODS, isOrder, resolveOrder, cardOrder,
} from './model.js';
import * as store from './store.js';
import { scanCard, ScanError, PATCH_MM } from './detect.js';
import { cardSvg, groupSvg, trendSvg, orderSvg, shotNumberSvg } from './render.js';

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

let settings;
let current = null; // the card being viewed or edited
let dirty = false;

// ---------- small UI helpers ----------

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

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

function csvFor(cards) {
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  // shot = order fired; diagram = position on the card, reading left to right, top to bottom.
  const rows = ['card_id,date,name,shot,diagram,x_mm,y_mm,score,placed_by'];
  for (const c of cards) {
    cardOrder(c, settings).forEach((p, k) => {
      const s = c.shots[p];
      if (!s) return;
      rows.push([c.id, c.date, q(c.name), k + 1, p + 1, s.x.toFixed(2), s.y.toFixed(2), scoreShot(s.x, s.y, settings), s.source].join(','));
    });
  }
  return rows.join('\n') + '\n';
}

function statsBlock(shots) {
  const st = groupStats(shots);
  if (!st || st.n < 2) return '<p class="muted">At least two shots are needed for group statistics.</p>';
  const corr = sightCorrection(st, settings);
  const part = (a) => (a.clicks ? `${a.clicks} click${a.clicks === 1 ? '' : 's'} ${a.dir}` : null);
  const moves = [part(corr.horizontal), part(corr.vertical)].filter(Boolean);
  return `
    ${groupSvg(shots, st, settings)}
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

// A firing-order chooser: method, mirror option, and tap-to-number for a custom
// order. Calls onChange with a new spec whenever a complete order is chosen.
function mountOrderPicker(el, spec, onChange) {
  spec = { method: 'clockwise', mirror: false, custom: null, ...spec };
  let taps = null; // partly entered custom order
  const draw = () => {
    const custom = spec.method === 'custom';
    const order = taps ?? resolveOrder(spec);
    el.innerHTML = `
      <div class="row">
        <label class="field">Order<select data-o="method">
          ${Object.entries(ORDER_METHODS).map(([k, m]) => `<option value="${k}" ${spec.method === k ? 'selected' : ''}>${m.label}</option>`).join('')}
          <option value="custom" ${custom ? 'selected' : ''}>Custom</option>
        </select></label>
        ${custom
          ? '<button data-o="clear">Clear and re-enter</button>'
          : `<label class="check"><input type="checkbox" data-o="mirror" ${spec.mirror ? 'checked' : ''}> Mirror image (left-handed)</label>`}
      </div>
      ${orderSvg(order)}
      <p class="muted">${taps
        ? `Tap the diagrams in the order they are shot. ${10 - taps.length} to go.`
        : custom ? 'Custom order. Use Clear and re-enter to change it.' : 'Numbers show the order the diagrams are shot.'}</p>`;
    el.querySelector('[data-o=method]').addEventListener('change', (e) => {
      const method = e.target.value;
      // Start a custom order from whatever was showing, so it is valid straight away.
      const seed = method === 'custom' && !isOrder(spec.custom) ? resolveOrder(spec) : spec.custom;
      spec = { ...spec, method, custom: seed };
      taps = null;
      onChange(spec);
      draw();
    });
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
      el.querySelectorAll('.op').forEach((g) => g.addEventListener('click', () => {
        const p = Number(g.dataset.p);
        if (taps.includes(p)) return;
        taps.push(p);
        if (taps.length === 10) {
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

// ---------- cards list ----------

async function showCards() {
  const cards = await store.listCards();
  view.innerHTML = `
    <div class="panel">
      <div class="row">
        <label class="btn primary">Take photo<input id="cam" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="btn">Choose photo<input id="pick" type="file" accept="image/*" hidden></label>
      </div>
      <p class="muted">Lay the card flat on a plain white or light surface, with all ten aiming marks in the frame and no strong shadows.</p>
    </div>
    <h2>Saved cards</h2>
    ${cards.length ? '' : '<p class="muted">No cards saved yet.</p>'}
    <ul class="card-list">
      ${cards.map((c) => {
        const n = cardShots(c).length;
        return `<li><a href="#/card/${esc(c.id)}">
          <span class="total">${cardTotal(c, settings)}<small>${n < 10 ? ` /${n * 10}` : ''}</small></span>
          <span class="meta"><b>${esc(c.name || 'Untitled')}</b><span class="muted">${esc(niceDate(c.date))}</span></span>
          <span class="chev">›</span></a></li>`;
      }).join('')}
    </ul>`;
  for (const id of ['cam', 'pick']) {
    $(`#${id}`).addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) scan(file);
    });
  }
}

async function scan(file) {
  busy('Reading photo');
  try {
    const result = await scanCard(file, { onProgress: busy });
    current = {
      id: store.newId(),
      isNew: true,
      date: today(),
      name: '',
      createdAt: new Date().toISOString(),
      shots: result.diagrams.map((d) => d.shot),
      images: result.diagrams.map((d) => d.image),
      orderSpec: structuredClone(settings.shotOrder),
    };
    dirty = true;
    busy(null);
    if (location.hash === '#/card/new') showCard('new');
    else location.hash = '#/card/new';
  } catch (err) {
    busy(null);
    console.error(err);
    alert(err instanceof ScanError ? err.message : `Sorry, that photo could not be processed. (${err.message})`);
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
  const card = current;
  const order = cardOrder(card, settings);
  const shots = cardShots(card);
  const missing = 10 - shots.length;
  const unsure = card.shots.filter((s) => s && s.source === 'auto' && s.confidence !== 'high').length;
  const notes = [];
  if (missing) notes.push(`${missing} diagram${missing === 1 ? ' has' : 's have'} no shot marked. Tap a diagram to place it.`);
  if (unsure) notes.push(`${unsure} shot${unsure === 1 ? '' : 's'} (pale, dashed) should be checked. Tap to confirm or adjust.`);
  view.innerHTML = `
    <div class="panel">
      ${cardSvg(card, settings, order)}
      <div class="score-line"><span class="big">${cardTotal(card, settings)}</span><span class="of">/ 100${missing ? ` (${shots.length} shots)` : ''}</span></div>
      ${notes.map((n) => `<p class="notice">${n}</p>`).join('')}
      <p class="muted">Tap any diagram to check the shot against the photo and move it if needed. The small numbers are the order fired.</p>
      <div class="row">
        <label class="field">Date<input id="f-date" type="date" value="${esc(card.date)}"></label>
        <label class="field">Competition / session<input id="f-name" type="text" maxlength="80" placeholder="e.g. Winter league round 3" value="${esc(card.name)}"></label>
      </div>
      <div class="row" style="margin-top:12px">
        <button id="save" class="primary" ${dirty ? '' : 'disabled'}>${card.isNew ? 'Save card' : dirty ? 'Save changes' : 'Saved'}</button>
        <button id="del" class="danger">${card.isNew ? 'Discard' : 'Delete card'}</button>
      </div>
    </div>
    <h2>Shots</h2>
    <div class="panel">
      <table>
        <tr><th>Shot</th><th>Score</th><th>X mm</th><th>Y mm</th><th>From centre</th></tr>
        ${order.map((p, k) => {
          const s = card.shots[p];
          return s
            ? `<tr><td>${k + 1}</td><td><b>${scoreShot(s.x, s.y, settings)}</b></td><td>${mm(s.x)}</td><td>${mm(s.y)}</td><td>${Math.hypot(s.x, s.y).toFixed(1)}</td></tr>`
            : `<tr><td>${k + 1}</td><td colspan="4" class="muted">not marked</td></tr>`;
        }).join('')}
      </table>
      <p class="muted">In the order fired. X is right of centre, Y is above centre.</p>
    </div>
    <h2>Shot order for this card</h2>
    <div class="panel" id="card-order"></div>
    <h2>Group</h2>
    <div class="panel">${statsBlock(shots)}</div>
    <div class="row">
      <button id="flip">Card was upside down</button>
      <button id="csv">Export CSV</button>
    </div>`;

  view.querySelectorAll('.dg').forEach((g) => g.addEventListener('click', () => openEditor(Number(g.dataset.n) - 1)));
  const touch = () => {
    card.date = $('#f-date').value || today();
    card.name = $('#f-name').value.trim();
    dirty = true;
    $('#save').disabled = false;
    $('#save').textContent = card.isNew ? 'Save card' : 'Save changes';
  };
  $('#f-date').addEventListener('input', touch);
  $('#f-name').addEventListener('input', touch);
  $('#save').addEventListener('click', saveCard);
  $('#del').addEventListener('click', async () => {
    if (!confirm(card.isNew ? 'Discard this scan?' : 'Delete this card and its shots? This cannot be undone.')) return;
    if (!card.isNew) await store.deleteCard(card.id);
    current = null;
    dirty = false;
    location.hash = '#/';
  });
  mountOrderPicker($('#card-order'), card.orderSpec ?? settings.shotOrder, (spec) => {
    card.orderSpec = spec;
    dirty = true;
    const y = window.scrollY;
    renderCard();
    window.scrollTo(0, y);
  });
  $('#flip').addEventListener('click', flipCard);
  $('#csv').addEventListener('click', () => download(`targetnotebook-${card.date}.csv`, csvFor([card]), 'text/csv'));
}

async function saveCard() {
  const { isNew, ...record } = current;
  await store.putCard(record);
  current = record;
  dirty = false;
  toast('Card saved on this device');
  if (isNew) history.replaceState(null, '', `#/card/${record.id}`);
  renderCard();
}

// Turn the whole card through 180 degrees: diagram 1 becomes diagram 10, and so on.
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
  current.shots = current.shots.map((s) => (s ? { ...s, x: -s.x, y: -s.y } : null)).reverse();
  if (current.images) current.images = (await Promise.all(current.images.map(turn))).reverse();
  dirty = true;
  renderCard();
}

// ---------- diagram editor ----------

function openEditor(index) {
  const el = $('#editor');
  const half = PATCH_MM / 2;
  const order = cardOrder(current, settings);
  let zoom = 1;
  let drag = null;

  const draw = () => {
    const shot = current.shots[index];
    const image = current.images?.[index];
    const score = shot ? scoreShot(shot.x, shot.y, settings) : null;
    const origin = shot ? `${((shot.x + half) / PATCH_MM) * 100}% ${((half - shot.y) / PATCH_MM) * 100}%` : '50% 50%';
    const g = settings.gaugeDia / 2;
    el.innerHTML = `<div class="ed">
      <div class="ed-head">
        <div><small>Shot ${order.indexOf(index) + 1} of 10</small><span class="ed-score" id="ed-score">${shot ? score : '–'}</span></div>
        <div style="text-align:right"><small id="ed-pos">${shot ? `X ${mm(shot.x)}  Y ${mm(shot.y)} mm` : 'No shot marked'}</small>
          <small>${shot ? (shot.source === 'auto' ? `Detected${shot.confidence === 'high' ? '' : ', please check'}` : 'Placed by hand') : 'Tap the hole to place it'}</small></div>
      </div>
      <div class="stage" id="stage">
        <div class="zoomer" id="zoomer" style="transform:scale(${zoom});transform-origin:${origin}">
          ${image ? `<img src="${image}" alt="Photo of the diagram for shot ${order.indexOf(index) + 1}">` : ''}
          <svg viewBox="${-half} ${-half} ${PATCH_MM} ${PATCH_MM}">
            ${image ? '' : `<rect x="${-half}" y="${-half}" width="${PATCH_MM}" height="${PATCH_MM}" fill="#e7caa2"/><circle r="${CARD.aimingMarkDia / 2}" fill="#1f1b19"/>`}
            ${CARD.rings.map((r) => `<circle class="ov-ring" r="${r.dia / 2}"/>`).join('')}
            ${shot ? `<circle class="ov-gauge" id="ov-gauge" cx="${shot.x}" cy="${-shot.y}" r="${g}"/>
              <path class="ov-cross" id="ov-cross" d="M${shot.x - 1} ${-shot.y}h2M${shot.x} ${-shot.y - 1}v2"/>` : ''}
          </svg>
        </div>
      </div>
      <p class="hint">${shot ? 'Drag anywhere to slide the blue gauge circle over the hole. The fine pale lines are the scoring rings.' : 'Tap the centre of the shot hole.'}</p>
      <div class="nudge">
        <button data-nx="-0.1" data-ny="0" aria-label="Nudge left">←</button>
        <button data-nx="0" data-ny="0.1" aria-label="Nudge up">↑</button>
        <button data-nx="0" data-ny="-0.1" aria-label="Nudge down">↓</button>
        <button data-nx="0.1" data-ny="0" aria-label="Nudge right">→</button>
      </div>
      <div class="row">
        <button id="ed-zoom">${zoom > 1 ? 'Zoom out' : 'Zoom in'}</button>
        <button id="ed-remove" ${shot ? '' : 'disabled'}>Remove shot</button>
      </div>
      <div class="row">
        <button id="ed-prev" ${order.indexOf(index) ? '' : 'disabled'}>‹ Previous</button>
        <button id="ed-next" ${order.indexOf(index) < 9 ? '' : 'disabled'}>Next ›</button>
        <button id="ed-done" class="primary">Done</button>
      </div>
    </div>`;
    wire();
  };

  const setShot = (x, y) => {
    const lim = half - 1;
    current.shots[index] = {
      x: Math.round(Math.max(-lim, Math.min(lim, x)) * 100) / 100,
      y: Math.round(Math.max(-lim, Math.min(lim, y)) * 100) / 100,
      source: 'manual',
    };
    dirty = true;
  };

  const wire = () => {
    const stage = $('#stage');
    stage.addEventListener('pointerdown', (e) => {
      const rect = stage.getBoundingClientRect();
      const scale = rect.width / PATCH_MM;
      const shot = current.shots[index];
      if (!shot) {
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
      const s = current.shots[index];
      $('#ov-gauge').setAttribute('cx', s.x);
      $('#ov-gauge').setAttribute('cy', -s.y);
      $('#ov-cross').setAttribute('d', `M${s.x - 1} ${-s.y}h2M${s.x} ${-s.y - 1}v2`);
      $('#zoomer').style.transformOrigin = `${((s.x + half) / PATCH_MM) * 100}% ${((half - s.y) / PATCH_MM) * 100}%`;
      $('#ed-score').textContent = scoreShot(s.x, s.y, settings);
      $('#ed-pos').textContent = `X ${mm(s.x)}  Y ${mm(s.y)} mm`;
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      draw();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    el.querySelectorAll('.nudge button').forEach((b) =>
      b.addEventListener('click', () => {
        const s = current.shots[index];
        if (!s) return;
        setShot(s.x + Number(b.dataset.nx), s.y + Number(b.dataset.ny));
        draw();
      })
    );
    $('#ed-zoom').addEventListener('click', () => {
      zoom = zoom > 1 ? 1 : 3;
      draw();
    });
    $('#ed-remove').addEventListener('click', () => {
      current.shots[index] = null;
      dirty = true;
      zoom = 1;
      draw();
    });
    const go = (step) => {
      confirmShot();
      index = order[order.indexOf(index) + step];
      zoom = 1;
      draw();
    };
    $('#ed-prev').addEventListener('click', () => go(-1));
    $('#ed-next').addEventListener('click', () => go(1));
    $('#ed-done').addEventListener('click', () => {
      confirmShot();
      el.hidden = true;
      el.innerHTML = '';
      renderCard();
    });
  };

  // Looking at a detected shot and moving on counts as checking it.
  const confirmShot = () => {
    const s = current.shots[index];
    if (s && s.source === 'auto' && s.confidence !== 'high') {
      s.confidence = 'high';
      dirty = true;
    }
  };

  el.hidden = false;
  draw();
}

// ---------- analysis ----------

let scope = { last: 'all', name: '' };

async function showAnalysis() {
  const all = await store.listCards();
  const names = [...new Set(all.map((c) => c.name).filter(Boolean))].sort();
  let cards = scope.name ? all.filter((c) => c.name === scope.name) : all;
  if (scope.last !== 'all') cards = cards.slice(0, Number(scope.last));
  const shots = cards.flatMap(cardShots);
  const full = cards.filter((c) => cardShots(c).length === 10).reverse();
  const totals = full.map((c) => cardTotal(c, settings));
  const byNumber = Array.from({ length: 10 }, (_, k) => {
    const scores = cards.map((c) => c.shots[cardOrder(c, settings)[k]]).filter(Boolean).map((s) => scoreShot(s.x, s.y, settings));
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  });
  const dist = [10, 9, 8, 7, 6, 0].map((v) => ({ v, n: shots.filter((s) => scoreShot(s.x, s.y, settings) === v).length }));
  view.innerHTML = `
    <div class="panel"><div class="row">
      <label class="field">Cards<select id="a-last">
        ${[['all', 'All cards'], ['1', 'Latest card'], ['5', 'Last 5'], ['10', 'Last 10'], ['20', 'Last 20']]
          .map(([v, t]) => `<option value="${v}" ${scope.last === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></label>
      <label class="field">Competition / session<select id="a-name">
        <option value="">All</option>
        ${names.map((n) => `<option value="${esc(n)}" ${scope.name === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select></label>
    </div></div>
    ${cards.length ? `
    <h2>Scores</h2>
    <div class="panel">
      ${totals.length ? `
        <div class="stats">
          <div class="stat"><b>${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1)}</b><span>Average card</span></div>
          <div class="stat"><b>${Math.max(...totals)}</b><span>Best card</span></div>
          <div class="stat"><b>${totals.length}</b><span>Complete cards</span></div>
        </div>
        ${trendSvg(full.map((c, i) => ({ label: esc(niceDate(c.date)), value: totals[i] })))}`
        : '<p class="muted">No complete 10-shot cards in this selection.</p>'}
      <table style="margin-top:10px"><tr><th>Shot value</th>${dist.map((d) => `<th>${d.v || 'Outside 6'}</th>`).join('')}</tr>
        <tr><td>Count</td>${dist.map((d) => `<td>${d.n}</td>`).join('')}</tr></table>
    </div>
    <h2>Average score by shot number</h2>
    <div class="panel">
      ${shots.length ? shotNumberSvg(byNumber) : ''}
      <p class="muted">First shot fired to last, using each card's shot order.</p>
    </div>
    <h2>Group, all ${shots.length} shots overlaid</h2>
    <div class="panel">${statsBlock(shots)}</div>` : '<p class="muted">No saved cards match this selection.</p>'}`;
  $('#a-last').addEventListener('change', (e) => { scope.last = e.target.value; showAnalysis(); });
  $('#a-name').addEventListener('change', (e) => { scope.name = e.target.value; showAnalysis(); });
}

// ---------- settings ----------

async function showSettings() {
  const state = await store.persistence();
  const storageNote = {
    persistent: 'Storage is marked persistent, so the browser will not clear it automatically.',
    'best-effort': 'The browser may clear this data if the device runs low on space or the app goes unused. Add the app to your home screen and keep a backup.',
    unsupported: 'This browser cannot guarantee long-term storage. Keep a backup.',
  }[state];
  view.innerHTML = `
    <h2>Scoring</h2>
    <div class="panel">
      <div class="row">
        <label class="field">Gauging<select id="s-gauging">
          <option value="outward" ${settings.gauging === 'outward' ? 'selected' : ''}>Outward (hole must be inside the ring)</option>
          <option value="inward" ${settings.gauging === 'inward' ? 'selected' : ''}>Inward (hole need only touch the ring)</option>
        </select></label>
        <label class="field">Gauge diameter (mm)<input id="s-gauge" type="number" step="0.01" min="4" max="7" value="${settings.gaugeDia}"></label>
      </div>
      <p class="muted">Scores are always worked out from the stored shot positions, so changing these re-scores every saved card.</p>
    </div>
    <h2>Sights</h2>
    <div class="panel">
      <label class="field">Clicks per minute of angle<input id="s-clicks" type="number" step="1" min="1" max="20" value="${Math.round(1 / settings.clickMoa)}"></label>
      <p class="muted">One click moves the shot ${(settings.clickMoa * MOA_MM).toFixed(2)} mm at 25 yards.</p>
    </div>
    <h2>Default shot order</h2>
    <div class="panel">
      <div id="s-order"></div>
      <p class="muted">Used for new scans, and for saved cards that have no order of their own. It can be changed on any individual card.</p>
    </div>
    <h2>Backup</h2>
    <div class="panel">
      <p class="muted">Everything is stored only in this browser on this device. ${storageNote}</p>
      <div class="row">
        <button id="x-full">Backup with photos</button>
        <button id="x-data">Backup data only</button>
        <button id="x-csv">All shots as CSV</button>
        <label class="btn">Restore backup<input id="x-import" type="file" accept="application/json,.json" hidden></label>
      </div>
    </div>`;
  const save = async () => {
    const gauge = Number($('#s-gauge').value);
    const clicks = Number($('#s-clicks').value);
    settings = {
      ...settings,
      gauging: $('#s-gauging').value,
      gaugeDia: gauge >= 4 && gauge <= 7 ? gauge : settings.gaugeDia,
      clickMoa: clicks >= 1 && clicks <= 20 ? 1 / clicks : settings.clickMoa,
    };
    await store.putSettings(settings);
    showSettings();
  };
  for (const id of ['s-gauging', 's-gauge', 's-clicks']) $(`#${id}`).addEventListener('change', save);
  mountOrderPicker($('#s-order'), settings.shotOrder, async (spec) => {
    settings = { ...settings, shotOrder: spec };
    await store.putSettings(settings);
  });
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
      alert(`That backup could not be restored. ${err.message}`);
    }
  });
}

// ---------- routing ----------

async function route() {
  const hash = location.hash || '#/';
  const leavingCard = current && dirty && !hash.startsWith('#/card/');
  if (leavingCard && !confirm('Leave without saving this card?')) {
    history.replaceState(null, '', current.isNew ? '#/card/new' : `#/card/${current.id}`);
    return;
  }
  if (!hash.startsWith('#/card/')) {
    current = null;
    dirty = false;
  }
  $('#editor').hidden = true;
  const tab = hash.startsWith('#/analysis') ? 'analysis' : hash.startsWith('#/settings') ? 'settings' : 'cards';
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  if (hash.startsWith('#/card/')) await showCard(decodeURIComponent(hash.slice(7)));
  else if (tab === 'analysis') await showAnalysis();
  else if (tab === 'settings') await showSettings();
  else await showCards();
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

settings = await store.getSettings();
await route();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
