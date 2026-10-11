// Offline token verification using the backend's Ed25519 public key.
//
// Flow:
//   1. On first app launch, fetch /api/public-key once and cache the hex
//      key in localStorage under znp.ed25519.pub.
//   2. The Service Worker caches that response so subsequent visits
//      work offline.
//   3. Any token received via QR or pair code is verified LOCALLY using
//      SubtleCrypto Ed25519 before being added to the wallet.
//
// Legacy tokens (minted before Ed25519 was introduced) have no
// `signature_ed25519` field — those are accepted without offline
// verification (the server still validates at redeem). This keeps old
// in-flight transfers working during migration.
//
// If the browser doesn't support SubtleCrypto Ed25519 (older iOS),
// verification silently defers to server redemption — no regression,
// just no extra offline guarantee.

import { api } from './api.js';

const KEY_PUB = 'znp.ed25519.pub';

export async function getPublicKeyHex() {
  const cached = localStorage.getItem(KEY_PUB);
  if (cached) return cached;
  try {
    const r = await api.publicKey();
    if (r && r.ed25519) {
      localStorage.setItem(KEY_PUB, r.ed25519);
      return r.ed25519;
    }
  } catch (_) { /* offline — can't fetch */ }
  return null;
}

export async function refreshPublicKey() {
  try {
    const r = await api.publicKey();
    if (r && r.ed25519) {
      localStorage.setItem(KEY_PUB, r.ed25519);
      return r.ed25519;
    }
  } catch (_) { /* ignore */ }
  return null;
}

function tokenMessage(t) {
  return [
    t.id,
    t.value_paise,
    t.issued_to_user_id,
    t.issued_to_device,
    t.issued_at,
    t.expires_at,
  ].join('|');
}

/**
 * Verify a single token's Ed25519 signature against the cached public key.
 * Returns:
 *   true   — verified
 *   false  — tampered or forged
 *   null   — can't verify (no Ed25519 sig on token, or SubtleCrypto missing)
 */
export async function verifyToken(token) {
  if (!token || typeof token !== 'object') return false;
  const sig = token.signature_ed25519;
  if (!sig) return null; // legacy token — defer to server
  const lib = window.ed25519;
  if (!lib || typeof lib.verify !== 'function') return null;
  const pub = await getPublicKeyHex();
  if (!pub) return null;
  const result = await lib.verify(sig, tokenMessage(token), pub);
  return result === null ? null : !!result;
}

/**
 * Verify every token in a payload. Returns:
 *   { ok: true  }                          — all verified or deferred
 *   { ok: false, failures: [tokenId, …] }  — at least one failed
 */
export async function verifyPayload(payload) {
  if (!payload || !Array.isArray(payload.tokens)) {
    return { ok: false, failures: ['missing_tokens'] };
  }
  const failures = [];
  for (const t of payload.tokens) {
    const r = await verifyToken(t);
    if (r === false) failures.push(t.id);
  }
  return failures.length ? { ok: false, failures } : { ok: true };
}
