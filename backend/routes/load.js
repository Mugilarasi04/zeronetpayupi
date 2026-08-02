const express = require('express');
const db = require('../lib/db');
const { newId } = require('../lib/crypto');
const escrow = require('../lib/escrow');
const { readSetting } = require('./settings');

const router = express.Router();

/**
 * Step 1 of loading money: create an order for a UPI deeplink.
 * In a production system this would call a PSP / bank API to generate
 * a real intent URL; here we mock it with a "upi://" deeplink the user
 * can tap to pay using their existing UPI app.
 */
router.post('/create', (req, res) => {
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
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const escrowUpiId = readSetting('escrow_upi_id');
  if (!escrowUpiId) {
    return res.status(400).json({
      error: 'escrow_not_configured',
      message:
        'Set the escrow UPI ID in Settings before loading money. ' +
        'This is the real UPI account that will receive funds.',
    });
  }
  const escrowName = readSetting('escrow_name') || 'ZeroNetPay Escrow';

  const order = {
    id: newId('LOAD'),
    user_id: userId,
    amount_paise: amountPaise,
    status: 'pending',
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO load_orders (id, user_id, amount_paise, status, created_at)
     VALUES (@id, @user_id, @amount_paise, @status, @created_at)`,
  ).run(order);

  // A short reference / transaction note that the user will see in their UPI app.
  const note = 'ZNP ' + order.id.slice(-8);

  // Standard UPI intent — works with GPay, PhonePe, Paytm, WhatsApp Pay,
  // BHIM, and any other compliant UPI app. Both the deeplink and the QR
  // code below encode this exact intent string.
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
    note,
    status: 'pending',
  });
});

/**
 * Step 2 of loading: the escrow webhook. In production this is invoked
 * by the bank when funds clear. For the demo, the client calls this
 * directly to simulate the bank confirmation, which mints tokens.
 */
router.post('/confirm', (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  const order = db.prepare('SELECT * FROM load_orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'order not found' });
  if (order.status === 'completed') {
    return res.status(409).json({ error: 'order already completed' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
  if (!user) return res.status(404).json({ error: 'user not found' });

  const tokens = escrow.creditEscrowAndIssueTokens({
    userId: order.user_id,
    deviceId: user.device_id,
    amountPaise: order.amount_paise,
    loadOrderId: order.id,
  });

  db.prepare(
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
      signature: t.signature,
    })),
  });
});

router.get('/status/:orderId', (req, res) => {
  const order = db.prepare('SELECT * FROM load_orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'not found' });
  res.json({
    orderId: order.id,
    status: order.status,
    amount: order.amount_paise / 100,
  });
});

module.exports = router;
