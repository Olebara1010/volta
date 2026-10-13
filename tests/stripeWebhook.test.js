// Tests for the Stripe webhook. Uses Stripe's own library to sign test payloads,
// so signature verification is exercised for real.
jest.mock('../db/database', () => ({
  getProjectRequestById: jest.fn(),
  markDepositPaid: jest.fn(),
  markFullPaymentPaid: jest.fn(),
  respondToCounter: jest.fn(),
}));
jest.mock('../utils/mailer', () => ({
  sendDepositConfirmation: jest.fn().mockResolvedValue(),
  sendDepositNotification: jest.fn().mockResolvedValue(),
  sendFinalPaymentConfirmation: jest.fn().mockResolvedValue(),
  sendFinalPaymentNotification: jest.fn().mockResolvedValue(),
}));

const express = require('express');
const request = require('supertest');
const Stripe = require('stripe');
const db = require('../db/database');
const mailer = require('../utils/mailer');

const SECRET = 'whsec_test_secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

// Same wiring as server.js: raw body parser before the handler.
const app = express();
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), require('../routes/stripeWebhook'));

const stripe = Stripe('sk_test_dummy');

function checkoutEvent(metadata, amountPence = 50000) {
  return JSON.stringify({
    id: 'evt_test',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_123', amount_total: amountPence, metadata } },
  });
}

function send(payload, { signWith = SECRET } = {}) {
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: signWith });
  return request(app)
    .post('/api/stripe-webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header)
    .send(payload);
}

beforeEach(() => jest.clearAllMocks());

test('rejects a request with an invalid signature and changes nothing', async () => {
  const res = await send(checkoutEvent({ requestId: 'abc', paymentType: 'deposit' }), { signWith: 'whsec_wrong' });

  expect(res.status).toBe(400);
  expect(db.markDepositPaid).not.toHaveBeenCalled();
});

test('a paid deposit marks the project as deposit-paid and emails both parties', async () => {
  db.markDepositPaid.mockResolvedValue({ _id: 'abc' });

  const res = await send(checkoutEvent({ requestId: 'abc', paymentType: 'deposit' }, 50000));

  expect(res.status).toBe(200);
  expect(db.markDepositPaid).toHaveBeenCalledWith('abc', { amount: 500, sessionId: 'cs_test_123' });
  expect(mailer.sendDepositConfirmation).toHaveBeenCalled();
  expect(mailer.sendDepositNotification).toHaveBeenCalled();
});

test('a paid balance marks the project as paid in full', async () => {
  db.markFullPaymentPaid.mockResolvedValue({ _id: 'abc' });

  const res = await send(checkoutEvent({ requestId: 'abc', paymentType: 'balance' }, 150000));

  expect(res.status).toBe(200);
  expect(db.markFullPaymentPaid).toHaveBeenCalledWith('abc', { amount: 1500, sessionId: 'cs_test_123' });
  expect(db.markDepositPaid).not.toHaveBeenCalled();
});

test('paying from a counter-offer link accepts the counter-offer first', async () => {
  db.getProjectRequestById.mockResolvedValue({ _id: 'abc', negotiationStatus: 'countered' });
  db.markDepositPaid.mockResolvedValue({ _id: 'abc' });

  await send(checkoutEvent({ requestId: 'abc', paymentType: 'deposit', acceptCounter: 'true' }));

  expect(db.respondToCounter).toHaveBeenCalledWith('abc', 'accepted');
  expect(db.markDepositPaid).toHaveBeenCalled();
});

test('returns 500 if Stripe is not configured', async () => {
  const saved = process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const res = await send(checkoutEvent({ requestId: 'abc' }));
  process.env.STRIPE_WEBHOOK_SECRET = saved;

  expect(res.status).toBe(500);
});
