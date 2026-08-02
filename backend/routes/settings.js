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
// When ESCROW_LOCKED, force the DB value to match .env on every startup —
// prevents drift from earlier unlocked editing. Otherwise only seed if empty.
if (ESCROW_LOCKED && process.env.ESCROW_UPI_ID) {
  writeSetting('escrow_upi_id', process.env.ESCROW_UPI_ID);
} else if (!readSetting('escrow_upi_id') && process.env.ESCROW_UPI_ID) {
  writeSetting('escrow_upi_id', process.env.ESCROW_UPI_ID);
}

router.get('/', (req, res) => {
  res.json({
    escrowUpiId: readSetting('escrow_upi_id'),
    escrowName: readSetting('escrow_name') || config.escrowBankName,
    configured: !!readSetting('escrow_upi_id'),
    locked: ESCROW_LOCKED,
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
