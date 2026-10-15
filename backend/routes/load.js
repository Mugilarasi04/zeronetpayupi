const express = require('express');
const db = require('../lib/db');
const { newId } = require('../lib/crypto');
const escrow = require('../lib/escrow');
const { readSetting } = require('./settings');

const router = express.Router();

// One-time migration to store proof-of-payment on the order row.
// Historic columns (proof_data_url / proof_uploaded_at) are kept for backward
// compat with any legacy screenshot flows; new flows use utr + confirmation_*.
(async () => {
  try {
    const info = await db.prepare('PRAGMA table_info(load_orders)').all();
    const cols = info.map((r) => r.name);
    if (!cols.includes('proof_data_url'))      await db.exec('ALTER TABLE load_orders ADD COLUMN proof_data_url TEXT');
    if (!cols.includes('proof_uploaded_at'))   await db.exec('ALTER TABLE load_orders ADD COLUMN proof_uploaded_at INTEGER');
    if (!cols.includes('utr'))                 await db.exec('ALTER TABLE load_orders ADD COLUMN utr TEXT');
    if (!cols.includes('utr_note'))            await db.exec('ALTER TABLE load_orders ADD COLUMN utr_note TEXT');
    if (!cols.includes('utr_submitted_at'))    await db.exec('ALTER TABLE load_orders ADD COLUMN utr_submitted_at INTEGER');
    if (!cols.includes('confirmed_by'))        await db.exec('ALTER TABLE load_orders ADD COLUMN confirmed_by TEXT');
    if (!cols.includes('confirmed_at'))        await db.exec('ALTER TABLE load_orders ADD COLUMN confirmed_at INTEGER');
    if (!cols.includes('rejected_at'))         await db.exec('ALTER TABLE load_orders ADD COLUMN rejected_at INTEGER');
    if (!cols.includes('rejection_reason'))    await db.exec('ALTER TABLE load_orders ADD COLUMN rejection_reason TEXT');
  } catch (e) {
    console.warn('[load] column migration failed', e.message);
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

    // When completed, hand back the minted tokens so Alice's wallet can pick
    // them up after Bob confirms. The signature_ed25519 column exists on
    // every token minted after the dual-sign migration.
    let tokens = [];
    if (order.status === 'completed') {
      const rows = await db.prepare(
        `SELECT id, value_paise, issued_to_user_id, issued_to_device, issued_at,
                expires_at, signature, signature_ed25519,
                issuer_user_id, issuer_upi_id, load_order_id
           FROM tokens WHERE load_order_id = ? ORDER BY issued_at ASC`,
      ).all(order.id);
      tokens = rows;
    }

    res.json({
      orderId: order.id,
      status: order.status,
      amount: order.amount_paise / 100,
      utr: order.utr || null,
      utrNote: order.utr_note || null,
      utrSubmittedAt: order.utr_submitted_at || null,
      confirmedAt: order.confirmed_at || null,
      confirmedBy: order.confirmed_by || null,
      rejectedAt: order.rejected_at || null,
      rejectionReason: order.rejection_reason || null,
      issuerUserId: order.issuer_user_id || null,
      issuerUpiId: order.issuer_upi_id || null,
      tokens,
    });
  } catch (e) { next(e); }
});

// Alice submits the UTR (12-digit UPI reference number from her bank SMS)
// after paying. The order moves to 'awaiting_confirmation'. Bob — the issuer
// — then checks his bank app and either confirms or rejects.
router.post('/:orderId/submit-utr', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { utr, note } = req.body || {};
    if (!utr) return res.status(400).json({ error: 'utr required' });

    // UPI UTR / RRN: 12 digits (NPCI/UPI reference). Accept 10–22 digits/alphanum
    // because some banks pad with letters, and old test demos use shorter refs.
    const trimmedUtr = String(utr).trim();
    if (!/^[A-Za-z0-9]{6,32}$/.test(trimmedUtr)) {
      return res.status(400).json({
        error: 'invalid_utr',
        message: 'UPI reference must be 6–32 digits/letters.',
      });
    }

    const order = await db.prepare('SELECT * FROM load_orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (order.status === 'completed') {
      return res.status(409).json({ error: 'order already completed' });
    }
    if (order.status === 'rejected') {
      return res.status(409).json({ error: 'order was rejected — create a new one' });
    }

    await db.prepare(
      `UPDATE load_orders
         SET status = 'awaiting_confirmation', utr = ?, utr_note = ?, utr_submitted_at = ?,
             rejected_at = NULL, rejection_reason = NULL
         WHERE id = ?`,
    ).run(trimmedUtr, (note || '').toString().slice(0, 200) || null, Date.now(), orderId);

    // Pull the issuer so the frontend can WhatsApp them.
    let issuer = null;
    if (order.issuer_user_id) {
      const u = await db.prepare('SELECT id, upi_id, phone FROM users WHERE id = ?').get(order.issuer_user_id);
      if (u) issuer = { id: u.id, upiId: u.upi_id, phone: u.phone };
    }
    res.json({
      orderId,
      status: 'awaiting_confirmation',
      utr: trimmedUtr,
      issuer, // may be null if this is the global/default escrow (admin confirms)
    });
  } catch (e) { next(e); }
});

// Bob (the issuer) confirms he received Alice's payment and mints her tokens.
router.post('/:orderId/confirm', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { approverUserId } = req.body || {};
    if (!approverUserId) return res.status(400).json({ error: 'approverUserId required' });

    const order = await db.prepare('SELECT * FROM load_orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (order.status === 'completed') {
      return res.status(409).json({ error: 'order already completed' });
    }
    if (order.status !== 'awaiting_confirmation') {
      return res.status(400).json({
        error: 'not_awaiting_confirmation',
        message: 'Alice has not submitted a UPI reference yet.',
      });
    }
    // Only the issuer (Bob) — or an admin via screenshot flow — may confirm.
    if (order.issuer_user_id && order.issuer_user_id !== approverUserId) {
      return res.status(403).json({ error: 'only the escrow user can confirm' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
    if (!user) return res.status(404).json({ error: 'load user not found' });

    const tokens = await escrow.creditEscrowAndIssueTokens({
      userId: order.user_id,
      deviceId: user.device_id,
      amountPaise: order.amount_paise,
      loadOrderId: order.id,
      issuerUserId: order.issuer_user_id || null,
      issuerUpiId: order.issuer_upi_id || null,
    });

    const now = Date.now();
    await db.prepare(
      `UPDATE load_orders
         SET status = 'completed', completed_at = ?, upi_ref = ?,
             confirmed_by = ?, confirmed_at = ?
         WHERE id = ?`,
    ).run(now, order.utr || `ZNP-LOAD-${now.toString(36).toUpperCase()}`,
          approverUserId, now, orderId);

    res.json({
      orderId,
      status: 'completed',
      confirmedBy: approverUserId,
      tokens: tokens.map((t) => ({
        id: t.id, value_paise: t.value_paise,
        issued_to_user_id: t.issued_to_user_id, issued_to_device: t.issued_to_device,
        issued_at: t.issued_at, expires_at: t.expires_at,
        signature: t.signature, signature_ed25519: t.signature_ed25519,
        issuer_user_id: t.issuer_user_id || null, issuer_upi_id: t.issuer_upi_id || null,
      })),
    });
  } catch (e) { next(e); }
});

// Bob rejects — e.g. he checked his bank app and there's no credit matching Alice's UTR.
router.post('/:orderId/reject', async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { approverUserId, reason } = req.body || {};
    if (!approverUserId) return res.status(400).json({ error: 'approverUserId required' });

    const order = await db.prepare('SELECT * FROM load_orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (order.status === 'completed') {
      return res.status(409).json({ error: 'order already completed' });
    }
    if (order.issuer_user_id && order.issuer_user_id !== approverUserId) {
      return res.status(403).json({ error: 'only the escrow user can reject' });
    }
    const now = Date.now();
    await db.prepare(
      `UPDATE load_orders
         SET status = 'rejected', rejected_at = ?, rejection_reason = ?
         WHERE id = ?`,
    ).run(now, (reason || '').toString().slice(0, 300) || null, orderId);
    res.json({ orderId, status: 'rejected', rejectedAt: now });
  } catch (e) { next(e); }
});

// List load orders where I'm the issuer AND Alice has submitted a UTR.
// Bob's "approve queue" — he taps into this from home.
router.get('/pending-confirmations/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const rows = await db.prepare(
      `SELECT lo.id, lo.amount_paise, lo.created_at, lo.utr, lo.utr_note,
              lo.utr_submitted_at, lo.user_id,
              u.upi_id AS payer_upi, u.phone AS payer_phone
         FROM load_orders lo
         JOIN users u ON u.id = lo.user_id
         WHERE lo.issuer_user_id = ? AND lo.status = 'awaiting_confirmation'
         ORDER BY lo.utr_submitted_at DESC
         LIMIT 50`,
    ).all(userId);
    res.json({
      items: rows.map((r) => ({
        orderId: r.id,
        amount: r.amount_paise / 100,
        createdAt: r.created_at,
        utr: r.utr,
        utrNote: r.utr_note,
        utrSubmittedAt: r.utr_submitted_at,
        payerUserId: r.user_id,
        payerUpi: r.payer_upi,
        payerPhone: r.payer_phone,
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
