// AES-GCM-at-rest wrapper for the token store.
//
// Design:
//  - One AES-256-GCM key per device. Generated once via
//    SubtleCrypto.generateKey() with `extractable: false`, then stored
//    in IndexedDB (the key object itself cannot be exported, even by
//    an attacker with full page JS access).
//  - Every token object is JSON-serialised, encrypted with a fresh
//    96-bit nonce, and persisted as { id, ct_b64, iv_b64, meta: { id,
//    value_paise, received_from_upi, received_at, issued_at } }.
//    The meta fields are left in cleartext so UI can display the
//    wallet without decrypting every token on load (defensible —
//    device compromise sees the balance but can't exfiltrate signatures).
//  - On wallet reads we decrypt lazily per token.
//
// If SubtleCrypto isn't available (very old browsers), falls through
// to plaintext — the previous behaviour, so no regression.

const DB_NAME = 'zeronetpay';
const DB_VERSION = 2;          // bumped from 1 because we add a 'keys' store
const KEYS_STORE = 'keys';
const WRAPPED_KEY_ID = 'wallet-aes-gcm';

const SUBTLE = (typeof crypto !== 'undefined' && crypto.subtle) || null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tokens')) {
        db.createObjectStore('tokens', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pending')) {
        const s = db.createObjectStore('pending', { keyPath: 'id' });
        s.createIndex('receivedAt', 'receivedAt');
      }
      if (!db.objectStoreNames.contains('ledger')) {
        const s = db.createObjectStore('ledger', { keyPath: 'id' });
        s.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains(KEYS_STORE)) {
        db.createObjectStore(KEYS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let _db;
async function db() {
  if (!_db) _db = await openDB();
  return _db;
}

function reqP(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

let _keyPromise = null;
async function getOrCreateKey() {
  if (!SUBTLE) return null;
  if (_keyPromise) return _keyPromise;
  _keyPromise = (async () => {
    const d = await db();
    const existing = await reqP(d.transaction(KEYS_STORE).objectStore(KEYS_STORE).get(WRAPPED_KEY_ID));
    if (existing && existing.key) return existing.key;
    // Generate a non-extractable AES-GCM key. Non-extractable means even
    // if someone dumps IndexedDB they cannot export the raw key bits.
    const key = await SUBTLE.generateKey(
      { name: 'AES-GCM', length: 256 },
      /* extractable: */ false,
      ['encrypt', 'decrypt'],
    );
    await reqP(d.transaction(KEYS_STORE, 'readwrite').objectStore(KEYS_STORE).put({ id: WRAPPED_KEY_ID, key }));
    return key;
  })();
  return _keyPromise;
}

function b64enc(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64dec(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function encryptToken(token) {
  const key = await getOrCreateKey();
  if (!key) return { ...token, _plain: true };     // SubtleCrypto missing — fall back
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(token));
  const ct = await SUBTLE.encrypt({ name: 'AES-GCM', iv }, key, pt);
  // Keep a few cleartext meta fields so the Home view can show balance
  // without touching every token's ciphertext.
  return {
    id: token.id,                          // IndexedDB keyPath
    _enc: true,
    ct_b64: b64enc(ct),
    iv_b64: b64enc(iv),
    meta: {
      id: token.id,
      value_paise: token.value_paise,
      issued_at: token.issued_at,
      expires_at: token.expires_at,
      received_from_upi: token.received_from_upi || null,
      received_at: token.received_at || null,
    },
  };
}

async function decryptToken(row) {
  if (!row) return null;
  if (row._plain) {
    // Legacy / fallback — the row IS the token (minus the sentinel).
    const { _plain, ...t } = row;
    return t;
  }
  if (!row._enc) return row;             // very-legacy, plain object
  const key = await getOrCreateKey();
  if (!key) return row.meta;             // can't decrypt — only meta visible
  const ct = b64dec(row.ct_b64);
  const iv = b64dec(row.iv_b64);
  const pt = await SUBTLE.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

// Public store API — same shape as the old store.listTokens / addTokens /
// removeTokens / getToken / clearTokens so views don't need to change.
const secureStore = {
  async addTokens(tokens) {
    if (!tokens || !tokens.length) return;
    // CRITICAL: encrypt EVERY token BEFORE opening the IndexedDB transaction.
    // SubtleCrypto.encrypt yields the microtask queue, and IndexedDB auto-
    // commits any transaction that goes idle during an await — so doing
    // `tx = ...; await encrypt; store.put()` would hit TransactionInactiveError
    // on every token after the first (silently losing them, which is the
    // "received payment shows ₹0" bug).
    const encrypted = await Promise.all(tokens.map((t) => encryptToken(t)));
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('tokens', 'readwrite');
      const store = tx.objectStore('tokens');
      // All put() calls scheduled synchronously — no awaits inside the tx.
      for (const enc of encrypted) store.put(enc);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('tx aborted'));
    });
  },
  async listTokens() {
    const d = await db();
    const rows = await reqP(d.transaction('tokens').objectStore('tokens').getAll());
    const out = [];
    for (const r of rows) out.push(await decryptToken(r));
    return out;
  },
  async getToken(id) {
    const d = await db();
    const row = await reqP(d.transaction('tokens').objectStore('tokens').get(id));
    return decryptToken(row);
  },
  async removeTokens(ids) {
    const d = await db();
    const tx = d.transaction('tokens', 'readwrite');
    for (const id of ids) tx.objectStore('tokens').delete(id);
    return new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  },
  async clearTokens() {
    const d = await db();
    return reqP(d.transaction('tokens', 'readwrite').objectStore('tokens').clear());
  },
  // Pending + ledger stay plaintext — they contain only reference IDs
  // and amounts, not spendable secrets.
  async addPending(p) {
    const d = await db();
    return reqP(d.transaction('pending', 'readwrite').objectStore('pending').put(p));
  },
  async listPending() {
    const d = await db();
    return reqP(d.transaction('pending').objectStore('pending').getAll());
  },
  async removePending(id) {
    const d = await db();
    return reqP(d.transaction('pending', 'readwrite').objectStore('pending').delete(id));
  },
  async addLedger(entry) {
    const d = await db();
    return reqP(d.transaction('ledger', 'readwrite').objectStore('ledger').put(entry));
  },
  async listLedger() {
    const d = await db();
    const all = await reqP(d.transaction('ledger').objectStore('ledger').getAll());
    return all.sort((a, b) => b.ts - a.ts);
  },
  async clearLedger() {
    const d = await db();
    return reqP(d.transaction('ledger', 'readwrite').objectStore('ledger').clear());
  },
};

export { secureStore as store };
