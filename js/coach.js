// Sending cards to a coach's server. One way only: the app sends card data
// (never photos) and the server keeps the latest copy of each card. Nothing
// here runs unless the pupil has joined a squad from their coach's link.

import * as store from './store.js?v=2026.11.25-1';

// A short fingerprint of a card's data, to tell which cards have changed since they were sent.
function fingerprint(card) {
  const { images: _photos, ...data } = card;
  const s = JSON.stringify(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

const randomKey = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

// The squad this device has joined, or null.
export const link = () => store.getCoach();

// Reads a setup link's details: #/coach-setup?server=...&code=...
export function setupFrom(hash) {
  const query = new URLSearchParams(hash.split('?')[1] ?? '');
  const server = query.get('server');
  const code = query.get('code');
  try {
    const url = new URL(server);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return null;
    return code ? { server: url.origin, code } : null;
  } catch {
    return null;
  }
}

async function call(server, path, body) {
  let res;
  try {
    res = await fetch(`${server}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach your coach\'s server. Check you are online and try again.');
  }
  const reply = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(reply.error ?? `Your coach's server said no (${res.status}).`);
  return reply;
}

// Joins the squad: registers this device under the pupil's name.
export async function join({ server, code }, name) {
  const existing = await store.getCoach();
  // Joining again (after the coach removed this device, say) sends every card again.
  const me = existing?.server === server
    ? { ...existing, code, name, sent: {} }
    : { server, code, name, deviceId: store.newId(), key: randomKey(), auto: true, sent: {} };
  await call(server, '/api/register', { code, deviceId: me.deviceId, key: me.key, name });
  await store.putCoach(me);
  return me;
}

export const leave = () => store.putCoach(null);

export async function setAuto(auto) {
  const me = await store.getCoach();
  if (me) await store.putCoach({ ...me, auto });
}

// Cards new or changed since they were last sent, and ids of sent cards since deleted.
export async function pending() {
  const me = await store.getCoach();
  if (!me) return { cards: [], deleted: [] };
  const cards = await store.listCards();
  const sent = me.sent ?? {};
  return {
    cards: cards.filter((c) => sent[c.id] !== fingerprint(c)),
    deleted: Object.keys(sent).filter((id) => !cards.some((c) => c.id === id)),
  };
}

let sending = null;

// Sends everything not yet sent. Returns how many cards went, or throws with a message to show.
export function send() {
  sending ??= (async () => {
    try {
      const me = await store.getCoach();
      if (!me) return 0;
      const { cards, deleted } = await pending();
      const sent = { ...(me.sent ?? {}) };
      // A few at a time, recording each batch as it is accepted.
      for (let i = 0; i < Math.max(cards.length, deleted.length ? 1 : 0); i += 25) {
        const batch = cards.slice(i, i + 25);
        const gone = i === 0 ? deleted : [];
        await call(me.server, '/api/cards', {
          deviceId: me.deviceId,
          key: me.key,
          cards: batch.map(({ images: _photos, ...data }) => data),
          deleted: gone,
        });
        for (const c of batch) sent[c.id] = fingerprint(c);
        for (const id of gone) delete sent[id];
        await store.putCoach({ ...(await store.getCoach()), sent, lastSent: new Date().toISOString() });
      }
      return cards.length;
    } finally {
      sending = null;
    }
  })();
  return sending;
}

// Sends quietly in the background when automatic sending is on. Failures are
// left for the next try (or the Send button), which picks up whatever is left.
export async function sendIfAuto() {
  const me = await store.getCoach();
  if (!me?.auto || !navigator.onLine) return 0;
  return send().catch(() => 0);
}
