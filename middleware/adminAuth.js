// middleware/adminAuth.js
// Protects admin-only routes (viewing all requests, changing status, delivering
// files, editing pricing). This is separate from your existing user login system
// (routes/auth.js) — I don't have that file's internals, so rather than guess at
// its token shape and risk silently breaking it, this issues its own simple JWT
// signed with the same JWT_SECRET you already have in .env. One password, one
// admin — appropriate for a solo studio; revisit if this ever needs multiple staff.

const jwt = require('jsonwebtoken');

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Admin login required.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) {
      return res.status(403).json({ error: 'Not an admin token.' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired admin session — please log in again.' });
  }
}

module.exports = { requireAdmin };
