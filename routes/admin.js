// routes/admin.js
// Wired into server.js via: app.use('/api/admin', require('./routes/admin'));

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/adminAuth');

// POST /api/admin/login — the single admin password check.
// Set ADMIN_PASSWORD in your .env — this route only works once that's there.
router.post('/login', (req, res) => {
  const { password } = req.body;

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not set in your environment — add it to .env first.' });
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// GET /api/admin/settings — current pricing minimums
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await db.getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/settings — update pricing minimums / rush multiplier
router.put('/settings', requireAdmin, async (req, res) => {
  try {
    const { simple_website, ecommerce, mobile_app, web_app, not_sure, rushMultiplier, depositPercentage } = req.body;
    const updates = {};
    // Only accept real numbers — silently ignore anything malformed rather than
    // let a bad request zero out your prices.
    [['simple_website', simple_website], ['ecommerce', ecommerce], ['mobile_app', mobile_app],
     ['web_app', web_app], ['not_sure', not_sure], ['rushMultiplier', rushMultiplier],
     ['depositPercentage', depositPercentage]]
      .forEach(([key, val]) => {
        if (typeof val === 'number' && !Number.isNaN(val) && val > 0) updates[key] = val;
      });

    const updated = await db.updateSettings(updates);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
