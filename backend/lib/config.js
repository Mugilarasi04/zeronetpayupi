const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Lightweight .env loader (no dependency on dotenv)
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

// Generate and persist a token-signing secret if one was not provided.
function resolveTokenSecret() {
  if (process.env.TOKEN_SECRET && process.env.TOKEN_SECRET.length >= 32) {
    return process.env.TOKEN_SECRET;
  }
  const secretFile = path.resolve(__dirname, '..', 'data', '.token-secret');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  tokenSecret: resolveTokenSecret(),
  tokenDenomination: parseFloat(process.env.TOKEN_DENOMINATION || '10'),
  tokenExpiryDays: parseInt(process.env.TOKEN_EXPIRY_DAYS || '30', 10),
  escrowBankName: process.env.ESCROW_BANK_NAME || 'ZeroNetPay Escrow',
  isProduction: process.env.NODE_ENV === 'production',
  dbPath: path.resolve(__dirname, '..', 'data', 'zeronetpay.db'),
};
