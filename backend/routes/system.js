const express = require('express');
const db = require('../lib/db');
const escrow = require('../lib/escrow');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

/**
 * Live invariant check. Returns the escrow balance and the value of
 * tokens still in circulation; in a healthy system these are equal.
 * Useful for sanity-checking demos and for an admin dashboard.
 */
router.get('/audit', (req, res) => {
  const escrowBalance = escrow.getEscrowBalance();
  const circulating = escrow.tokensInCirculation();
  const settledRow = db
    .prepare('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM settlements')
    .get();
  res.json({
    escrowBalance: escrowBalance / 100,
    tokensInCirculation: circulating / 100,
    totalSettled: (settledRow.total || 0) / 100,
    invariantHolds: escrowBalance === circulating,
  });
});

router.get('/user/:userId/tokens', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, value_paise, issued_at, expires_at, signature, spent, spent_at
         FROM tokens
         WHERE issued_to_user_id = ?
         ORDER BY issued_at DESC
         LIMIT 500`,
    )
    .all(req.params.userId);
  res.json({ tokens: rows });
});

router.get('/user/:userId/history', (req, res) => {
  const loads = db
    .prepare(
      `SELECT id, amount_paise, status, created_at, completed_at
         FROM load_orders
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
    )
    .all(req.params.userId);
  const settlements = db
    .prepare(
      `SELECT id, token_count, amount_paise, upi_ref, created_at
         FROM settlements
         WHERE receiver_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
    )
    .all(req.params.userId);
  res.json({ loads, settlements });
});

module.exports = router;
