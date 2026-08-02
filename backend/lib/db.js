// Persistent SQL layer backed by Turso (libsql).
//
// Turso's free tier gives us hosted, always-on, replicated SQLite.
// No experimental flags, no compilation, and — crucially — no data
// loss when Render (or any container host) restarts.
//
// The exported API mirrors the previous node:sqlite one but every
// method is async. Callers must `await` .get / .all / .run and use
// `await db.transaction(fn)`.

const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');
const config = require('./config');

// Local fallback for `npm run dev` — a plain SQLite file so you can
// hack without Turso creds.  Production must set TURSO_DATABASE_URL.
const REMOTE_URL = (process.env.TURSO_DATABASE_URL || '').trim();
const REMOTE_TOKEN = (process.env.TURSO_AUTH_TOKEN || '').trim();
const useRemote = REMOTE_URL.startsWith('libsql://') || REMOTE_URL.startsWith('http');

let client;
if (useRemote) {
  client = createClient({
    url: REMOTE_URL,
    authToken: REMOTE_TOKEN || undefined,
  });
  console.log('[db] using remote libsql at', REMOTE_URL.split('?')[0]);
} else {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  client = createClient({ url: 'file:' + config.dbPath });
  console.log('[db] using local sqlite at', config.dbPath);
}

function normaliseValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

// Convert positional-object args to libsql's { sql, args } shape.
function buildStmt(sql, params) {
  if (params.length === 0) return { sql };
  if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])) {
    // Named-parameter object — convert @name / $name / :name to positional ?
    const obj = params[0];
    const argMap = {};
    for (const k of Object.keys(obj)) argMap[k] = normaliseValue(obj[k]);
    // Replace @name / :name / $name with :name (libsql supports :name)
    const rewrittenSql = sql.replace(/[@$](\w+)/g, ':$1');
    return { sql: rewrittenSql, args: argMap };
  }
  return { sql, args: params.map(normaliseValue) };
}

async function run(sql, ...params) {
  const stmt = buildStmt(sql, params);
  const r = await client.execute(stmt);
  return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid };
}

async function get(sql, ...params) {
  const stmt = buildStmt(sql, params);
  const r = await client.execute(stmt);
  if (!r.rows || r.rows.length === 0) return undefined;
  return normaliseRow(r.rows[0], r.columns);
}

async function all(sql, ...params) {
  const stmt = buildStmt(sql, params);
  const r = await client.execute(stmt);
  return (r.rows || []).map((row) => normaliseRow(row, r.columns));
}

// libsql returns rows as arrays with named .columnName accessors; we
// unpack them into plain objects to match node:sqlite's behaviour.
function normaliseRow(row, columns) {
  if (!row) return null;
  const out = {};
  for (const col of columns || Object.keys(row)) {
    out[col] = row[col];
  }
  return out;
}

/**
 * Batched schema init. libsql's execute() runs one statement at a time,
 * so we split multi-statement DDL by ';'.
 */
async function exec(sql) {
  const parts = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length);
  for (const p of parts) await client.execute(p);
}

/**
 * Transaction wrapper. Uses libsql's transaction API.
 * The fn receives the raw client-tx object so callers can `await tx.execute(...)`
 * — but for our purposes we expose the same run/get/all helpers on `tx`.
 */
async function transaction(fn) {
  const tx = await client.transaction('write');
  try {
    const scoped = {
      run: async (sql, ...p) => {
        const r = await tx.execute(buildStmt(sql, p));
        return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid };
      },
      get: async (sql, ...p) => {
        const r = await tx.execute(buildStmt(sql, p));
        return r.rows[0] ? normaliseRow(r.rows[0], r.columns) : undefined;
      },
      all: async (sql, ...p) => {
        const r = await tx.execute(buildStmt(sql, p));
        return r.rows.map((row) => normaliseRow(row, r.columns));
      },
    };
    const result = await fn(scoped);
    await tx.commit();
    return result;
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* swallow */ }
    throw e;
  }
}

// Backwards-compat: keep the .prepare(sql).run/.get/.all shape so we
// don't have to touch every callsite. Each method now returns a promise.
function prepare(sql) {
  return {
    run: (...p) => run(sql, ...p),
    get: (...p) => get(sql, ...p),
    all: (...p) => all(sql, ...p),
  };
}

const db = { run, get, all, exec, transaction, prepare, _client: client };

/**
 * One-shot async schema bootstrap. Must be awaited by server.js before
 * routes start handling traffic.
 */
async function init() {
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      upi_id      TEXT NOT NULL,
      device_id   TEXT NOT NULL,
      public_key  TEXT,
      created_at  INTEGER NOT NULL
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS escrow_account (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      bank_name     TEXT NOT NULL,
      balance_paise INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS load_orders (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id),
      amount_paise    INTEGER NOT NULL,
      status          TEXT NOT NULL,
      upi_ref         TEXT,
      created_at      INTEGER NOT NULL,
      completed_at    INTEGER
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_load_orders_user ON load_orders(user_id)`);

  await exec(`
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
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_tokens_issued ON tokens(issued_to_user_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_tokens_spent ON tokens(spent)`);

  await exec(`
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
      disbursed_ref   TEXT,
      complaint_raised INTEGER NOT NULL DEFAULT 0,
      complaint_at    INTEGER,
      complaint_note  TEXT
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_settlements_receiver ON settlements(receiver_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_settlements_disbursed ON settlements(disbursed)`);

  await exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at INTEGER NOT NULL
    )
  `);

  // Seed the singleton escrow row.
  await run(
    `INSERT OR IGNORE INTO escrow_account (id, bank_name, balance_paise, updated_at)
     VALUES (1, ?, 0, ?)`,
    config.escrowBankName,
    Date.now(),
  );

  // Migrations for columns added after first release. libsql supports
  // information_schema-style queries via pragma; safer to try-catch.
  for (const spec of [
    ['settlements', 'disbursed', 'INTEGER NOT NULL DEFAULT 0'],
    ['settlements', 'disbursed_at', 'INTEGER'],
    ['settlements', 'disbursed_ref', 'TEXT'],
    ['settlements', 'complaint_raised', 'INTEGER NOT NULL DEFAULT 0'],
    ['settlements', 'complaint_at', 'INTEGER'],
    ['settlements', 'complaint_note', 'TEXT'],
  ]) {
    const [table, col, def] = spec;
    try {
      await exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch (_) {
      // Column already exists — ignore.
    }
  }
}

db.init = init;
module.exports = db;
