// Tests for the security hardening: headers, spam trap, admin-only lists,
// field whitelisting on project requests, and HTML escaping in emails.
process.env.JWT_SECRET = 'test-secret';

jest.mock('../db/database', () => ({
  createContact: jest.fn(),
  getContacts: jest.fn(),
  getSubscribers: jest.fn(),
  getSubscriberByEmail: jest.fn(),
  createSubscriber: jest.fn(),
  createProjectRequest: jest.fn(),
  getProjectRequestById: jest.fn(),
  saveQuote: jest.fn(),
  markQuoteFailed: jest.fn(),
  getSettings: jest.fn(),
}));
jest.mock('../utils/mailer', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue() }));
jest.mock('../utils/pricingCalculator', () => ({ generateQuote: jest.fn() }));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { generateQuote } = require('../utils/pricingCalculator');
const { securityHeaders } = require('../middleware/security');

const app = express();
app.use(securityHeaders);
app.use(express.json({ limit: '100kb' }));
app.use('/api/contact', require('../routes/contact'));
app.use('/api/newsletter', require('../routes/newsletter'));
app.use('/api/requests', require('../routes/projectRequests'));
app.get('/', (req, res) => res.send('ok'));

const adminToken = jwt.sign({ admin: true }, 'test-secret');

const validRequest = {
  clientName: 'Ada',
  clientEmail: 'ada@example.com',
  projectTitle: 'Bakery site',
  projectType: 'simple_website',
  description: 'A five page site for my bakery.',
  timeline: 'no_rush',
  features: { payments: true },
};

beforeEach(() => {
  jest.clearAllMocks();
  db.createProjectRequest.mockImplementation(async data => ({ _id: 'req1', ...data }));
  generateQuote.mockResolvedValue({ total: 500, lineItems: [], notes: '' });
});

describe('security headers', () => {
  test('sends a Content Security Policy and other protective headers', async () => {
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['content-security-policy']).toContain('https://fonts.googleapis.com');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  test('rejects oversized JSON bodies', async () => {
    const res = await request(app).post('/api/contact').send({ message: 'x'.repeat(200 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe('honeypot spam trap', () => {
  test('pretends to accept a bot contact message but saves nothing', async () => {
    const res = await request(app).post('/api/contact')
      .send({ name: 'Bot', email: 'bot@example.com', message: 'Buy cheap SEO now!!!', website: 'http://spam.example' });
    expect(res.status).toBe(201);
    expect(db.createContact).not.toHaveBeenCalled();
  });

  test('pretends to accept a bot project request but saves nothing', async () => {
    const res = await request(app).post('/api/requests').send({ ...validRequest, website: 'spam' });
    expect(res.status).toBe(201);
    expect(db.createProjectRequest).not.toHaveBeenCalled();
    expect(generateQuote).not.toHaveBeenCalled();
  });

  test('lets real people through when the trap is empty', async () => {
    const res = await request(app).post('/api/contact')
      .send({ name: 'Ada', email: 'ada@example.com', message: 'I need a website please.', website: '' });
    expect(res.status).toBe(201);
    expect(db.createContact).toHaveBeenCalledTimes(1);
  });
});

describe('admin-only lists', () => {
  test('contact messages need an admin login', async () => {
    expect((await request(app).get('/api/contact')).status).toBe(401);
    db.getContacts.mockResolvedValue([]);
    const ok = await request(app).get('/api/contact').set('Authorization', `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
  });

  test('newsletter subscribers need an admin login', async () => {
    expect((await request(app).get('/api/newsletter/subscribers')).status).toBe(401);
  });
});

describe('project request validation', () => {
  test('ignores fields a client must never set, like payment status or price', async () => {
    const res = await request(app).post('/api/requests')
      .send({ ...validRequest, fullPaymentPaid: true, depositPaid: true, quotedPrice: 1, status: 'delivered' });
    expect(res.status).toBe(201);
    const saved = db.createProjectRequest.mock.calls[0][0];
    expect(saved).not.toHaveProperty('fullPaymentPaid');
    expect(saved).not.toHaveProperty('depositPaid');
    expect(saved).not.toHaveProperty('quotedPrice');
    expect(saved).not.toHaveProperty('status');
    expect(saved.features.payments).toBe(true);
    expect(saved.features.search).toBe(false);
  });

  test('rejects an unknown project type', async () => {
    const res = await request(app).post('/api/requests').send({ ...validRequest, projectType: 'spaceship' });
    expect(res.status).toBe(400);
  });

  test('rejects a description that is far too long', async () => {
    const res = await request(app).post('/api/requests').send({ ...validRequest, description: 'x'.repeat(6000) });
    expect(res.status).toBe(400);
  });

  test('rejects objects where text is expected', async () => {
    const res = await request(app).post('/api/requests').send({ ...validRequest, clientName: { $gt: '' } });
    expect(res.status).toBe(400);
    expect(db.createProjectRequest).not.toHaveBeenCalled();
  });

  test('will not re-generate a quote that already exists', async () => {
    db.getProjectRequestById.mockResolvedValue({ _id: 'req1', quotedPrice: 800, quoteFailed: false });
    const res = await request(app).post('/api/requests/req1/quote');
    expect(res.status).toBe(409);
    expect(generateQuote).not.toHaveBeenCalled();
  });
});

describe('email escaping', () => {
  test('escapes HTML in user text but leaves email addresses alone', () => {
    process.env.RESEND_API_KEY = 'test'; // use the HTTP mailer, so no SMTP connection is attempted
    const { escapeFields } = jest.requireActual('../utils/mailer');
    const out = escapeFields({
      clientName: '<img src=x onerror=alert(1)>',
      clientEmail: 'ada@example.com',
      features: { other: '<b>bold</b>' },
      quotedPrice: 500,
    });
    expect(out.clientName).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(out.clientEmail).toBe('ada@example.com');
    expect(out.features.other).toBe('&lt;b&gt;bold&lt;/b&gt;');
    expect(out.quotedPrice).toBe(500);
  });
});
