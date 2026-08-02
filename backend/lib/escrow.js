const db = require('./db');
const config = require('./config');
const { signToken, newId } = require('./crypto');

const DENOM_PAISE = Math.round(config.tokenDenomination * 100);

function getEscrowBalance() {
  const row = db.prepare('SELECT balance_paise FROM escrow_account WHERE id = 1').get();
  return row ? row.balance_paise : 0;
}

function tokensInCirculation() {
  const row = db
    .prepare('SELECT COALESCE(SUM(value_paise), 0) AS total FROM tokens WHERE spent = 0')
    .get();
  return row.total || 0;
}

/**
 * Atomically credit the escrow account and mint signed tokens for a user.
 * The invariant tokens_in_circulation == escrow_balance is preserved.
 */
function creditEscrowAndIssueTokens({ userId, deviceId, amountPaise, loadOrderId }) {
  if (amountPaise <= 0) throw new Error('amount must be positive');
  if (amountPaise % DENOM_PAISE !== 0) {
    throw new Error(`amount must be a multiple of ${DENOM_PAISE / 100}`);
  }
  const tokenCount = amountPaise / DENOM_PAISE;
  const now = Date.now();
  const expiresAt = now + config.tokenExpiryDays * 24 * 60 * 60 * 1000;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE escrow_account
         SET balance_paise = balance_paise + ?, updated_at = ?
         WHERE id = 1`
    ).run(amountPaise, now);

    const insert = db.prepare(`
      INSERT INTO tokens
        (id, value_paise, issued_to_user_id, issued_to_device, issued_at, expires_at,
         signature, spent, load_order_id)
        VALUES (@id, @value_paise, @issued_to_user_id, @issued_to_device, @issued_at,
                @expires_at, @signature, 0, @load_order_id)
    `);

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
      insert.run(token);
      issued.push(token);
    }
    return issued;
  });

  return tx();
}

/**
 * Mark a list of tokens as spent and credit the receiver.
 * The caller is responsible for verifying signatures and freshness.
 */
function debitEscrowAndSettle({ receiverId, tokens, senderDevice }) {
  const now = Date.now();
  const settlementId = newId('STL');
  const totalPaise = tokens.reduce((s, t) => s + t.value_paise, 0);

  const tx = db.transaction(() => {
    const markSpent = db.prepare(`
      UPDATE tokens
         SET spent = 1, spent_at = ?, spent_by_user_id = ?
         WHERE id = ? AND spent = 0
    `);
    let spentCount = 0;
    for (const t of tokens) {
      const r = markSpent.run(now, receiverId, t.id);
      spentCount += r.changes;
    }
    if (spentCount !== tokens.length) {
      throw new Error('one or more tokens were already spent (race detected)');
    }

    db.prepare(
      `UPDATE escrow_account
         SET balance_paise = balance_paise - ?, updated_at = ?
         WHERE id = 1`
    ).run(totalPaise, now);

    db.prepare(`
      INSERT INTO settlements
        (id, receiver_id, sender_device, token_count, amount_paise, upi_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      settlementId,
      receiverId,
      senderDevice || null,
      tokens.length,
      totalPaise,
      `ZNP-STL-${Date.now().toString(36).toUpperCase()}`,
      now,
    );
  });

  tx();
  return { settlementId, totalPaise, tokenCount: tokens.length };
}

module.exports = {
  DENOM_PAISE,
  getEscrowBalance,
  tokensInCirculation,
  creditEscrowAndIssueTokens,
  debitEscrowAndSettle,
};
