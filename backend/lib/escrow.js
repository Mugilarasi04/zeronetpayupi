const db = require('./db');
const config = require('./config');
const { signToken, newId } = require('./crypto');

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
      await tx.run(
        `INSERT INTO tokens
          (id, value_paise, issued_to_user_id, issued_to_device, issued_at, expires_at,
           signature, spent, load_order_id)
          VALUES (@id, @value_paise, @issued_to_user_id, @issued_to_device, @issued_at,
                  @expires_at, @signature, 0, @load_order_id)`,
        token,
      );
      issued.push(token);
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

  return { settlementId, totalPaise, tokenCount: tokens.length };
}

module.exports = {
  DENOM_PAISE,
  getEscrowBalance,
  tokensInCirculation,
  creditEscrowAndIssueTokens,
  debitEscrowAndSettle,
};
