const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const raw = new DatabaseSync(config.dbPath);
raw.exec('PRAGMA journal_mode = WAL');
raw.exec('PRAGMA foreign_keys = ON');
raw.exec('PRAGMA busy_timeout = 5000');

raw.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    upi_id      TEXT NOT NULL,
    device_id   TEXT NOT NULL,
    public_key  TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id);

  CREATE TABLE IF NOT EXISTS escrow_account (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    bank_name     TEXT NOT NULL,
    balance_paise INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS load_orders (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    amount_paise    INTEGER NOT NULL,
    status          TEXT NOT NULL,
    upi_ref         TEXT,
    created_at      INTEGER NOT NULL,
    completed_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_load_orders_user ON load_orders(user_id);

  CREATE TABLE IF NOT EXISTS tokens (
    id                 TEXT PRIMARY KEY,
    value_paise        INTEGER NOT NULL,
    issued_to_user_id  TEXT NOT NULL REFERENCES users(id),
    issued_to_device   TEXT NOT NULL,
    issued_at          INTEGER NOT NULL,
    expires_at         INTEGER NOT NULL,
    signature          TEXT NOT NULL,
    spent              INTEGER NOT NULL DEFAULT 0,
    spent_at           INTEGER,
    spent_by_user_id   TEXT REFERENCES users(id),
    load_order_id      TEXT REFERENCES load_orders(id)
  );
  CREATE INDEX IF NOT EXISTS idx_tokens_issued ON tokens(issued_to_user_id);
  CREATE INDEX IF NOT EXISTS idx_tokens_spent ON tokens(spent);

  CREATE TABLE IF NOT EXISTS settlements (
    id              TEXT PRIMARY KEY,
    receiver_id     TEXT NOT NULL REFERENCES users(id),
    sender_device   TEXT,
    token_count     INTEGER NOT NULL,
    amount_paise    INTEGER NOT NULL,
    upi_ref         TEXT,
    created_at      INTEGER NOT NULL,
    disbursed       INTEGER NOT NULL DEFAULT 0,
    disbursed_at    INTEGER,
    disbursed_ref   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_settlements_receiver ON settlements(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_settlements_disbursed ON settlements(disbursed);

  CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at INTEGER NOT NULL
  );
`);

// Seed the singleton escrow row
raw.prepare(
  `INSERT OR IGNORE INTO escrow_account (id, bank_name, balance_paise, updated_at)
   VALUES (1, ?, 0, ?)`,
).run(config.escrowBankName, Date.now());

// --- Migrations ---
function columnExists(table, col) {
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === col);
}
function ensureColumn(table, col, definition) {
  if (!columnExists(table, col)) {
    raw.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
  }
}
ensureColumn('settlements', 'disbursed', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('settlements', 'disbursed_at', 'INTEGER');
ensureColumn('settlements', 'disbursed_ref', 'TEXT');

function normaliseValue(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

function normaliseArgs(args) {
  return args.map((a) => {
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      const out = {};
      for (const k of Object.keys(a)) out[k] = normaliseValue(a[k]);
      return out;
    }
    return normaliseValue(a);
  });
}

function adaptStatement(stmt) {
  return {
    run: (...args) => stmt.run(...normaliseArgs(args)),
    get: (...args) => stmt.get(...normaliseArgs(args)),
    all: (...args) => stmt.all(...normaliseArgs(args)),
  };
}

const db = {
  prepare(sql) {
    return adaptStatement(raw.prepare(sql));
  },
  exec(sql) {
    raw.exec(sql);
  },
  pragma(p) {
    raw.exec('PRAGMA ' + p);
  },
  transaction(fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const r = fn(...args);
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        try { raw.exec('ROLLBACK'); } catch (_) { /* swallow rollback errors */ }
        throw e;
      }
    };
  },
};

module.exports = db;
