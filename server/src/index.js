// Target Notebook coach server.
//
// Pupils' apps send their card data here (one way: nothing is sent back to
// them), and the coach reviews it on the dashboard at /coach. The dashboard
// and its data are guarded by Cloudflare Access; this code checks Access's
// signed token as well, so they stay closed even if Access is misconfigured.
//
//   POST /api/register    a device joins the squad (needs the join code)
//   POST /api/cards       a device sends new, changed and deleted cards
//   GET  /coach           the dashboard                      (coach only)
//   GET  /api/coach/data  everything sent                    (coach only)
//   POST /api/coach/device  relabel or remove a device       (coach only)

import dashboard from './dashboard.html';

const MAX_BODY = 1_000_000; // bytes per request
const MAX_CARDS = 100; // cards per request
const MAX_CARD = 40_000; // characters of JSON per card

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/coach') || url.pathname === '/coach' || url.pathname === '/coach/') {
        const who = await coach(request, env);
        if (!who) return text('Sign in through Cloudflare Access to see this page.', 403);
        if (url.pathname.startsWith('/coach')) {
          return new Response(dashboard.replaceAll('%APP_URL%', env.APP_URL), {
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          });
        }
        if (url.pathname === '/api/coach/data' && request.method === 'GET') return json(await everything(env, url));
        if (url.pathname === '/api/coach/device' && request.method === 'POST') return json(await editDevice(env, await body(request)));
        return text('Not found', 404);
      }
      // Pupils' apps, from the app's own web address.
      const cors = corsHeaders(request, env);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (url.pathname === '/api/register' && request.method === 'POST') {
        return json(await register(env, await body(request)), 200, cors);
      }
      if (url.pathname === '/api/cards' && request.method === 'POST') {
        return json(await receive(env, await body(request)), 200, cors);
      }
      if (url.pathname === '/') return text('Target Notebook coach server. The coach\'s dashboard is at /coach.');
      return text('Not found', 404);
    } catch (err) {
      if (err instanceof Refusal) return json({ error: err.message }, err.status, corsHeaders(request, env));
      console.error(err);
      return json({ error: 'Something went wrong on the server.' }, 500, corsHeaders(request, env));
    }
  },
};

class Refusal extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const text = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json' } });

async function body(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Refusal('Too much data in one go.', 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Refusal('That was not valid data.');
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('origin') ?? '';
  const allowed = String(env.APP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' }
    : { vary: 'origin' };
}

const now = () => new Date().toISOString();
const isId = (s) => typeof s === 'string' && /^[\w-]{8,100}$/.test(s);

async function sha256(s) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compares without stopping at the first difference, so timing gives nothing away.
function same(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

// ---------- pupils' apps ----------

async function register(env, { code, deviceId, key, name }) {
  if (!env.JOIN_CODE) throw new Refusal('The coach has not finished setting up the server.', 503);
  if (!same(code, env.JOIN_CODE)) throw new Refusal('That squad code is not right. Ask your coach for a new setup link.', 403);
  if (!isId(deviceId) || typeof key !== 'string' || key.length < 32) throw new Refusal('That was not valid data.');
  const who = cleanName(name);
  if (!who) throw new Refusal('Please enter your name.');
  const hash = await sha256(key);
  const existing = await env.DB.prepare('SELECT key_hash FROM devices WHERE id = ?').bind(deviceId).first();
  if (existing) {
    if (!same(existing.key_hash, hash)) throw new Refusal('This device is already registered.', 403);
    await env.DB.prepare('UPDATE devices SET name = ?, last_seen = ? WHERE id = ?').bind(who, now(), deviceId).run();
  } else {
    await env.DB.prepare('INSERT INTO devices (id, key_hash, name, created_at, last_seen) VALUES (?, ?, ?, ?, ?)')
      .bind(deviceId, hash, who, now(), now()).run();
  }
  return { ok: true };
}

async function device(env, deviceId, key) {
  if (!isId(deviceId) || typeof key !== 'string') throw new Refusal('This device is not set up to send cards.', 401);
  const row = await env.DB.prepare('SELECT key_hash FROM devices WHERE id = ?').bind(deviceId).first();
  if (!row || !same(row.key_hash, await sha256(key))) {
    throw new Refusal('This device is not registered with your coach any more. Set it up again from your coach\'s link.', 401);
  }
}

async function receive(env, { deviceId, key, cards = [], deleted = [] }) {
  await device(env, deviceId, key);
  if (!Array.isArray(cards) || !Array.isArray(deleted) || cards.length + deleted.length > MAX_CARDS) {
    throw new Refusal('Too many cards in one go.');
  }
  const stamp = now();
  const statements = [];
  for (const card of cards) {
    if (!card || !isId(card.id) || !Array.isArray(card.shots)) throw new Refusal('A card was not valid.');
    // Card data only: photos are never kept here, even if one were sent.
    const { images: _photos, ...rest } = card;
    const data = JSON.stringify(rest);
    if (data.length > MAX_CARD) throw new Refusal('A card was too big.');
    statements.push(env.DB.prepare(
      `INSERT INTO cards (device_id, id, data, received_at, deleted) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT (device_id, id) DO UPDATE SET data = excluded.data, received_at = excluded.received_at, deleted = 0`
    ).bind(deviceId, card.id, data, stamp));
  }
  for (const id of deleted) {
    if (!isId(id)) throw new Refusal('A card was not valid.');
    statements.push(env.DB.prepare('UPDATE cards SET deleted = 1, received_at = ? WHERE device_id = ? AND id = ?').bind(stamp, deviceId, id));
  }
  statements.push(env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').bind(stamp, deviceId));
  await env.DB.batch(statements);
  return { ok: true, received: cards.length, deleted: deleted.length };
}

// ---------- the coach ----------

async function everything(env, url) {
  const devices = (await env.DB.prepare('SELECT id, name, pupil, created_at, last_seen FROM devices ORDER BY created_at').all()).results;
  const cards = (await env.DB.prepare('SELECT device_id, data, received_at FROM cards WHERE deleted = 0').all()).results
    .map((r) => ({ deviceId: r.device_id, receivedAt: r.received_at, card: JSON.parse(r.data) }));
  // The link pupils open to join: the app, told where this server is and the squad code.
  const setup = env.JOIN_CODE
    ? `${env.APP_URL}#/coach-setup?server=${encodeURIComponent(url.origin)}&code=${encodeURIComponent(env.JOIN_CODE)}`
    : null;
  return { devices, cards, setup };
}

async function editDevice(env, { id, pupil, remove }) {
  if (!isId(id)) throw new Refusal('Unknown device.');
  if (remove) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM cards WHERE device_id = ?').bind(id),
      env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(id),
    ]);
    return { ok: true };
  }
  const label = cleanName(pupil);
  await env.DB.prepare('UPDATE devices SET pupil = ? WHERE id = ?').bind(label || null, id).run();
  return { ok: true };
}

// Cloudflare Access puts a signed token on every request it lets through.
// Checks its signature, audience, issuer and expiry; anything else is refused.
let certs = null;
async function coach(request, env) {
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return null;
  const cookie = (request.headers.get('cookie') ?? '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  const token = request.headers.get('cf-access-jwt-assertion') ?? cookie;
  if (!token) return null;
  const [h, p, s] = token.split('.');
  if (!s) return null;
  const decode = (part) => JSON.parse(new TextDecoder().decode(b64url(part)));
  let header;
  let payload;
  try {
    header = decode(h);
    payload = decode(p);
  } catch {
    return null;
  }
  const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== issuer || !auds.includes(env.ACCESS_AUD) || !(payload.exp * 1000 > Date.now())) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!certs || attempt) certs = (await (await fetch(`${issuer}/cdn-cgi/access/certs`)).json()).keys ?? [];
    const jwk = certs.find((k) => k.kid === header.kid);
    if (!jwk) continue;
    const pub = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pub, b64url(s), new TextEncoder().encode(`${h}.${p}`));
    return ok ? payload.email ?? 'coach' : null;
  }
  return null;
}

function b64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
