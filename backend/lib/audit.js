// Immutable audit log — every state change appends a row whose hash
// includes the previous row's hash (Merkle-chain style).
//
// If any historical row is tampered with, the chain breaks visibly:
// re-computing hashes from genesis will diverge from the stored hash
// on the first mutated row forward.
//
// Rows:
//   id         INTEGER PK AUTOINCREMENT
//   ts         INTEGER NOT NULL     (ms epoch)
//   actor      TEXT                 (user id, device id, "system", "operator")
//   action     TEXT NOT NULL        (e.g. mint, redeem, disburse, complaint)
//   data_json  TEXT NOT NULL        (JSON of the event)
//   prev_hash  TEXT NOT NULL        (previous row's hash, or GENESIS)
//   hash       TEXT NOT NULL        (sha256(prev_hash + canonical_json))
//
// Published via GET /api/audit/log (last 200 rows + current root hash)
// and GET /api/audit/verify (recomputes chain, returns ok|broken+id).

const crypto = require('crypto');
const db = require('./db');

const GENESIS = '0'.repeat(64);

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Canonical JSON — sorted keys so hashes are reproducible across
// implementations.
function canonicalise(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalise).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalise(value[k])).join(',') + '}';
}

async function ensureSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         INTEGER NOT NULL,
      actor      TEXT,
      action     TEXT NOT NULL,
      data_json  TEXT NOT NULL,
      prev_hash  TEXT NOT NULL,
      hash       TEXT NOT NULL
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts)`);
}

// Fire-and-forget schema init. Callers that need the table can await
// `audit.ready` before their first append, but all appends also await.
const ready = ensureSchema().catch((e) => {
  console.warn('[audit] schema init failed', e.message);
});

async function append(action, data, actor = 'system') {
  await ready;
  const ts = Date.now();
  const last = await db
    .prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1')
    .get();
  const prev = last ? last.hash : GENESIS;
  const payload = canonicalise({ ts, actor, action, data: data || null });
  const hash = sha256Hex(prev + payload);
  await db.prepare(
    `INSERT INTO audit_log (ts, actor, action, data_json, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(ts, actor || null, action, payload, prev, hash);
  return { ts, actor, action, hash, prev_hash: prev };
}

async function tail(limit = 200) {
  await ready;
  const rows = await db
    .prepare(
      `SELECT id, ts, actor, action, data_json, prev_hash, hash
         FROM audit_log ORDER BY id DESC LIMIT ?`,
    )
    .all(limit);
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    actor: r.actor,
    action: r.action,
    data: safeParse(r.data_json),
    prevHash: r.prev_hash,
    hash: r.hash,
  }));
}

async function rootHash() {
  await ready;
  const row = await db
    .prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1')
    .get();
  return row ? row.hash : GENESIS;
}

async function verifyChain() {
  await ready;
  const rows = await db
    .prepare(
      `SELECT id, data_json, prev_hash, hash FROM audit_log ORDER BY id ASC`,
    )
    .all();
  let expectedPrev = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== expectedPrev) {
      return { ok: false, brokenAtId: r.id, reason: 'prev_hash_mismatch' };
    }
    const want = sha256Hex(r.prev_hash + r.data_json);
    if (want !== r.hash) {
      return { ok: false, brokenAtId: r.id, reason: 'hash_mismatch' };
    }
    expectedPrev = r.hash;
  }
  return { ok: true, rows: rows.length, rootHash: expectedPrev };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return s; }
}

module.exports = { append, tail, rootHash, verifyChain, ready, canonicalise };
