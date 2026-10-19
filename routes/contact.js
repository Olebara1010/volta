const express = require('express');
const validator = require('validator');
const db = require('../db/database');
const { sendContactNotification, sendContactConfirmation } = require('../utils/mailer');
const { requireAdmin } = require('../middleware/adminAuth');
const { honeypot, text, ValidationError } = require('../middleware/security');

const router = express.Router();

// ── POST /api/contact ──────────────────────────────────────
router.post('/', honeypot({ message: "Message received! We'll be in touch soon." }), async (req, res) => {
  try {
    let name, email, subject, message;
    try {
      name = text(req.body.name, 'Name', 100, { required: true });
      email = text(req.body.email, 'Email', 254, { required: true });
      subject = text(req.body.subject, 'Subject', 200);
      message = text(req.body.message, 'Message', 5000, { required: true });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    if (!validator.isEmail(email))
      return res.status(400).json({ error: 'Invalid email address.' });
    if (message.length < 10)
      return res.status(400).json({ error: 'Message is too short.' });

    await db.createContact({
      name,
      email: email.toLowerCase(),
      subject: subject || null,
      message,
    });

    Promise.all([
      sendContactNotification({ name, email, subject, message }),
      sendContactConfirmation({ name, email }),
    ]).catch(err => console.error('Email error:', err.message));

    res.status(201).json({ message: "Message received! We'll be in touch soon." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── GET /api/contact — list all (admin only) ──
router.get('/', requireAdmin, async (req, res) => {
  try {
    const contacts = await db.getContacts();
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;
