const express = require('express');
const validator = require('validator');
const db = require('../db/database');
const { sendNewsletterWelcome, sendSubscriberNotification } = require('../utils/mailer');

const router = express.Router();

// ── POST /api/newsletter/subscribe ────────────────────────
router.post('/subscribe', async (req, res) => {
  try {
    const { email, name } = req.body;

    if (!email) return res.status(400).json({ error: 'Email is required.' });
    if (!validator.isEmail(email)) return res.status(400).json({ error: 'Invalid email address.' });

    const existing = await db.getSubscriberByEmail(email.toLowerCase());

    if (existing) {
      if (existing.subscribed)
        return res.status(409).json({ error: 'This email is already subscribed.' });
      await db.resubscribe(email.toLowerCase(), name?.trim() || null);
      return res.json({ message: "Welcome back! You've been re-subscribed." });
    }

    await db.createSubscriber({ email: email.toLowerCase(), name: name?.trim() || null });

    Promise.all([
      sendNewsletterWelcome({ name, email }),
      sendSubscriberNotification({ name, email }),
    ]).catch(err => console.error('Email error:', err.message));

    res.status(201).json({ message: "You're subscribed! Check your inbox for a welcome email." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/newsletter/unsubscribe ──────────────────────
router.post('/unsubscribe', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const count = await db.unsubscribe(email.toLowerCase());
    if (count === 0) return res.status(404).json({ error: 'Email not found.' });

    res.json({ message: "You've been unsubscribed successfully." });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ── GET /api/newsletter/subscribers — list all ────────────
router.get('/subscribers', async (req, res) => {
  try {
    const subscribers = await db.getSubscribers();
    res.json({
      subscribers,
      total: subscribers.length,
      active: subscribers.filter(s => s.subscribed).length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;
