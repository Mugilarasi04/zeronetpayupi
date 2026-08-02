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

export async function verifyPin(pin) {
  if (!/^\d{4,6}$/.test(pin || '')) return false;
  const salt = localStorage.getItem(KEY_PIN_SALT);
  const stored = localStorage.getItem(KEY_PIN_HASH);
  if (!salt || !stored) return false;
  const hash = await hashPin(pin, salt);
  return hash === stored;
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
