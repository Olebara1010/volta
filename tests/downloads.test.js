// Tests that delivered files stay locked until the project is paid in full.
jest.mock('../db/database', () => ({ getProjectRequestById: jest.fn() }));
jest.mock('../utils/mailer', () => ({}));
jest.mock('../utils/pricingCalculator', () => ({ generateQuote: jest.fn() }));

const express = require('express');
const request = require('supertest');
const db = require('../db/database');

const app = express();
app.use(express.json());
app.use('/api/requests', require('../routes/projectRequests'));

const file = { filename: '123-site.zip', originalName: 'site.zip' };

beforeEach(() => jest.clearAllMocks());

test('blocks downloads with 402 until the balance is paid', async () => {
  db.getProjectRequestById.mockResolvedValue({ _id: 'abc', fullPaymentPaid: false, deliveredFiles: [file] });

  const res = await request(app).get('/api/requests/abc/files/123-site.zip');

  expect(res.status).toBe(402);
});

test('returns 404 for an unknown project', async () => {
  db.getProjectRequestById.mockResolvedValue(null);
  const res = await request(app).get('/api/requests/nope/files/123-site.zip');
  expect(res.status).toBe(404);
});

test('returns 404 for a file that was never delivered, even when paid', async () => {
  db.getProjectRequestById.mockResolvedValue({ _id: 'abc', fullPaymentPaid: true, deliveredFiles: [file] });

  const res = await request(app).get('/api/requests/abc/files/..%2F..%2F.env');

  expect(res.status).toBe(404);
});
