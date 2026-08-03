const express = require('express');
const db = require('../lib/db');
const { newId } = require('../lib/crypto');
const { UPI_REGEX } = require('../lib/upi');

const router = express.Router();

// Ensure phone column exists (post-release migration).
async function ensurePhoneColumn() {
  const rows = await db.prepare('PRAGMA table_info(users)').all();
  const hasPhone = rows.some((r) => r.name === 'phone');
  if (!hasPhone) {
    await db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
  }
}
const migrated = ensurePhoneColumn().catch((e) => console.warn('[auth] phone migration failed', e));

// Loose phone validator — accepts +91-prefix or plain 10-digit,
// with optional spaces/dashes. WhatsApp deeplinks need digits only,
// so we normalise on save.
function normalisePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  // Default to India (+91) if a bare 10-digit number was given.
  return digits.length === 10 ? '91' + digits : digits;
}

router.post('/register', async (req, res, next) => {
  try {
    await migrated;
    const { upiId, deviceId, publicKey, phone } = req.body || {};
    if (!upiId || !UPI_REGEX.test(upiId)) {
      return res.status(400).json({ error: 'invalid upiId (expected name@bank)' });
    }
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8) {
      return res.status(400).json({ error: 'invalid deviceId' });
    }
    const normalisedPhone = normalisePhone(phone);
    if (phone && !normalisedPhone) {
      return res.status(400).json({ error: 'invalid phone (10-15 digits)' });
    }

    const existing = await db
      .prepare('SELECT * FROM users WHERE upi_id = ? AND device_id = ?')
      .get(upiId, deviceId);
    if (existing) {
      // Backfill phone if the row pre-dates this feature.
      if (normalisedPhone && !existing.phone) {
        await db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(normalisedPhone, existing.id);
      }
      return res.json({
        user: {
          id: existing.id,
          upiId: existing.upi_id,
          deviceId: existing.device_id,
          phone: normalisedPhone || existing.phone || null,
        },
        isNew: false,
      });
    }

    const user = {
      id: newId('USR'),
      upi_id: upiId,
      device_id: deviceId,
      public_key: publicKey || null,
      phone: normalisedPhone,
      created_at: Date.now(),
    };
    await db.prepare(
      `INSERT INTO users (id, upi_id, device_id, public_key, phone, created_at)
       VALUES (@id, @upi_id, @device_id, @public_key, @phone, @created_at)`,
    ).run(user);

    res.json({
      user: {
        id: user.id,
        upiId: user.upi_id,
        deviceId: user.device_id,
        phone: user.phone,
      },
      isNew: true,
    });
  } catch (e) { next(e); }
});

router.get('/lookup', async (req, res, next) => {
  try {
    await migrated;
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    const row = await db.prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json({
      user: { id: row.id, upiId: row.upi_id, deviceId: row.device_id, phone: row.phone || null },
    });
  } catch (e) { next(e); }
});

module.exports = router;
