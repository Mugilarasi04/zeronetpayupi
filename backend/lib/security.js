// Centralised security middleware: helmet (headers), rate limiters, and
// a lightweight global kill-switch gate.
//
// The kill switch is backed by a single row in app_settings (key='frozen')
// so toggling via the admin endpoint survives restarts. Any mutating API
// call aborts with 503 when frozen.

const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('./db');

// Standard helmet config, loosened only where our PWA actually needs it:
//  - 'img-src *' because we display UPI deeplink QR screenshots and the
//    user's camera canvas as data: URLs.
//  - 'connect-src' permits the API host — set via env for prod.
const CONNECT_SRC = (process.env.CONNECT_SRC_ALLOW || "'self' https:").split(/\s+/);
const headers = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],                 // no inline scripts in prod
      "script-src-elem": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // we use inline <style> on audit.html
      "img-src": ["'self'", "data:", "blob:"],
      "font-src": ["'self'", "data:"],
      "connect-src": CONNECT_SRC,
      "frame-ancestors": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "object-src": ["'none'"],
      "upgrade-insecure-requests": [],
    },
  },
  crossOriginEmbedderPolicy: false,  // SW + Cloudflare combo chokes on COEP
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

// IP keyer that peeks at Cloudflare's CF-Connecting-IP, falls back to
// XFF, then to req.ip. Uses the library's ipKeyGenerator helper so
// IPv6 clients are canonicalised correctly (one /64 subnet → one key)
// instead of each ::XXXX getting its own bucket.
function cfKey(req) {
  const raw =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip;
  return ipKeyGenerator(raw);
}

// 10 writes/minute from any IP against auth/load/redeem/pair endpoints.
// Reads (GET) stay unlimited.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: cfKey,
  message: { error: 'rate_limited', message: 'Too many requests. Try again in a minute.' },
});

// Stricter cap on pair-code FETCH to deter 6-digit brute force (999,999
// codes → 5/min = would take years to enumerate).
const pairFetchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: cfKey,
  skip: (req) => req.method !== 'GET',
  message: { error: 'rate_limited', message: 'Too many pair-code attempts.' },
});

// --- Kill switch ---
async function isFrozen() {
  try {
    const row = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('global_frozen');
    return row && row.value === 'true';
  } catch (_) {
    return false;
  }
}

async function setFrozen(frozen) {
  const v = frozen ? 'true' : 'false';
  await db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('global_frozen', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(v, Date.now());
}

// Middleware that gates mutating API calls while the system is frozen.
async function freezeGate(req, res, next) {
  // Permit GETs so the proof-of-reserves page still renders.
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  // Permit the unfreeze endpoint and health.
  if (
    req.path === '/api/admin/unfreeze' ||
    req.path === '/api/health'
  ) return next();
  if (await isFrozen()) {
    return res.status(503).json({
      error: 'system_frozen',
      message: 'ZeroNetPay is temporarily frozen by the operator. Try again later.',
    });
  }
  next();
}

// Lightweight admin auth — requires X-Admin-Token header matching
// ADMIN_TOKEN env var. Not fancy, but sufficient to prevent the kill
// switch being tripped by anyone with the URL.
function adminGate(req, res, next) {
  const want = process.env.ADMIN_TOKEN;
  if (!want) {
    return res.status(503).json({
      error: 'admin_not_configured',
      message: 'ADMIN_TOKEN env var not set on the server.',
    });
  }
  const got = req.headers['x-admin-token'];
  if (got !== want) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

module.exports = {
  headers,
  writeLimiter,
  pairFetchLimiter,
  freezeGate,
  adminGate,
  isFrozen,
  setFrozen,
};
