const express = require('express');
const validator = require('validator');
const db = require('../db/database');
const { sendContactNotification, sendContactConfirmation } = require('../utils/mailer');

const router = express.Router();

// ── POST /api/contact ──────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message)
      return res.status(400).json({ error: 'Name, email, and message are required.' });
    if (!validator.isEmail(email))
      return res.status(400).json({ error: 'Invalid email address.' });
    if (message.length < 10)
      return res.status(400).json({ error: 'Message is too short.' });

    await db.createContact({
      name: name.trim(),
      email: email.toLowerCase(),
      subject: subject?.trim() || null,
      message: message.trim(),
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

// ── GET /api/contact — list all (protected, future admin use) ──
router.get('/', async (req, res) => {
  try {
    const contacts = await db.getContacts();
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;
