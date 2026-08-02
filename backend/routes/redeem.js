const express = require('express');
const db = require('../lib/db');
const { verifyToken } = require('../lib/crypto');
const escrow = require('../lib/escrow');

const router = express.Router();

/**
 * Settlement endpoint. The merchant device calls this when it next
 * has internet, posting all tokens it accepted offline. The server
 * verifies signatures, checks each is unspent and not expired, marks
 * them spent, and credits the merchant's UPI account from escrow.
 *
 * Failures are itemised — partial settlement is supported, so a single
 * rejected token does not block the rest.
 */
router.post('/redeem', (req, res) => {
  const { receiverId, tokens, senderDevice } = req.body || {};
  if (!receiverId) return res.status(400).json({ error: 'receiverId required' });
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return res.status(400).json({ error: 'tokens array required' });
  }

  const receiver = db.prepare('SELECT * FROM users WHERE id = ?').get(receiverId);
  if (!receiver) return res.status(404).json({ error: 'receiver not found' });

  const now = Date.now();
  const accepted = [];
  const rejected = [];

  for (const t of tokens) {
    if (!t || !t.id || typeof t.signature !== 'string') {
      rejected.push({ id: t && t.id, reason: 'malformed' });
      continue;
    }
    const stored = db.prepare('SELECT * FROM tokens WHERE id = ?').get(t.id);
    if (!stored) {
      rejected.push({ id: t.id, reason: 'unknown_token' });
      continue;
    }
    if (stored.spent) {
      rejected.push({ id: t.id, reason: 'already_spent' });
      continue;
    }
    if (stored.expires_at < now) {
      rejected.push({ id: t.id, reason: 'expired' });
      continue;
    }
    const valid = verifyToken(
      {
        id: stored.id,
        value_paise: stored.value_paise,
        issued_to_user_id: stored.issued_to_user_id,
        issued_to_device: stored.issued_to_device,
        issued_at: stored.issued_at,
        expires_at: stored.expires_at,
      },
      stored.signature,
    );
    if (!valid) {
      rejected.push({ id: t.id, reason: 'bad_signature' });
      continue;
    }
    if (t.signature !== stored.signature) {
      rejected.push({ id: t.id, reason: 'signature_mismatch' });
      continue;
    }
    accepted.push({
      id: stored.id,
      value_paise: stored.value_paise,
    });
  }

  let settlement = null;
  if (accepted.length > 0) {
    settlement = escrow.debitEscrowAndSettle({
      receiverId,
      tokens: accepted,
      senderDevice,
    });
  }

  res.json({
    accepted: accepted.map((a) => a.id),
    rejected,
    settlement,
    creditAmount: accepted.reduce((s, a) => s + a.value_paise, 0) / 100,
    upiId: receiver.upi_id,
  });
});

/**
 * Receiver-side helper: lightweight pre-flight check before going online.
 * Lets the merchant app show a confidence indicator ("verified by server"
 * vs "pending") without committing the redemption.
 */
router.post('/preflight', (req, res) => {
  const { tokens } = req.body || {};
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return res.status(400).json({ error: 'tokens array required' });
  }
  const now = Date.now();
  const result = tokens.map((t) => {
    if (!t || !t.id) return { id: null, status: 'malformed' };
    const stored = db.prepare('SELECT spent, expires_at FROM tokens WHERE id = ?').get(t.id);
    if (!stored) return { id: t.id, status: 'unknown' };
    if (stored.spent) return { id: t.id, status: 'spent' };
    if (stored.expires_at < now) return { id: t.id, status: 'expired' };
    return { id: t.id, status: 'valid' };
  });
  res.json({ result });
});

module.exports = router;
