// server.js — Volta Studio Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { securityHeaders } = require('./middleware/security');

const app = express();

// ── Connect to MongoDB ─────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/volta')
  .then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

// ── Middleware ─────────────────────────────────────────────
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));

// Stripe webhook needs the RAW request body to verify its signature, so this
// route is registered before express.json() runs and is exempt from it.
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), require('./routes/stripeWebhook'));

// Small JSON limit: no form on the site sends anywhere near this much.
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting — protect all API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use('/api/', apiLimiter);

// Stricter limit for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again later.' },
});
app.use('/api/auth/', authLimiter);

// ── Routes ─────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/contact',    require('./routes/contact'));
app.use('/api/newsletter', require('./routes/newsletter'));
app.use('/api/requests',   require('./routes/projectRequests'));
app.use('/api/brief',      require('./routes/brief'));
app.use('/api/admin',      require('./routes/admin'));

// ── Health check ───────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Serve frontend for all other routes ───────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`⚡ Volta server running on http://localhost:${PORT}`));
