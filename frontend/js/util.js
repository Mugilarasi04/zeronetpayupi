// Shared utilities: formatting, IDs, toasts, network detection.

export function rupees(paise) {
  return (paise / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });
}

export function rupeesPlain(paise) {
  return '₹' + (paise / 100).toFixed(paise % 100 ? 2 : 0);
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString();
}

export function formatRelative(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

export function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let toastTimer = null;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

export function isOnline() {
  return navigator.onLine;
}

export function deviceFingerprint() {
  const stored = localStorage.getItem('znp.device');
  if (stored) return stored;
  const fp =
    'dev_' +
    (crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36));
  localStorage.setItem('znp.device', fp);
  return fp;
}

// Loose UPI VPA validator. Mirrors backend/lib/upi.js.
export const UPI_REGEX = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z0-9.\-_]{2,}$/;
export function isValidUpi(s) {
  return typeof s === 'string' && UPI_REGEX.test(s.trim());
}

/**
 * Build a WhatsApp deeplink for a phone number (with country code) + prefilled
 * message text. Returns null if the phone is missing / obviously invalid so
 * callers can hide the button.
 */
export function whatsappLink(phone, message) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message || '')}`;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isMobile() {
  // Coarse pointer + small viewport ≈ a phone or tablet.
  // We check user agent too because some Android browsers misreport.
  const ua = (navigator.userAgent || '').toLowerCase();
  if (/android|iphone|ipad|ipod|mobile|opera mini/.test(ua)) return true;
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
  return false;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall through to legacy path */
  }
  // Fallback for older browsers / non-secure contexts.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (_) {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}
