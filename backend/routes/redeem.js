const express = require('express');
const db = require('../lib/db');
const { verifyToken } = require('../lib/crypto');
const escrow = require('../lib/escrow');

const router = express.Router();

router.post('/redeem', async (req, res, next) => {
  try {
    const { receiverId, tokens, senderDevice } = req.body || {};
    if (!receiverId) return res.status(400).json({ error: 'receiverId required' });
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ error: 'tokens array required' });
    }

    const receiver = await db.prepare('SELECT * FROM users WHERE id = ?').get(receiverId);
    if (!receiver) return res.status(404).json({ error: 'receiver not found' });

    const now = Date.now();
    const accepted = [];
    const rejected = [];

    for (const t of tokens) {
      if (!t || !t.id || typeof t.signature !== 'string') {
        rejected.push({ id: t && t.id, reason: 'malformed' });
        continue;
      }
      const stored = await db.prepare('SELECT * FROM tokens WHERE id = ?').get(t.id);
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
      accepted.push({ id: stored.id, value_paise: stored.value_paise });
    }

    let settlement = null;
    if (accepted.length > 0) {
      settlement = await escrow.debitEscrowAndSettle({
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
  } catch (e) { next(e); }
});

router.post('/preflight', async (req, res, next) => {
  try {
    const { tokens } = req.body || {};
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({ error: 'tokens array required' });
    }
    const now = Date.now();
    const result = [];
    for (const t of tokens) {
      if (!t || !t.id) { result.push({ id: null, status: 'malformed' }); continue; }
      const stored = await db.prepare('SELECT spent, expires_at FROM tokens WHERE id = ?').get(t.id);
      if (!stored) { result.push({ id: t.id, status: 'unknown' }); continue; }
      if (stored.spent) { result.push({ id: t.id, status: 'spent' }); continue; }
      if (stored.expires_at < now) { result.push({ id: t.id, status: 'expired' }); continue; }
      result.push({ id: t.id, status: 'valid' });
    }
    res.json({ result });
  } catch (e) { next(e); }
});

module.exports = router;
