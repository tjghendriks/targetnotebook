-- Target Notebook coach server: what pupils' apps have sent.
-- Apply with: npx wrangler d1 execute targetnotebook-coach --remote --file=schema.sql

-- One row per phone or tablet that has joined the squad.
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,          -- random id made by the app
  key_hash TEXT NOT NULL,       -- SHA-256 of the device's secret key (the key itself is never stored)
  name TEXT NOT NULL,           -- the name the pupil typed
  pupil TEXT,                   -- the coach's own label, to group a pupil's devices; null means use name
  created_at TEXT NOT NULL,
  last_seen TEXT
);

-- The latest copy of each card a device has sent. Photos are never sent.
CREATE TABLE IF NOT EXISTS cards (
  device_id TEXT NOT NULL,
  id TEXT NOT NULL,             -- the card's own id in the app
  data TEXT NOT NULL,           -- the card as JSON
  received_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,  -- 1 once the pupil has deleted it
  PRIMARY KEY (device_id, id)
);
