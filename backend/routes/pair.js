const express = require('express');

const router = express.Router();

// In-memory pairing store — a temporary rendezvous where the sender's
// signed token payload lives for up to 5 minutes so the receiver can
// pick it up with a short 6-digit code. Not persisted (that's fine —
// codes are short-lived by design).
//
// Shape: Map<code, { payload, expiresAt }>
const store = new Map();

function newCode() {
  // 6 digits, never starts with 0 to avoid confusion, avoid collisions
  // by generating up to 10 attempts.
  for (let i = 0; i < 10; i++) {
    const c = String(100000 + Math.floor(Math.random() * 900000));
    if (!store.has(c)) return c;
  }
  // Extremely unlikely — collision after 10 tries — fall back to 7 digits.
  return String(1000000 + Math.floor(Math.random() * 9000000));
}

// Purge expired codes every minute.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.expiresAt < now) store.delete(k);
  }
}, 60_000).unref?.();

const TTL_MS = 5 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 200 * 1024; // 200 KB max

router.post('/create', (req, res) => {
  const { payload } = req.body || {};
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'payload object required' });
  }
  const serialised = JSON.stringify(payload);
  if (serialised.length > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: 'payload too large' });
  }
  if (!Array.isArray(payload.tokens) || payload.tokens.length === 0) {
    return res.status(400).json({ error: 'payload.tokens must be a non-empty array' });
  }
  const code = newCode();
  const expiresAt = Date.now() + TTL_MS;
  store.set(code, { payload, expiresAt });
  res.json({ code, expiresAt, ttlMs: TTL_MS });
});

router.get('/:code', (req, res) => {
  const code = String(req.params.code || '').replace(/\D/g, '');
  const entry = store.get(code);
  if (!entry) return res.status(404).json({ error: 'code_not_found' });
  if (entry.expiresAt < Date.now()) {
    store.delete(code);
    return res.status(410).json({ error: 'code_expired' });
  }
  res.json({ payload: entry.payload, expiresAt: entry.expiresAt });
});

// One-shot delete after successful redemption so nobody else can pick
// up the same payload with the same code.
router.delete('/:code', (req, res) => {
  const code = String(req.params.code || '').replace(/\D/g, '');
  store.delete(code);
  res.json({ ok: true });
});

module.exports = router;
