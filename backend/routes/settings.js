const express = require('express');
const db = require('../lib/db');
const config = require('../lib/config');
const { UPI_REGEX } = require('../lib/upi');

const router = express.Router();

function readSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function writeSetting(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}

const ESCROW_LOCKED = String(process.env.ESCROW_LOCKED || '').toLowerCase() === 'true';

// Seed escrow_name with the env default if absent.
if (!readSetting('escrow_name')) {
  writeSetting('escrow_name', config.escrowBankName);
}
// Trim whitespace/newlines that dashboards sometimes append when pasting.
const CLEAN_ESCROW_UPI = (process.env.ESCROW_UPI_ID || '').trim();

// When ESCROW_LOCKED, force the DB value to match .env on every startup —
// prevents drift from earlier unlocked editing. Otherwise only seed if empty.
if (ESCROW_LOCKED && CLEAN_ESCROW_UPI) {
  writeSetting('escrow_upi_id', CLEAN_ESCROW_UPI);
} else if (!readSetting('escrow_upi_id') && CLEAN_ESCROW_UPI) {
  writeSetting('escrow_upi_id', CLEAN_ESCROW_UPI);
}

// Optional operator contact — used by the frontend to build a WhatsApp
// deeplink so users can ping the escrow holder when a payout is queued.
// Format: country code + number, no + or spaces, e.g. "919876543210".
const ESCROW_WHATSAPP = (process.env.ESCROW_WHATSAPP || '').trim();
const ESCROW_OPERATOR_NAME = (process.env.ESCROW_OPERATOR_NAME || 'Escrow Operator').trim();

router.get('/', (req, res) => {
  res.json({
    escrowUpiId: readSetting('escrow_upi_id'),
    escrowName: readSetting('escrow_name') || config.escrowBankName,
    configured: !!readSetting('escrow_upi_id'),
    locked: ESCROW_LOCKED,
    escrowWhatsApp: ESCROW_WHATSAPP,
    escrowOperatorName: ESCROW_OPERATOR_NAME,
  });
});

router.put('/', (req, res) => {
  const { escrowUpiId, escrowName } = req.body || {};
  if (escrowUpiId !== undefined) {
    if (ESCROW_LOCKED) {
      return res.status(403).json({
        error: 'escrow_locked',
        message: 'Escrow UPI ID is locked by the operator and cannot be changed from the app.',
      });
    }
    if (!escrowUpiId || !UPI_REGEX.test(escrowUpiId)) {
      return res.status(400).json({ error: 'invalid escrowUpiId (expected name@bank)' });
    }
    writeSetting('escrow_upi_id', escrowUpiId);
  }
  if (escrowName !== undefined) {
    const trimmed = String(escrowName).trim().slice(0, 80);
    if (!trimmed) return res.status(400).json({ error: 'escrowName cannot be empty' });
    writeSetting('escrow_name', trimmed);
  }
  res.json({
    escrowUpiId: readSetting('escrow_upi_id'),
    escrowName: readSetting('escrow_name'),
    configured: !!readSetting('escrow_upi_id'),
    locked: ESCROW_LOCKED,
  });
});

module.exports = { router, readSetting, writeSetting };
