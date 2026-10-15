const db = require('./db');
const config = require('./config');
const { signToken, newId } = require('./crypto');
const { signTokenEd25519 } = require('./signing');
const audit = require('./audit');

// Ensure the Ed25519 + issuer columns exist on the tokens table.
// SQLite needs ADD COLUMN with no default to be nullable.
(async () => {
  try {
    const info = await db.prepare('PRAGMA table_info(tokens)').all();
    const cols = info.map((r) => r.name);
    if (!cols.includes('signature_ed25519')) {
      await db.exec('ALTER TABLE tokens ADD COLUMN signature_ed25519 TEXT');
    }
    if (!cols.includes('issuer_user_id')) {
      await db.exec('ALTER TABLE tokens ADD COLUMN issuer_user_id TEXT');
    }
    if (!cols.includes('issuer_upi_id')) {
      await db.exec('ALTER TABLE tokens ADD COLUMN issuer_upi_id TEXT');
    }
    const sInfo = await db.prepare('PRAGMA table_info(settlements)').all();
    const sCols = sInfo.map((r) => r.name);
    if (!sCols.includes('issuer_user_id')) {
      await db.exec('ALTER TABLE settlements ADD COLUMN issuer_user_id TEXT');
    }
    if (!sCols.includes('issuer_upi_id')) {
      await db.exec('ALTER TABLE settlements ADD COLUMN issuer_upi_id TEXT');
    }
  } catch (e) {
    console.warn('[escrow] column migration failed', e.message);
  }
})();

const DENOM_PAISE = Math.round(config.tokenDenomination * 100);

async function getEscrowBalance() {
  const row = await db.prepare('SELECT balance_paise FROM escrow_account WHERE id = 1').get();
  return row ? row.balance_paise : 0;
}

async function tokensInCirculation() {
  const row = await db
    .prepare('SELECT COALESCE(SUM(value_paise), 0) AS total FROM tokens WHERE spent = 0')
    .get();
  return row.total || 0;
}

/**
 * Atomically credit the escrow account and mint signed tokens for a user.
 * Preserves the invariant tokens_in_circulation == escrow_balance.
 */
async function creditEscrowAndIssueTokens({
  userId, deviceId, amountPaise, loadOrderId,
  issuerUserId = null, issuerUpiId = null,
}) {
  if (amountPaise <= 0) throw new Error('amount must be positive');
  if (amountPaise % DENOM_PAISE !== 0) {
    throw new Error(`amount must be a multiple of ${DENOM_PAISE / 100}`);
  }
  const tokenCount = amountPaise / DENOM_PAISE;
  const now = Date.now();
  const expiresAt = now + config.tokenExpiryDays * 24 * 60 * 60 * 1000;

  return db.transaction(async (tx) => {
    await tx.run(
      `UPDATE escrow_account
         SET balance_paise = balance_paise + ?, updated_at = ?
         WHERE id = 1`,
      amountPaise,
      now,
    );

    const issued = [];
    for (let i = 0; i < tokenCount; i++) {
      const token = {
        id: newId('TKN'),
        value_paise: DENOM_PAISE,
        issued_to_user_id: userId,
        issued_to_device: deviceId,
        issued_at: now,
        expires_at: expiresAt,
        load_order_id: loadOrderId,
        issuer_user_id: issuerUserId,
        issuer_upi_id: issuerUpiId,
      };
      token.signature = signToken(token);
      token.signature_ed25519 = signTokenEd25519(token);
      await tx.run(
        `INSERT INTO tokens
          (id, value_paise, issued_to_user_id, issued_to_device, issued_at, expires_at,
           signature, signature_ed25519, spent, load_order_id,
           issuer_user_id, issuer_upi_id)
          VALUES (@id, @value_paise, @issued_to_user_id, @issued_to_device, @issued_at,
                  @expires_at, @signature, @signature_ed25519, 0, @load_order_id,
                  @issuer_user_id, @issuer_upi_id)`,
        token,
      );
      issued.push(token);
    }
    return issued;
  }).then(async (issued) => {
    // Audit log after the DB txn commits — audit append is best-effort
    // and must NEVER rollback a successful mint.
    try {
      await audit.append('mint', {
        userId, deviceId, amountPaise, loadOrderId,
        tokenCount: issued.length,
        tokenIds: issued.map((t) => t.id),
      }, userId);
    } catch (e) {
      console.warn('[escrow] audit append failed (mint)', e.message);
    }
    return issued;
  });
}

/**
 * Mark tokens as spent and credit the receiver.
 * The caller is responsible for verifying signatures and freshness.
 */
async function debitEscrowAndSettle({ receiverId, tokens, senderDevice }) {
  const now = Date.now();
  const totalPaise = tokens.reduce((s, t) => s + t.value_paise, 0);

  // Group tokens by issuer so each escrow operator (= user who signed the
  // tokens) gets their own settlement row. A receiver cashing out tokens
  // from 3 different senders with 3 different escrows will see 3 payouts
  // land in 3 different operators' dashboards.
  const byIssuer = new Map();
  for (const t of tokens) {
    const key = t.issuer_user_id || '__default__';
    if (!byIssuer.has(key)) byIssuer.set(key, { issuerUserId: t.issuer_user_id || null, issuerUpiId: t.issuer_upi_id || null, items: [] });
    byIssuer.get(key).items.push(t);
  }

  const settlements = [];
  await db.transaction(async (tx) => {
    let spentCount = 0;
    for (const t of tokens) {
      const r = await tx.run(
        `UPDATE tokens
           SET spent = 1, spent_at = ?, spent_by_user_id = ?
           WHERE id = ? AND spent = 0`,
        now,
        receiverId,
        t.id,
      );
      spentCount += r.changes || 0;
    }
    if (spentCount !== tokens.length) {
      throw new Error('one or more tokens were already spent (race detected)');
    }

    await tx.run(
      `UPDATE escrow_account
         SET balance_paise = balance_paise - ?, updated_at = ?
         WHERE id = 1`,
      totalPaise,
      now,
    );

    for (const [, group] of byIssuer) {
      const settlementId = newId('STL');
      const subTotal = group.items.reduce((s, t) => s + t.value_paise, 0);
      await tx.run(
        `INSERT INTO settlements
          (id, receiver_id, sender_device, token_count, amount_paise, upi_ref, created_at,
           issuer_user_id, issuer_upi_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        settlementId,
        receiverId,
        senderDevice || null,
        group.items.length,
        subTotal,
        `ZNP-STL-${Date.now().toString(36).toUpperCase()}-${settlementId.slice(-4)}`,
        now,
        group.issuerUserId,
        group.issuerUpiId,
      );
      settlements.push({
        settlementId,
        totalPaise: subTotal,
        tokenCount: group.items.length,
        issuerUserId: group.issuerUserId,
        issuerUpiId: group.issuerUpiId,
      });
    }
  });

  try {
    await audit.append('redeem', {
      receiverId, senderDevice,
      tokenCount: tokens.length, totalPaise,
      settlements: settlements.map((s) => ({
        settlementId: s.settlementId, issuer: s.issuerUserId, amountPaise: s.totalPaise,
      })),
    }, receiverId);
  } catch (e) {
    console.warn('[escrow] audit append failed (redeem)', e.message);
  }

  // Back-compat: callers that expect a single settlement object get the
  // first group (same behaviour as pre-federation code).
  return {
    settlements,
    totalPaise,
    tokenCount: tokens.length,
    // Legacy shape:
    settlementId: settlements[0] && settlements[0].settlementId,
  };
}

module.exports = {
  DENOM_PAISE,
  getEscrowBalance,
  tokensInCirculation,
  creditEscrowAndIssueTokens,
  debitEscrowAndSettle,
};
