// IndexedDB wrapper for offline-first token storage.
//
// Stores:
//   tokens         — wallet tokens (mine, owned by this device)
//   pending        — tokens received offline awaiting redemption
//   ledger         — local transaction log (load / send / receive / redeem)

const DB_NAME = 'zeronetpay';
const DB_VERSION = 1;

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

function tx(store, mode = 'readonly') {
  return db().then((d) => d.transaction(store, mode).objectStore(store));
}

function reqP(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const store = {
  // ---- Tokens ----
  async addTokens(tokens) {
    const s = await tx('tokens', 'readwrite');
    for (const t of tokens) s.put(t);
    return new Promise((res, rej) => {
      s.transaction.oncomplete = () => res();
      s.transaction.onerror = () => rej(s.transaction.error);
    });
  },
  async listTokens() {
    return reqP((await tx('tokens')).getAll());
  },
  async getToken(id) {
    return reqP((await tx('tokens')).get(id));
  },
  async removeTokens(ids) {
    const s = await tx('tokens', 'readwrite');
    for (const id of ids) s.delete(id);
    return new Promise((res, rej) => {
      s.transaction.oncomplete = () => res();
      s.transaction.onerror = () => rej(s.transaction.error);
    });
  },
  async clearTokens() {
    return reqP((await tx('tokens', 'readwrite')).clear());
  },

  // ---- Pending (received tokens awaiting redemption) ----
  async addPending(p) {
    return reqP((await tx('pending', 'readwrite')).put(p));
  },
  async listPending() {
    return reqP((await tx('pending')).getAll());
  },
  async removePending(id) {
    return reqP((await tx('pending', 'readwrite')).delete(id));
  },

  // ---- Ledger ----
  async addLedger(entry) {
    return reqP((await tx('ledger', 'readwrite')).put(entry));
  },
  async listLedger() {
    const all = await reqP((await tx('ledger')).getAll());
    return all.sort((a, b) => b.ts - a.ts);
  },
  async clearLedger() {
    return reqP((await tx('ledger', 'readwrite')).clear());
  },
};
