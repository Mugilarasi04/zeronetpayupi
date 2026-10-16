const express = require('express');
const db = require('../lib/db');
const { adminGate, setFrozen, isFrozen } = require('../lib/security');
const audit = require('../lib/audit');

const router = express.Router();

// Every admin endpoint requires X-Admin-Token header matching ADMIN_TOKEN
// env var set on Render.
router.use(adminGate);

// GET /api/admin/status — current freeze + counts (handy ops dashboard).
router.get('/status', async (req, res, next) => {
  try {
    const frozen = await isFrozen();
    const tokens = await db.prepare('SELECT COUNT(*) AS n FROM tokens').get();
    const spent  = await db.prepare('SELECT COUNT(*) AS n FROM tokens WHERE spent = 1').get();
    const users  = await db.prepare('SELECT COUNT(*) AS n FROM users').get();
    res.json({
      frozen,
      tokensEverMinted: tokens.n,
      tokensSpent: spent.n,
      users: users.n,
    });
  } catch (e) { next(e); }
});

// POST /api/admin/freeze — stop all mutating ops.
router.post('/freeze', async (req, res, next) => {
  try {
    await setFrozen(true);
    await audit.append('admin_freeze', { by: req.ip }, 'operator');
    res.json({ frozen: true });
  } catch (e) { next(e); }
});

// POST /api/admin/unfreeze — resume.
router.post('/unfreeze', async (req, res, next) => {
  try {
    await setFrozen(false);
    await audit.append('admin_unfreeze', { by: req.ip }, 'operator');
    res.json({ frozen: false });
  } catch (e) { next(e); }
});

// POST /api/admin/recall/:tokenId — mark a specific token as spent so it
// can never be redeemed again. Use this when a device is reported stolen.
router.post('/recall/:tokenId', async (req, res, next) => {
  try {
    const r = await db.prepare(
      `UPDATE tokens
          SET spent = 1, spent_at = ?, spent_by_user_id = 'RECALLED'
          WHERE id = ? AND spent = 0`,
    ).run(Date.now(), req.params.tokenId);
    if (r.changes === 0) {
      return res.status(404).json({ error: 'token not found or already spent' });
    }
    await audit.append('admin_recall', { tokenId: req.params.tokenId }, 'operator');
    res.json({ recalled: req.params.tokenId });
  } catch (e) { next(e); }
});

// POST /api/admin/honeytoken — mint a canary token in a dormant wallet.
// Any attempt to redeem it later proves exfiltration and auto-freezes
// the system.
//
// Honeytokens are identified by the id prefix "HONEY_". We attach them
// to a sentinel user (lazily created) so the FK on tokens.issued_to_user_id
// is satisfied. load_order_id stays NULL (that FK is nullable).
async function ensureHoneypotUser() {
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').get('HONEYPOT');
  if (existing) return existing;
  const now = Date.now();
  await db.prepare(
    `INSERT INTO users (id, upi_id, device_id, public_key, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run('HONEYPOT', 'honeypot@internal', 'HONEYPOT_DEVICE', null, now);
  return { id: 'HONEYPOT', device_id: 'HONEYPOT_DEVICE' };
}

router.post('/honeytoken', async (req, res, next) => {
  try {
    const { signToken, newId } = require('../lib/crypto');
    const { signTokenEd25519 } = require('../lib/signing');

    let targetUser;
    if (req.body && req.body.userId) {
      targetUser = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.body.userId);
      if (!targetUser) return res.status(404).json({ error: 'target user not found' });
    } else {
      targetUser = await ensureHoneypotUser();
    }

    const now = Date.now();
    const expiresAt = now + 365 * 24 * 60 * 60 * 1000;
    const token = {
      id: newId('HONEY'),
      value_paise: 100,
      issued_to_user_id: targetUser.id,
      issued_to_device: targetUser.device_id,
      issued_at: now,
      expires_at: expiresAt,
      load_order_id: null,
    };
    token.signature = signToken(token);
    token.signature_ed25519 = signTokenEd25519(token);
    await db.prepare(
      `INSERT INTO tokens
        (id, value_paise, issued_to_user_id, issued_to_device, issued_at, expires_at,
         signature, signature_ed25519, spent, load_order_id)
        VALUES (@id, @value_paise, @issued_to_user_id, @issued_to_device, @issued_at,
                @expires_at, @signature, @signature_ed25519, 0, @load_order_id)`,
    ).run(token);
    await audit.append('honeytoken_minted', { tokenId: token.id, userId: targetUser.id }, 'operator');
    res.json({
      id: token.id,
      signature: token.signature,
      signature_ed25519: token.signature_ed25519,
      message: 'Honeytoken minted. Any redeem attempt will freeze the system.',
    });
  } catch (e) {
    console.error('[admin/honeytoken] failed', e);
    next(e);
  }
});

// GET /api/admin/audit?limit=N — mirror of /api/audit/log for ops.
router.get('/audit', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '500', 10) || 500, 2000);
    const rows = await audit.tail(limit);
    res.json({ rootHash: await audit.rootHash(), count: rows.length, rows });
  } catch (e) { next(e); }
});

// POST /api/admin/wipe
// Nuke the entire DB — users, tokens, settlements, escrow relationships, load
// orders, audit log. Needed because Render's free-tier SQLite is already
// wiped on every restart; this gives a user-facing way to start clean too.
// Keeps schema intact; drops rows only.
router.post('/wipe', async (req, res, next) => {
  try {
    const tables = [
      'tokens', 'settlements', 'load_orders',
      'escrow_relationships', 'users',
      'audit_log', 'pair_codes', 'app_settings',
    ];
    const wiped = {};
    for (const t of tables) {
      try {
        const before = await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get();
        await db.exec(`DELETE FROM ${t}`);
        wiped[t] = before ? before.n : 0;
      } catch (e) {
        wiped[t] = 'skip (' + (e.message || 'unknown') + ')';
      }
    }
    // Re-seed the escrow_account row with 0 balance (some queries assume id=1 exists).
    try {
      await db.exec(`INSERT OR IGNORE INTO escrow_account(id, balance_paise, updated_at) VALUES (1, 0, ${Date.now()})`);
    } catch (_) {}
    res.json({ ok: true, wiped });
  } catch (e) { next(e); }
});

module.exports = router;
