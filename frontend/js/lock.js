// App lock module.
//
// Lock state lives in sessionStorage (`znp.unlocked` = "1"), which the
// browser clears when the tab is closed. So every fresh open of the app
// requires re-auth via biometric or PIN.
//
// PIN is hashed (SHA-256 + fixed 8-byte salt) and stored in localStorage.
// The salt is per-install (random on first PIN setup), which is enough to
// prevent trivial rainbow-table attacks on the demo. For production, use
// PBKDF2/argon2 and a server-side check.

const KEY_PIN_HASH = 'znp.pin.hash';
const KEY_PIN_SALT = 'znp.pin.salt';
const KEY_UNLOCKED = 'znp.unlocked';
const KEY_FAILS    = 'znp.pin.fails';   // JSON array of failure ts (ms)

// Throttling tiers — all per-tab local, so a wipe-and-reinstall also
// resets. For hackathon scope that's fine; a production build would
// also throttle server-side.
const SOFT_LOCK_AFTER = 5;         // 5 wrong in SOFT_WINDOW → 1-hour lockout
const SOFT_WINDOW_MS  = 10 * 60 * 1000;
const SOFT_LOCKOUT_MS = 60 * 60 * 1000;
const HARD_WIPE_AFTER = 20;        // 20 wrong in HARD_WINDOW → wipe wallet
const HARD_WINDOW_MS  = 24 * 60 * 60 * 1000;

function toHex(bytes) {
  const arr = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, '0');
  return s;
}

function randomSalt() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return toHex(a);
}

async function hashPin(pin, salt) {
  const enc = new TextEncoder().encode(salt + '::' + pin);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  return toHex(digest);
}

export function hasPin() {
  return !!localStorage.getItem(KEY_PIN_HASH);
}

export async function setPin(pin) {
  if (!/^\d{4,6}$/.test(pin)) return false;
  const salt = localStorage.getItem(KEY_PIN_SALT) || randomSalt();
  const hash = await hashPin(pin, salt);
  localStorage.setItem(KEY_PIN_SALT, salt);
  localStorage.setItem(KEY_PIN_HASH, hash);
  return true;
}

function loadFails() {
  try {
    const raw = localStorage.getItem(KEY_FAILS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'number') : [];
  } catch (_) { return []; }
}
function saveFails(arr) {
  localStorage.setItem(KEY_FAILS, JSON.stringify(arr));
}

/**
 * Returns the lockout status before any PIN entry attempt. Views call
 * this to disable the submit button and show a countdown.
 */
export function lockoutStatus() {
  const now = Date.now();
  const fails = loadFails();
  const recentSoft = fails.filter((t) => now - t < SOFT_WINDOW_MS);
  const recentHard = fails.filter((t) => now - t < HARD_WINDOW_MS);
  if (recentHard.length >= HARD_WIPE_AFTER) {
    return { locked: true, wipeRequired: true, until: 0, failCount: recentHard.length };
  }
  if (recentSoft.length >= SOFT_LOCK_AFTER) {
    const until = recentSoft[0] + SOFT_LOCKOUT_MS;
    if (until > now) {
      return { locked: true, wipeRequired: false, until, failCount: recentSoft.length };
    }
  }
  return { locked: false, wipeRequired: false, until: 0, failCount: recentSoft.length };
}

export async function verifyPin(pin) {
  if (!/^\d{4,6}$/.test(pin || '')) return { ok: false, reason: 'format' };
  const status = lockoutStatus();
  if (status.locked) {
    return { ok: false, reason: status.wipeRequired ? 'wipe' : 'locked', retryAt: status.until };
  }
  const salt = localStorage.getItem(KEY_PIN_SALT);
  const stored = localStorage.getItem(KEY_PIN_HASH);
  if (!salt || !stored) return { ok: false, reason: 'not_set' };
  const hash = await hashPin(pin, salt);
  if (hash === stored) {
    // Successful auth clears throttle history.
    localStorage.removeItem(KEY_FAILS);
    return { ok: true };
  }
  const fails = loadFails();
  fails.push(Date.now());
  // Trim anything older than the longest window to keep storage small.
  const now = Date.now();
  saveFails(fails.filter((t) => now - t < HARD_WINDOW_MS));
  const next = lockoutStatus();
  return {
    ok: false,
    reason: next.wipeRequired ? 'wipe' : (next.locked ? 'locked' : 'wrong'),
    retryAt: next.until,
    failCount: next.failCount,
    attemptsLeft: Math.max(0, SOFT_LOCK_AFTER - next.failCount),
  };
}

export function clearFails() {
  localStorage.removeItem(KEY_FAILS);
}

export function clearPin() {
  localStorage.removeItem(KEY_PIN_HASH);
  localStorage.removeItem(KEY_PIN_SALT);
}

export function isUnlocked() {
  return sessionStorage.getItem(KEY_UNLOCKED) === '1';
}

export function unlockApp() {
  sessionStorage.setItem(KEY_UNLOCKED, '1');
}

export function lockApp() {
  sessionStorage.removeItem(KEY_UNLOCKED);
}
