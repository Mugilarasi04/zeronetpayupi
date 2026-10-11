const db = require('./db');
const config = require('./config');
const { signToken, newId } = require('./crypto');
const { signTokenEd25519 } = require('./signing');
const audit = require('./audit');

// Ensure the Ed25519 column exists on the tokens table (migration from
// HMAC-only). SQLite needs ADD COLUMN with no default to be nullable.
(async () => {
  try {
    const info = await db.prepare('PRAGMA table_info(tokens)').all();
    const cols = info.map((r) => r.name);
    if (!cols.includes('signature_ed25519')) {
      await db.exec('ALTER TABLE tokens ADD COLUMN signature_ed25519 TEXT');
    }
  } catch (e) {
    console.warn('[escrow] ed25519 column migration failed', e.message);
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
async function creditEscrowAndIssueTokens({ userId, deviceId, amountPaise, loadOrderId }) {
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
      };
      token.signature = signToken(token);
      token.signature_ed25519 = signTokenEd25519(token);
      await tx.run(
        `INSERT INTO tokens
          (id, value_paise, issued_to_user_id, issued_to_device, issued_at, expires_at,
           signature, signature_ed25519, spent, load_order_id)
          VALUES (@id, @value_paise, @issued_to_user_id, @issued_to_device, @issued_at,
                  @expires_at, @signature, @signature_ed25519, 0, @load_order_id)`,
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
  const settlementId = newId('STL');
  const totalPaise = tokens.reduce((s, t) => s + t.value_paise, 0);

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

    await tx.run(
      `INSERT INTO settlements
        (id, receiver_id, sender_device, token_count, amount_paise, upi_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      settlementId,
      receiverId,
      senderDevice || null,
      tokens.length,
      totalPaise,
      `ZNP-STL-${Date.now().toString(36).toUpperCase()}`,
      now,
    );
  });

  try {
    await audit.append('redeem', {
      settlementId, receiverId, senderDevice,
      tokenCount: tokens.length, totalPaise,
      tokenIds: tokens.map((t) => t.id),
    }, receiverId);
  } catch (e) {
    console.warn('[escrow] audit append failed (redeem)', e.message);
  }

  return { settlementId, totalPaise, tokenCount: tokens.length };
}

module.exports = {
  DENOM_PAISE,
  getEscrowBalance,
  tokensInCirculation,
  creditEscrowAndIssueTokens,
  debitEscrowAndSettle,
};
