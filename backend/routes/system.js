const express = require('express');
const db = require('../lib/db');
const escrow = require('../lib/escrow');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

router.get('/audit', async (req, res, next) => {
  try {
    const escrowBalance = await escrow.getEscrowBalance();
    const circulating = await escrow.tokensInCirculation();
    const settledRow = await db
      .prepare('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM settlements')
      .get();
    res.json({
      escrowBalance: escrowBalance / 100,
      tokensInCirculation: circulating / 100,
      totalSettled: (settledRow.total || 0) / 100,
      invariantHolds: escrowBalance === circulating,
    });
  } catch (e) { next(e); }
});

router.get('/user/:userId/tokens', async (req, res, next) => {
  try {
    const rows = await db
      .prepare(
        `SELECT id, value_paise, issued_at, expires_at, signature, spent, spent_at
           FROM tokens
           WHERE issued_to_user_id = ?
           ORDER BY issued_at DESC
           LIMIT 500`,
      )
      .all(req.params.userId);
    res.json({ tokens: rows });
  } catch (e) { next(e); }
});

router.get('/user/:userId/history', async (req, res, next) => {
  try {
    const loads = await db
      .prepare(
        `SELECT id, amount_paise, status, created_at, completed_at
           FROM load_orders
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT 50`,
      )
      .all(req.params.userId);
    const settlements = await db
      .prepare(
        `SELECT id, token_count, amount_paise, upi_ref, created_at
           FROM settlements
           WHERE receiver_id = ?
           ORDER BY created_at DESC
           LIMIT 50`,
      )
      .all(req.params.userId);
    res.json({ loads, settlements });
  } catch (e) { next(e); }
});

module.exports = router;
