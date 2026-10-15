const express = require('express');
const db = require('../lib/db');
const { newId } = require('../lib/crypto');
const escrow = require('../lib/escrow');
const { readSetting } = require('./settings');

const router = express.Router();

// One-time migration to store the screenshot proof on the order row.
(async () => {
  try {
    const info = await db.prepare('PRAGMA table_info(load_orders)').all();
    const cols = info.map((r) => r.name);
    if (!cols.includes('proof_data_url')) {
      await db.exec('ALTER TABLE load_orders ADD COLUMN proof_data_url TEXT');
    }
    if (!cols.includes('proof_uploaded_at')) {
      await db.exec('ALTER TABLE load_orders ADD COLUMN proof_uploaded_at INTEGER');
    }
  } catch (e) {
    console.warn('[load] proof-column migration failed', e.message);
  }
})();

const MAX_PROOF_BYTES = 400 * 1024; // 400 KB is plenty for a downsized screenshot.

function looksLikeImageDataUrl(s) {
  return typeof s === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s);
}

router.post('/create', async (req, res, next) => {
  try {
    const { userId, amount } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'amount must be positive' });
    }
    const amountPaise = Math.round(amt * 100);
    if (amountPaise % escrow.DENOM_PAISE !== 0) {
      return res.status(400).json({
        error: `amount must be a multiple of ${escrow.DENOM_PAISE / 100}`,
      });
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'user not found' });

    // Federated escrow: look up the user's active escrow (another user who
    // approved to hold their funds). Fall back to the global operator-run
    // escrow if the user hasn't picked a personal escrow yet.
    const escrowRel = require('../lib/escrow_relations');
    const active = await escrowRel.activeEscrowFor(userId);

    let escrowUpiId, escrowName, issuerUserId, issuerUpiId;
    if (active) {
      escrowUpiId  = active.escrowUpiId;
      escrowName   = 'Escrow: ' + active.escrowUpiId;
      issuerUserId = active.escrowUserId;
      issuerUpiId  = active.escrowUpiId;
    } else {
      escrowUpiId = await readSetting('escrow_upi_id');
      if (!escrowUpiId) {
        return res.status(400).json({
          error: 'no_escrow',
          message:
            'You have not chosen an escrow yet. Go to Settings → Choose Escrow and pick a trusted friend first.',
        });
      }
      escrowName   = (await readSetting('escrow_name')) || 'ZeroNetPay Escrow';
      issuerUserId = null;
      issuerUpiId  = escrowUpiId;
    }

    // Make sure the issuer_user_id / issuer_upi_id columns on load_orders exist.
    try {
      const info = await db.prepare('PRAGMA table_info(load_orders)').all();
      const cols = info.map((r) => r.name);
      if (!cols.includes('issuer_user_id')) await db.exec('ALTER TABLE load_orders ADD COLUMN issuer_user_id TEXT');
      if (!cols.includes('issuer_upi_id'))  await db.exec('ALTER TABLE load_orders ADD COLUMN issuer_upi_id TEXT');
    } catch (_) { /* migration best-effort */ }

    const order = {
      id: newId('LOAD'),
      user_id: userId,
      amount_paise: amountPaise,
      status: 'pending',
      created_at: Date.now(),
      issuer_user_id: issuerUserId,
      issuer_upi_id: issuerUpiId,
    };
    await db.prepare(
      `INSERT INTO load_orders
         (id, user_id, amount_paise, status, created_at, issuer_user_id, issuer_upi_id)
         VALUES (@id, @user_id, @amount_paise, @status, @created_at, @issuer_user_id, @issuer_upi_id)`,
    ).run(order);

    const note = 'ZNP ' + order.id.slice(-8);
    const upiLink =
      `upi://pay` +
      `?pa=${encodeURIComponent(escrowUpiId)}` +
      `&pn=${encodeURIComponent(escrowName)}` +
      `&am=${amt.toFixed(2)}` +
      `&cu=INR` +
      `&tn=${encodeURIComponent(note)}` +
      `&tr=${encodeURIComponent(order.id)}`;

    res.json({
      orderId: order.id,
      amount: amt,
      upiLink,
      escrowUpiId,
      escrowName,
      issuerUserId,
      issuerUpiId,
      personalEscrow: !!active,
      note,
      status: 'pending',
    });
  } catch (e) { next(e); }
});

router.post('/confirm', async (req, res, next) => {
  try {
    const { orderId, proofDataUrl } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    // Proof-of-payment: user must upload a screenshot of their UPI success
    // page. This isn't OCR-verified (a real deployment would call the bank
    // webhook), but it (a) creates a paper trail for disputes and (b)
    // discourages users from clicking "mint" without actually paying.
    if (!proofDataUrl) {
      return res.status(400).json({
        error: 'proof_required',
        message: 'Upload a screenshot of the UPI payment success page.',
      });
    }
    if (!looksLikeImageDataUrl(proofDataUrl)) {
      return res.status(400).json({
        error: 'invalid_proof',
        message: 'Screenshot must be a PNG or JPEG image.',
      });
    }
    if (proofDataUrl.length > MAX_PROOF_BYTES) {
      return res.status(413).json({
        error: 'proof_too_large',
        message: 'Screenshot is too large — please try a smaller image.',
      });
    }

    const order = await db.prepare('SELECT * FROM load_orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (order.status === 'completed') {
      return res.status(409).json({ error: 'order already completed' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
    if (!user) return res.status(404).json({ error: 'user not found' });

    // Persist the screenshot BEFORE minting so we always have an audit trail
    // even if token issuance fails partway through.
    await db.prepare(
      `UPDATE load_orders SET proof_data_url = ?, proof_uploaded_at = ? WHERE id = ?`,
    ).run(proofDataUrl, Date.now(), orderId);

    const tokens = await escrow.creditEscrowAndIssueTokens({
      userId: order.user_id,
      deviceId: user.device_id,
      amountPaise: order.amount_paise,
      loadOrderId: order.id,
      issuerUserId: order.issuer_user_id || null,
      issuerUpiId: order.issuer_upi_id || null,
    });

    await db.prepare(
      `UPDATE load_orders
         SET status = 'completed', completed_at = ?, upi_ref = ?
         WHERE id = ?`,
    ).run(Date.now(), `ZNP-LOAD-${Date.now().toString(36).toUpperCase()}`, orderId);

    res.json({
      orderId,
      status: 'completed',
      tokens: tokens.map((t) => ({
        id: t.id,
        value_paise: t.value_paise,
        issued_to_user_id: t.issued_to_user_id,
        issued_to_device: t.issued_to_device,
        issued_at: t.issued_at,
        expires_at: t.expires_at,
        signature: t.signature,                   // HMAC (back-compat)
        signature_ed25519: t.signature_ed25519,   // Ed25519 (offline-verifiable)
        issuer_user_id: t.issuer_user_id || null, // federated: whose escrow holds this
        issuer_upi_id: t.issuer_upi_id || null,
      })),
    });
  } catch (e) { next(e); }
});

router.get('/status/:orderId', async (req, res, next) => {
  try {
    const order = await db.prepare('SELECT * FROM load_orders WHERE id = ?').get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'not found' });
    res.json({ orderId: order.id, status: order.status, amount: order.amount_paise / 100 });
  } catch (e) { next(e); }
});

module.exports = router;
