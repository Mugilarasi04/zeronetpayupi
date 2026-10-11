const express = require('express');
const db = require('../lib/db');
const escrow = require('../lib/escrow');
const audit = require('../lib/audit');
const { publicKeyHex } = require('../lib/signing');
const { readSetting } = require('./settings');

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
    const disbursedRow = await db
      .prepare('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM settlements WHERE disbursed = 1')
      .get();
    const txnCount = await db
      .prepare('SELECT COUNT(*) AS n FROM tokens')
      .get();
    res.json({
      escrowBalance: escrowBalance / 100,
      tokensInCirculation: circulating / 100,
      totalSettled: (settledRow.total || 0) / 100,
      totalDisbursed: (disbursedRow.total || 0) / 100,
      tokensEverMinted: (txnCount && txnCount.n) || 0,
      invariantHolds: escrowBalance === circulating,
      invariantDeltaPaise: escrowBalance - circulating,
      escrowUpiId: await readSetting('escrow_upi_id'),
      serverTime: Date.now(),
    });
  } catch (e) { next(e); }
});

// Immutable audit log — last N rows + chain root hash.
router.get('/audit/log', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 500);
    const rows = await audit.tail(limit);
    const rootHash = await audit.rootHash();
    res.json({ rootHash, count: rows.length, rows });
  } catch (e) { next(e); }
});

// Re-walk the whole chain, prove no row was tampered with.
router.get('/audit/verify', async (req, res, next) => {
  try {
    const r = await audit.verifyChain();
    res.json(r);
  } catch (e) { next(e); }
});

// Public Ed25519 key — frontend caches this to verify tokens OFFLINE
// before accepting them into the wallet. A hostname served over HTTPS +
// Service-Worker-cached means the key is pinned the first time the app
// is opened.
router.get('/public-key', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({ ed25519: publicKeyHex(), algorithm: 'Ed25519' });
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
