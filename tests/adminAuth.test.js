// Tests for the admin-only route protection.
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';
const { requireAdmin } = require('../middleware/adminAuth');

const app = express();
app.get('/admin-only', requireAdmin, (req, res) => res.json({ ok: true }));

test('rejects requests with no token', async () => {
  const res = await request(app).get('/admin-only');
  expect(res.status).toBe(401);
});

test('rejects a valid token that is not an admin token', async () => {
  const token = jwt.sign({ userId: 1 }, 'test-secret');
  const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(403);
});

test('rejects a token signed with the wrong secret', async () => {
  const token = jwt.sign({ admin: true }, 'not-the-secret');
  const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(401);
});

test('allows a valid admin token', async () => {
  const token = jwt.sign({ admin: true }, 'test-secret');
  const res = await request(app).get('/admin-only').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
});
