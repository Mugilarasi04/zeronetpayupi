// Peer-to-peer federated escrow relationships.
//
// Alice picks a friend Bob (any registered user) to be her escrow.
// Bob approves. Alice's load money then goes to Bob's UPI; tokens Alice
// mints are stamped with issuer_user_id = Bob. When those tokens are
// redeemed by anyone, the payout obligation lands in Bob's disbursement
// queue — Bob pays out from the money he's already holding.
//
// Status machine:
//   requested → approved     (Bob clicks Accept)
//   requested → rejected     (Bob clicks Reject)
//   approved  → revoked      (either side ends it)
//
// A user has AT MOST ONE active (approved) escrow at a time. New
// approval auto-revokes the previous one.

const db = require('./db');
const { newId } = require('./crypto');
const audit = require('./audit');

async function ensureSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS escrow_relationships (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id),
      escrow_user_id  TEXT NOT NULL REFERENCES users(id),
      escrow_upi_id   TEXT NOT NULL,
      escrow_phone    TEXT,
      escrow_name     TEXT,
      status          TEXT NOT NULL,
      requested_at    INTEGER NOT NULL,
      approved_at     INTEGER,
      rejected_at     INTEGER,
      revoked_at      INTEGER,
      requested_by    TEXT NOT NULL
    )
  `);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_escrowrel_user ON escrow_relationships(user_id, status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_escrowrel_escrow ON escrow_relationships(escrow_user_id, status)`);
}
const ready = ensureSchema().catch((e) => console.warn('[escrow_relations] schema', e.message));

async function requestEscrow({ userId, escrowUserId }) {
  await ready;
  if (userId === escrowUserId) {
    throw Object.assign(new Error('you cannot be your own escrow'), { status: 400 });
  }
  const user = await db.prepare('SELECT id, upi_id FROM users WHERE id = ?').get(userId);
  if (!user) { throw Object.assign(new Error('user not found'), { status: 404 }); }
  const escrow = await db.prepare('SELECT id, upi_id, phone FROM users WHERE id = ?').get(escrowUserId);
  if (!escrow) { throw Object.assign(new Error('escrow user not found'), { status: 404 }); }

  // Reject if a request already pending between this pair.
  const existing = await db.prepare(
    `SELECT id, status FROM escrow_relationships
       WHERE user_id = ? AND escrow_user_id = ? AND status IN ('requested','approved')`,
  ).get(userId, escrowUserId);
  if (existing) {
    return { id: existing.id, status: existing.status, duplicate: true };
  }

  const id = newId('REL');
  const now = Date.now();
  await db.prepare(
    `INSERT INTO escrow_relationships
       (id, user_id, escrow_user_id, escrow_upi_id, escrow_phone, escrow_name,
        status, requested_at, requested_by)
       VALUES (@id, @user_id, @escrow_user_id, @escrow_upi_id, @escrow_phone, @escrow_name,
               'requested', @requested_at, @requested_by)`,
  ).run({
    id,
    user_id: userId,
    escrow_user_id: escrowUserId,
    escrow_upi_id: escrow.upi_id,
    escrow_phone: escrow.phone || null,
    escrow_name: escrow.upi_id,
    requested_at: now,
    requested_by: userId,
  });

  await audit.append('escrow_requested', {
    relationshipId: id, userId, escrowUserId,
  }, userId);

  return { id, status: 'requested', duplicate: false };
}

async function approveEscrow({ relationshipId, approverUserId }) {
  await ready;
  const row = await db.prepare('SELECT * FROM escrow_relationships WHERE id = ?').get(relationshipId);
  if (!row) throw Object.assign(new Error('relationship not found'), { status: 404 });
  if (row.escrow_user_id !== approverUserId) {
    throw Object.assign(new Error('only the proposed escrow can approve'), { status: 403 });
  }
  if (row.status !== 'requested') {
    throw Object.assign(new Error(`cannot approve a ${row.status} relationship`), { status: 400 });
  }

  const now = Date.now();
  await db.transaction(async (tx) => {
    // Auto-revoke the user's current active escrow if any.
    await tx.run(
      `UPDATE escrow_relationships
         SET status = 'revoked', revoked_at = ?
         WHERE user_id = ? AND status = 'approved' AND id != ?`,
      now, row.user_id, relationshipId,
    );
    await tx.run(
      `UPDATE escrow_relationships
         SET status = 'approved', approved_at = ?
         WHERE id = ?`,
      now, relationshipId,
    );
  });

  await audit.append('escrow_approved', {
    relationshipId, userId: row.user_id, escrowUserId: row.escrow_user_id,
  }, approverUserId);

  return { id: relationshipId, status: 'approved', approvedAt: now };
}

async function rejectEscrow({ relationshipId, approverUserId }) {
  await ready;
  const row = await db.prepare('SELECT * FROM escrow_relationships WHERE id = ?').get(relationshipId);
  if (!row) throw Object.assign(new Error('relationship not found'), { status: 404 });
  if (row.escrow_user_id !== approverUserId) {
    throw Object.assign(new Error('only the proposed escrow can reject'), { status: 403 });
  }
  if (row.status !== 'requested') {
    throw Object.assign(new Error(`cannot reject a ${row.status} relationship`), { status: 400 });
  }
  const now = Date.now();
  await db.prepare(
    `UPDATE escrow_relationships SET status = 'rejected', rejected_at = ? WHERE id = ?`,
  ).run(now, relationshipId);
  await audit.append('escrow_rejected', { relationshipId }, approverUserId);
  return { id: relationshipId, status: 'rejected' };
}

async function revokeEscrow({ relationshipId, byUserId }) {
  await ready;
  const row = await db.prepare('SELECT * FROM escrow_relationships WHERE id = ?').get(relationshipId);
  if (!row) throw Object.assign(new Error('relationship not found'), { status: 404 });
  if (byUserId !== row.user_id && byUserId !== row.escrow_user_id) {
    throw Object.assign(new Error('only parties to this relationship can revoke'), { status: 403 });
  }
  if (row.status !== 'approved') {
    throw Object.assign(new Error(`cannot revoke a ${row.status} relationship`), { status: 400 });
  }
  const now = Date.now();
  await db.prepare(
    `UPDATE escrow_relationships SET status = 'revoked', revoked_at = ? WHERE id = ?`,
  ).run(now, relationshipId);
  await audit.append('escrow_revoked', { relationshipId, by: byUserId }, byUserId);
  return { id: relationshipId, status: 'revoked' };
}

async function activeEscrowFor(userId) {
  await ready;
  const row = await db.prepare(
    `SELECT r.id, r.escrow_user_id, r.escrow_upi_id, r.escrow_phone,
            u.upi_id AS escrow_upi, u.phone AS escrow_user_phone,
            r.approved_at
       FROM escrow_relationships r
       JOIN users u ON u.id = r.escrow_user_id
       WHERE r.user_id = ? AND r.status = 'approved'
       ORDER BY r.approved_at DESC
       LIMIT 1`,
  ).get(userId);
  if (!row) return null;
  return {
    relationshipId: row.id,
    escrowUserId: row.escrow_user_id,
    escrowUpiId: row.escrow_upi,
    escrowPhone: row.escrow_user_phone || row.escrow_phone || null,
    approvedAt: row.approved_at,
  };
}

async function mineOutgoing(userId) {
  await ready;
  const rows = await db.prepare(
    `SELECT r.id, r.status, r.requested_at, r.approved_at, r.rejected_at, r.revoked_at,
            r.escrow_user_id, u.upi_id AS escrow_upi, u.phone AS escrow_phone
       FROM escrow_relationships r
       JOIN users u ON u.id = r.escrow_user_id
       WHERE r.user_id = ?
       ORDER BY r.requested_at DESC
       LIMIT 50`,
  ).all(userId);
  return rows;
}

async function mineIncoming(escrowUserId) {
  await ready;
  const rows = await db.prepare(
    `SELECT r.id, r.status, r.requested_at, r.approved_at, r.rejected_at,
            r.user_id, u.upi_id AS user_upi, u.phone AS user_phone
       FROM escrow_relationships r
       JOIN users u ON u.id = r.user_id
       WHERE r.escrow_user_id = ?
       ORDER BY r.requested_at DESC
       LIMIT 50`,
  ).all(escrowUserId);
  return rows;
}

async function lookupUserByUpiOrPhone(q) {
  await ready;
  const upiMatch = await db.prepare('SELECT id, upi_id, phone FROM users WHERE upi_id = ?').get(q);
  if (upiMatch) return upiMatch;
  const digits = String(q || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    const phoneMatch = await db.prepare('SELECT id, upi_id, phone FROM users WHERE phone = ?').get(digits.length === 10 ? '91' + digits : digits);
    if (phoneMatch) return phoneMatch;
  }
  return null;
}

module.exports = {
  requestEscrow,
  approveEscrow,
  rejectEscrow,
  revokeEscrow,
  activeEscrowFor,
  mineOutgoing,
  mineIncoming,
  lookupUserByUpiOrPhone,
  ready,
};
