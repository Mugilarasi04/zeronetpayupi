const express = require('express');
const db = require('../lib/db');
const { newId } = require('../lib/crypto');
const { UPI_REGEX } = require('../lib/upi');

const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const { upiId, deviceId, publicKey } = req.body || {};
    if (!upiId || !UPI_REGEX.test(upiId)) {
      return res.status(400).json({ error: 'invalid upiId (expected name@bank)' });
    }
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8) {
      return res.status(400).json({ error: 'invalid deviceId' });
    }

    const existing = await db
      .prepare('SELECT * FROM users WHERE upi_id = ? AND device_id = ?')
      .get(upiId, deviceId);
    if (existing) {
      return res.json({
        user: { id: existing.id, upiId: existing.upi_id, deviceId: existing.device_id },
        isNew: false,
      });
    }

    const user = {
      id: newId('USR'),
      upi_id: upiId,
      device_id: deviceId,
      public_key: publicKey || null,
      created_at: Date.now(),
    };
    await db.prepare(
      `INSERT INTO users (id, upi_id, device_id, public_key, created_at)
       VALUES (@id, @upi_id, @device_id, @public_key, @created_at)`,
    ).run(user);

    res.json({
      user: { id: user.id, upiId: user.upi_id, deviceId: user.device_id },
      isNew: true,
    });
  } catch (e) { next(e); }
});

router.get('/lookup', async (req, res, next) => {
  try {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
    const row = await db.prepare('SELECT * FROM users WHERE device_id = ?').get(deviceId);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json({ user: { id: row.id, upiId: row.upi_id, deviceId: row.device_id } });
  } catch (e) { next(e); }
});

module.exports = router;
