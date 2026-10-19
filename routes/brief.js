// routes/brief.js
// POST /api/brief — one turn of the AI brief assistant chat.

const express = require('express');
const rateLimit = require('express-rate-limit');
const { continueBrief, BriefInputError } = require('../utils/briefAssistant');

const router = express.Router();

// Each chat is a handful of calls, so this allows several chats per visitor
// while stopping anyone from using the assistant as a free chatbot.
const briefLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'The assistant is taking a break. Please fill in the form directly.' },
});

// A daily ceiling on AI calls across the whole site, as a backstop on API costs.
const DAILY_LIMIT = Number(process.env.BRIEF_DAILY_LIMIT) || 500;
let usage = { day: null, count: 0 };
function underDailyLimit() {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) usage = { day: today, count: 0 };
  if (usage.count >= DAILY_LIMIT) return false;
  usage.count += 1;
  return true;
}

router.post('/', briefLimiter, async (req, res) => {
  try {
    if (!underDailyLimit()) {
      return res.status(429).json({ error: 'The assistant is busy right now. Please fill in the form directly.' });
    }
    const result = await continueBrief(req.body && req.body.messages);
    res.json(result);
  } catch (err) {
    if (err instanceof BriefInputError) return res.status(400).json({ error: err.message });
    console.error('Brief assistant failed:', err.message);
    res.status(502).json({ error: "The assistant couldn't reply just now. Please try again, or fill in the form directly." });
  }
});

router._resetUsage = () => { usage = { day: null, count: 0 }; }; // for tests

module.exports = router;
