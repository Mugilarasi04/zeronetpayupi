// Ed25519 signing layer that sits alongside the legacy HMAC-SHA256
// signer. Newly minted tokens carry BOTH signatures (dual-sign) so:
//
//  1. Legacy tokens already in circulation keep verifying (back-compat).
//  2. New tokens are verifiable OFFLINE by any receiver that has the
//     backend's Ed25519 public key cached — a server compromise cannot
//     silently mint forged tokens that pass offline verification using
//     an old public key the attacker doesn't control.
//
// The private key is persisted on disk under backend/data/.ed25519.key
// so Render container restarts keep the same keypair. The public key
// is exposed at /api/public-key for the frontend to fetch once and
// cache in IndexedDB.

const fs = require('fs');
const path = require('path');
const ed = require('@noble/ed25519');
const crypto = require('crypto');
const config = require('./config');

// @noble/ed25519 v3 requires sha-512 to be provided for sync use.
// Node's built-in crypto has it; wire it up.
ed.hashes.sha512 = (m) => crypto.createHash('sha512').update(m).digest();

const KEY_FILE = path.resolve(__dirname, '..', 'data', '.ed25519.key');

function toHex(buf) {
  return Buffer.from(buf).toString('hex');
}
function fromHex(hex) {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function loadOrCreateKeypair() {
  // Env override wins — lets Render keep the same key across deploys.
  if (process.env.ED25519_PRIVATE_KEY) {
    const priv = fromHex(process.env.ED25519_PRIVATE_KEY.trim());
    const pub = ed.getPublicKey(priv);
    return { priv, pub };
  }
  try {
    if (fs.existsSync(KEY_FILE)) {
      const priv = fromHex(fs.readFileSync(KEY_FILE, 'utf8').trim());
      const pub = ed.getPublicKey(priv);
      return { priv, pub };
    }
  } catch (e) {
    console.warn('[signing] could not read keyfile, generating fresh', e.message);
  }
  // @noble/ed25519 v3 API — keygen() returns { secretKey, publicKey }.
  const { secretKey, publicKey } = ed.keygen();
  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, toHex(secretKey), { mode: 0o600 });
  } catch (e) {
    console.warn('[signing] could not persist keyfile — key is session-only', e.message);
  }
  return { priv: secretKey, pub: publicKey };
}

const { priv: EDWARDS_PRIVATE, pub: EDWARDS_PUBLIC } = loadOrCreateKeypair();

// Canonical token message — identical to crypto.js's tokenMessage() so
// both signatures cover the same bytes. Keep this in sync.
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

function signTokenEd25519(token) {
  const msg = new TextEncoder().encode(tokenMessage(token));
  const sig = ed.sign(msg, EDWARDS_PRIVATE);
  return toHex(sig);
}

function verifyTokenEd25519(token, signatureHex) {
  if (typeof signatureHex !== 'string' || signatureHex.length !== 128) return false;
  try {
    const msg = new TextEncoder().encode(tokenMessage(token));
    return ed.verify(fromHex(signatureHex), msg, EDWARDS_PUBLIC);
  } catch (_) {
    return false;
  }
}

function publicKeyHex() {
  return toHex(EDWARDS_PUBLIC);
}

module.exports = {
  signTokenEd25519,
  verifyTokenEd25519,
  publicKeyHex,
};
