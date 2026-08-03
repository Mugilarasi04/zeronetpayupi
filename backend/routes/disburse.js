const express = require('express');
const db = require('../lib/db');
const { readSetting } = require('./settings');

const router = express.Router();

router.get('/pending', async (req, res, next) => {
  try {
    const escrowName = (await readSetting('escrow_name')) || 'ZeroNetPay Escrow';
    const rows = await db
      .prepare(
        `SELECT s.id, s.amount_paise, s.token_count, s.created_at,
                s.disbursed, s.disbursed_at, s.disbursed_ref,
                s.complaint_raised, s.complaint_at, s.complaint_note,
                u.upi_id AS receiver_upi, u.id AS receiver_id,
                u.phone AS receiver_phone
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
        receiverPhone: r.receiver_phone || null,
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
      escrowUpiId: await readSetting('escrow_upi_id'),
      items,
      pendingCount: items.filter((i) => !i.disbursed).length,
      pendingAmount: items.filter((i) => !i.disbursed).reduce((s, i) => s + i.amount, 0),
    });
  } catch (e) { next(e); }
});

router.post('/:id/mark-paid', async (req, res, next) => {
  try {
    const ref = (req.body && req.body.ref) || null;
    const r = await db
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
  } catch (e) { next(e); }
});

router.post('/:id/unmark', async (req, res, next) => {
  try {
    const r = await db
      .prepare(
        `UPDATE settlements
            SET disbursed = 0, disbursed_at = NULL, disbursed_ref = NULL
            WHERE id = ?`,
      )
      .run(req.params.id);
    res.json({ ok: r.changes === 1 });
  } catch (e) { next(e); }
});

router.get('/mine/:receiverId', async (req, res, next) => {
  try {
    const rows = await db
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
  } catch (e) { next(e); }
});

router.post('/:id/complaint', async (req, res, next) => {
  try {
    const note = ((req.body && req.body.note) || 'Payout not received').slice(0, 300);
    const r = await db
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
  } catch (e) { next(e); }
});

module.exports = router;
