// On-device storage (IndexedDB): saved cards and settings.

import { DEFAULT_SETTINGS } from './model.js?v=2026.10.12-14';

// Storage name predates the rename to Target Notebook; kept so saved cards carry over.
const DB_NAME = 'targetscan';
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('cards', { keyPath: 'id' });
      req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Newest first.
export async function listCards() {
  const cards = await run('cards', 'readonly', (s) => s.getAll());
  return cards.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
}

export const getCard = (id) => run('cards', 'readonly', (s) => s.get(id));
export const putCard = (card) => run('cards', 'readwrite', (s) => s.put(card));
export const deleteCard = (id) => run('cards', 'readwrite', (s) => s.delete(id));

export async function getSettings() {
  const saved = await run('kv', 'readonly', (s) => s.get('settings'));
  return { ...DEFAULT_SETTINGS, ...saved };
}

export const putSettings = (settings) => run('kv', 'readwrite', (s) => s.put(settings, 'settings'));

// The one rifle's set-up, including its photos (as data URLs).
export const getRifle = () => run('kv', 'readonly', (s) => s.get('rifle'));
export const putRifle = (rifle) => run('kv', 'readwrite', (s) => s.put(rifle, 'rifle'));

export async function exportData({ images }) {
  const cards = await listCards();
  const rifle = await getRifle();
  return {
    app: 'targetscan',
    version: 1,
    card: '2510BM/89-18',
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    cards: images ? cards : cards.map(({ images: _drop, ...rest }) => rest),
    // Rifle photos follow the same choice as card photos.
    rifle: rifle && (images ? rifle : { ...rifle, photos: undefined }),
  };
}

// Merges by id: cards in the file replace cards with the same id.
export async function importData(data) {
  if (data?.app !== 'targetscan' || !Array.isArray(data.cards)) {
    throw new Error('This is not a Target Notebook backup file.');
  }
  let count = 0;
  for (const card of data.cards) {
    if (!card?.id || !Array.isArray(card.shots) || card.shots.length !== 10) continue;
    const existing = await getCard(card.id);
    await putCard({ ...card, images: card.images ?? existing?.images ?? null });
    count++;
  }
  if (data.rifle) {
    const existing = await getRifle();
    await putRifle({ ...data.rifle, photos: data.rifle.photos ?? existing?.photos ?? {} });
  }
  return count;
}

export async function persistence() {
  if (!navigator.storage?.persist) return 'unsupported';
  if (await navigator.storage.persisted()) return 'persistent';
  return (await navigator.storage.persist()) ? 'persistent' : 'best-effort';
}

// How much the saved cards take up. Sizes are measured from the stored data
// itself; `quota` is the browser's own figure for space it will allow, where it gives one.
export async function usage() {
  const cards = await listCards();
  let bytes = 0;
  let photoBytes = 0;
  for (const card of cards) {
    const photos = (card.images ?? []).reduce((n, url) => n + (url?.length ?? 0), 0);
    photoBytes += photos;
    bytes += photos + JSON.stringify({ ...card, images: null }).length;
  }
  const rifle = await getRifle();
  if (rifle) {
    const photos = Object.values(rifle.photos ?? {}).reduce((n, url) => n + (url?.length ?? 0), 0);
    photoBytes += photos;
    bytes += photos + JSON.stringify({ ...rifle, photos: null }).length;
  }
  let quota = null;
  try {
    quota = (await navigator.storage?.estimate?.())?.quota ?? null;
  } catch {
    // Not available in this browser.
  }
  return { cards: cards.length, bytes, photoBytes, quota };
}
