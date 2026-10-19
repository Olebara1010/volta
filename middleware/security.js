// middleware/security.js
// Security headers, a honeypot spam trap, and helpers for validating form input.

const helmet = require('helmet');

// ── Security headers ───────────────────────────────────────
// The pages use inline <script> blocks and onclick handlers, so the Content
// Security Policy allows inline code but nothing from other sites except
// Google Fonts. Everything else (frames, plugins, other script hosts) is blocked.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
      'img-src': ["'self'", 'data:', 'https:'],
      'connect-src': ["'self'"],
      'form-action': ["'self'", 'https://checkout.stripe.com'],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
    },
  },
});

// ── Honeypot spam trap ─────────────────────────────────────
// Each public form has a hidden "website" field. People never see it, so it
// stays empty; bots fill in every field. When it's filled, we reply with a
// normal-looking success so the bot moves on, but nothing is saved or emailed.
const HONEYPOT_FIELD = 'website';

function honeypot(fakeBody, status = 201) {
  return (req, res, next) => {
    const trap = req.body && req.body[HONEYPOT_FIELD];
    if (trap) {
      console.warn(`🍯 Honeypot caught a bot submission on ${req.originalUrl}`);
      return res.status(status).json(fakeBody);
    }
    next();
  };
}

// ── Input helpers ──────────────────────────────────────────
class ValidationError extends Error {}

// Returns a trimmed string, or undefined when empty. Rejects anything that
// isn't a string (e.g. an object used to inject a database query) and anything
// over `max` characters.
function text(value, field, max, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new ValidationError(`${field} is required.`);
    return undefined;
  }
  if (trimmed.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer.`);
  return trimmed;
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw new ValidationError(`Please choose a valid ${field}.`);
  return value;
}

module.exports = { securityHeaders, honeypot, HONEYPOT_FIELD, text, oneOf, ValidationError };
