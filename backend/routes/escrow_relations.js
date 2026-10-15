const express = require('express');
const rel = require('../lib/escrow_relations');

const router = express.Router();

// POST /api/escrow/request
// body: { userId, byUpiOrPhone }   — the requesting user; identifier of the proposed escrow
router.post('/request', async (req, res, next) => {
  try {
    const { userId, byUpiOrPhone } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId required' });
    if (!byUpiOrPhone) return res.status(400).json({ error: 'escrow upi/phone required' });
    const escrowUser = await rel.lookupUserByUpiOrPhone(byUpiOrPhone);
    if (!escrowUser) {
      return res.status(404).json({
        error: 'escrow_user_not_registered',
        message: 'The person you picked has not registered on ZeroNetPay yet. Ask them to onboard first.',
      });
    }
    const r = await rel.requestEscrow({ userId, escrowUserId: escrowUser.id });
    res.json({
      ...r,
      escrowUser: { id: escrowUser.id, upiId: escrowUser.upi_id, phone: escrowUser.phone },
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// POST /api/escrow/:id/approve   body: { approverUserId }
router.post('/:id/approve', async (req, res, next) => {
  try {
    const { approverUserId } = req.body || {};
    if (!approverUserId) return res.status(400).json({ error: 'approverUserId required' });
    const r = await rel.approveEscrow({ relationshipId: req.params.id, approverUserId });
    res.json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// POST /api/escrow/:id/reject    body: { approverUserId }
router.post('/:id/reject', async (req, res, next) => {
  try {
    const { approverUserId } = req.body || {};
    if (!approverUserId) return res.status(400).json({ error: 'approverUserId required' });
    const r = await rel.rejectEscrow({ relationshipId: req.params.id, approverUserId });
    res.json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// POST /api/escrow/:id/revoke    body: { byUserId }
router.post('/:id/revoke', async (req, res, next) => {
  try {
    const { byUserId } = req.body || {};
    if (!byUserId) return res.status(400).json({ error: 'byUserId required' });
    const r = await rel.revokeEscrow({ relationshipId: req.params.id, byUserId });
    res.json(r);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// GET /api/escrow/active/:userId
router.get('/active/:userId', async (req, res, next) => {
  try {
    const r = await rel.activeEscrowFor(req.params.userId);
    res.json({ active: r });
  } catch (e) { next(e); }
});

// GET /api/escrow/outgoing/:userId — relationships I requested (where I'm the user)
router.get('/outgoing/:userId', async (req, res, next) => {
  try {
    res.json({ rows: await rel.mineOutgoing(req.params.userId) });
  } catch (e) { next(e); }
});

// GET /api/escrow/incoming/:userId — relationships proposed TO me (I'm the escrow)
router.get('/incoming/:userId', async (req, res, next) => {
  try {
    res.json({ rows: await rel.mineIncoming(req.params.userId) });
  } catch (e) { next(e); }
});

module.exports = router;
