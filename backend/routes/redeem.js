const express = require('express');
const db = require('../lib/db');
const { verifyToken } = require('../lib/crypto');
const { verifyTokenEd25519 } = require('../lib/signing');
const velocity = require('../lib/velocity');
const { setFrozen } = require('../lib/security');
const audit = require('../lib/audit');
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

    // Pre-flight velocity check — before touching any tokens.
    const totalIncoming = tokens.reduce((s, t) => s + (t.value_paise || 0), 0);
    const vel = velocity.check({
      deviceId: senderDevice,
      userId: receiverId,
      tokenCount: tokens.length,
      totalPaise: totalIncoming,
    });
    if (!vel.ok) {
      return res.status(429).json({
        error: vel.reason,
        message: vel.message,
        retryAfter: vel.retryAfter,
      });
    }

    const now = Date.now();
    const accepted = [];
    const rejected = [];
    let honeyTripped = false;

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

      // Honeytoken trap — ids prefixed "HONEY_" are canary tokens
      // minted by the operator. Any redeem attempt is definitive proof
      // of wallet exfiltration. Freeze the system.
      if (typeof stored.id === 'string' && stored.id.startsWith('HONEY_')) {
        honeyTripped = true;
        rejected.push({ id: t.id, reason: 'honeytoken_tripped' });
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

      const canonical = {
        id: stored.id,
        value_paise: stored.value_paise,
        issued_to_user_id: stored.issued_to_user_id,
        issued_to_device: stored.issued_to_device,
        issued_at: stored.issued_at,
        expires_at: stored.expires_at,
      };

      // Primary: HMAC (always set).
      if (!verifyToken(canonical, stored.signature)) {
        rejected.push({ id: t.id, reason: 'bad_signature' });
        continue;
      }
      if (t.signature !== stored.signature) {
        rejected.push({ id: t.id, reason: 'signature_mismatch' });
        continue;
      }
      // Secondary: Ed25519 if present (new tokens have it; legacy don't).
      if (stored.signature_ed25519) {
        if (!verifyTokenEd25519(canonical, stored.signature_ed25519)) {
          rejected.push({ id: t.id, reason: 'bad_ed25519_signature' });
          continue;
        }
      }

      accepted.push({
        id: stored.id,
        value_paise: stored.value_paise,
        issuer_user_id: stored.issuer_user_id || null,
        issuer_upi_id: stored.issuer_upi_id || null,
      });
    }

    if (honeyTripped) {
      try {
        await setFrozen(true);
        await audit.append('honeytoken_tripped', {
          receiverId, senderDevice, triggeredIds: rejected.filter((r) => r.reason === 'honeytoken_tripped').map((r) => r.id),
        }, 'system');
      } catch (_) { /* non-fatal */ }
      return res.status(423).json({
        error: 'honeytoken_tripped',
        message: 'Suspicious activity detected — system frozen. Contact the operator.',
      });
    }

    let settlement = null;
    if (accepted.length > 0) {
      settlement = await escrow.debitEscrowAndSettle({
        receiverId,
        tokens: accepted,
        senderDevice,
      });
      velocity.record({
        deviceId: senderDevice,
        userId: receiverId,
        totalPaise: accepted.reduce((s, a) => s + a.value_paise, 0),
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
      const stored = await db.prepare('SELECT spent, expires_at, load_order_id FROM tokens WHERE id = ?').get(t.id);
      if (!stored) { result.push({ id: t.id, status: 'unknown' }); continue; }
      if (typeof t.id === 'string' && t.id.startsWith('HONEY_')) { result.push({ id: t.id, status: 'honeytoken' }); continue; }
      if (stored.spent) { result.push({ id: t.id, status: 'spent' }); continue; }
      if (stored.expires_at < now) { result.push({ id: t.id, status: 'expired' }); continue; }
      result.push({ id: t.id, status: 'valid' });
    }
    res.json({ result });
  } catch (e) { next(e); }
});

module.exports = router;
