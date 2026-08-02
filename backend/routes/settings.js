const express = require('express');
const db = require('../lib/db');
const config = require('../lib/config');
const { UPI_REGEX } = require('../lib/upi');

const router = express.Router();

const ESCROW_LOCKED = String(process.env.ESCROW_LOCKED || '').toLowerCase() === 'true';
const CLEAN_ESCROW_UPI = (process.env.ESCROW_UPI_ID || '').trim();
const ESCROW_WHATSAPP = (process.env.ESCROW_WHATSAPP || '').trim();
const ESCROW_OPERATOR_NAME = (process.env.ESCROW_OPERATOR_NAME || 'Escrow Operator').trim();

// Simple in-memory cache to avoid a DB round-trip on every /api/settings GET.
// Invalidated on writes below.
let cache = { escrow_upi_id: null, escrow_name: null };
let cacheReady = false;

async function readSetting(key) {
  if (cacheReady && key in cache) return cache[key];
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  const v = row ? row.value : null;
  if (cacheReady) cache[key] = v;
  return v;
}

async function writeSetting(key, value) {
  await db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
  if (cacheReady) cache[key] = value;
}

/**
 * Async seed called by server.js after db.init().
 */
async function seed() {
  if (!(await readSetting('escrow_name'))) {
    await writeSetting('escrow_name', config.escrowBankName);
  }
  if (ESCROW_LOCKED && CLEAN_ESCROW_UPI) {
    await writeSetting('escrow_upi_id', CLEAN_ESCROW_UPI);
  } else if (!(await readSetting('escrow_upi_id')) && CLEAN_ESCROW_UPI) {
    await writeSetting('escrow_upi_id', CLEAN_ESCROW_UPI);
  }
  // Warm cache.
  cache.escrow_upi_id = await readSetting('escrow_upi_id');
  cache.escrow_name = await readSetting('escrow_name');
  cacheReady = true;
}

router.get('/', async (req, res, next) => {
  try {
    const escrowUpiId = await readSetting('escrow_upi_id');
    res.json({
      escrowUpiId,
      escrowName: (await readSetting('escrow_name')) || config.escrowBankName,
      configured: !!escrowUpiId,
      locked: ESCROW_LOCKED,
      escrowWhatsApp: ESCROW_WHATSAPP,
      escrowOperatorName: ESCROW_OPERATOR_NAME,
    });
  } catch (e) { next(e); }
});

router.put('/', async (req, res, next) => {
  try {
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
      await writeSetting('escrow_upi_id', escrowUpiId);
    }
    if (escrowName !== undefined) {
      const trimmed = String(escrowName).trim().slice(0, 80);
      if (!trimmed) return res.status(400).json({ error: 'escrowName cannot be empty' });
      await writeSetting('escrow_name', trimmed);
    }
    res.json({
      escrowUpiId: await readSetting('escrow_upi_id'),
      escrowName: await readSetting('escrow_name'),
      configured: !!(await readSetting('escrow_upi_id')),
      locked: ESCROW_LOCKED,
    });
  } catch (e) { next(e); }
});

module.exports = { router, readSetting, writeSetting, seed };
