const express = require('express');
const db = require('../lib/db');
const { readSetting } = require('./settings');

const router = express.Router();

/**
 * List settlements that the escrow holder still needs to pay out.
 * Each row includes a ready-to-tap UPI deeplink so the operator can pay
 * the receiver from the escrow account in one tap.
 */
router.get('/pending', (req, res) => {
  const escrowName = readSetting('escrow_name') || 'ZeroNetPay Escrow';
  const rows = db
    .prepare(
      `SELECT s.id, s.amount_paise, s.token_count, s.created_at,
              s.disbursed, s.disbursed_at, s.disbursed_ref,
              s.complaint_raised, s.complaint_at, s.complaint_note,
              u.upi_id AS receiver_upi, u.id AS receiver_id
         FROM settlements s
         JOIN users u ON u.id = s.receiver_id
         ORDER BY s.disbursed ASC, s.complaint_raised DESC, s.created_at DESC
         LIMIT 200`,
    )
    .all();
  const items = rows.map((r) => {
    const amt = (r.amount_paise / 100).toFixed(2);
    const note = 'ZNP-Settle ' + r.id.slice(-8);
    const deeplink =
      `upi://pay` +
      `?pa=${encodeURIComponent(r.receiver_upi)}` +
      `&pn=${encodeURIComponent('Settle to ' + r.receiver_upi)}` +
      `&am=${amt}` +
      `&cu=INR` +
      `&tn=${encodeURIComponent(note)}` +
      `&tr=${encodeURIComponent(r.id)}`;
    return {
      id: r.id,
      amount: r.amount_paise / 100,
      tokenCount: r.token_count,
      receiverUpi: r.receiver_upi,
      receiverId: r.receiver_id,
      createdAt: r.created_at,
      disbursed: !!r.disbursed,
      disbursedAt: r.disbursed_at,
      disbursedRef: r.disbursed_ref,
      complaintRaised: !!r.complaint_raised,
      complaintAt: r.complaint_at,
      complaintNote: r.complaint_note,
      deeplink,
      note,
    };
  });
  res.json({
    escrowName,
    escrowUpiId: readSetting('escrow_upi_id'),
    items,
    pendingCount: items.filter((i) => !i.disbursed).length,
    pendingAmount: items
      .filter((i) => !i.disbursed)
      .reduce((s, i) => s + i.amount, 0),
  });
});

router.post('/:id/mark-paid', (req, res) => {
  const ref = (req.body && req.body.ref) || null;
  const r = db
    .prepare(
      `UPDATE settlements
          SET disbursed = 1, disbursed_at = ?, disbursed_ref = ?
          WHERE id = ? AND disbursed = 0`,
    )
    .run(Date.now(), ref, req.params.id);
  if (r.changes === 0) {
    return res.status(404).json({ error: 'settlement not found or already paid' });
  }
  res.json({ ok: true });
});

router.post('/:id/unmark', (req, res) => {
  const r = db
    .prepare(
      `UPDATE settlements
          SET disbursed = 0, disbursed_at = NULL, disbursed_ref = NULL
          WHERE id = ?`,
    )
    .run(req.params.id);
  res.json({ ok: r.changes === 1 });
});

/**
 * List all settlements for a given receiver — used by the user's
 * "My cashouts" view so they can see status (queued / paid / disputed)
 * and raise complaints.
 */
router.get('/mine/:receiverId', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, amount_paise, token_count, created_at,
              disbursed, disbursed_at, disbursed_ref,
              complaint_raised, complaint_at, complaint_note
         FROM settlements
         WHERE receiver_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
    )
    .all(req.params.receiverId);
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      amount: r.amount_paise / 100,
      tokenCount: r.token_count,
      createdAt: r.created_at,
      disbursed: !!r.disbursed,
      disbursedAt: r.disbursed_at,
      disbursedRef: r.disbursed_ref,
      complaintRaised: !!r.complaint_raised,
      complaintAt: r.complaint_at,
      complaintNote: r.complaint_note,
    })),
  });
});

/**
 * Receiver raises a complaint that payout hasn't arrived.
 * Marks the settlement as disputed so the operator sees it flagged.
 */
router.post('/:id/complaint', (req, res) => {
  const note = ((req.body && req.body.note) || 'Payout not received').slice(0, 300);
  const r = db
    .prepare(
      `UPDATE settlements
          SET complaint_raised = 1, complaint_at = ?, complaint_note = ?
          WHERE id = ? AND disbursed = 0`,
    )
    .run(Date.now(), note, req.params.id);
  if (r.changes === 0) {
    return res.status(400).json({ error: 'settlement already paid or not found' });
  }
  res.json({ ok: true });
});

module.exports = router;
