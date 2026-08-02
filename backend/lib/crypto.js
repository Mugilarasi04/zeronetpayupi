const crypto = require('crypto');
const config = require('./config');

/**
 * Build the canonical message for a token's signature.
 * Order matters — the same fields must be hashed identically on both
 * issuance and verification or the signature will not match.
 */
function tokenMessage(token) {
  return [
    token.id,
    token.value_paise,
    token.issued_to_user_id,
    token.issued_to_device,
    token.issued_at,
    token.expires_at,
  ].join('|');
}

function signToken(token) {
  return crypto
    .createHmac('sha256', config.tokenSecret)
    .update(tokenMessage(token))
    .digest('hex');
}

function verifyToken(token, signature) {
  if (typeof signature !== 'string' || signature.length === 0) return false;
  const expected = signToken(token);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

module.exports = { tokenMessage, signToken, verifyToken, newId };
