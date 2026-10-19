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

describe('files stored in Cloudflare R2', () => {
  beforeEach(() => {
    process.env.R2_ENDPOINT = 'https://testaccount.r2.cloudflarestorage.com';
    process.env.R2_ACCESS_KEY_ID = 'test-key-id';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    process.env.R2_BUCKET = 'volta-files';
  });
  afterEach(() => {
    delete process.env.R2_ENDPOINT; delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY; delete process.env.R2_BUCKET;
  });

  test('a paid client is sent to a short-lived signed download link', async () => {
    const r2File = { ...file, storage: 'r2' };
    db.getProjectRequestById.mockResolvedValue({ _id: 'abc', fullPaymentPaid: true, deliveredFiles: [r2File] });

    const res = await request(app).get('/api/requests/abc/files/123-site.zip');

    expect(res.status).toBe(302);
    const url = new URL(res.headers.location);
    expect(url.hostname).toContain('r2.cloudflarestorage.com');
    expect(url.pathname).toContain('deliveries/abc/123-site.zip');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(Number(url.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(300);
    expect(url.searchParams.get('response-content-disposition')).toContain('site.zip');
  });

  test('an unpaid client still gets no link', async () => {
    db.getProjectRequestById.mockResolvedValue({ _id: 'abc', fullPaymentPaid: false, deliveredFiles: [{ ...file, storage: 'r2' }] });
    const res = await request(app).get('/api/requests/abc/files/123-site.zip');
    expect(res.status).toBe(402);
    expect(res.headers.location).toBeUndefined();
  });
});

test('explains when an old disk file was wiped by a redeploy', async () => {
  db.getProjectRequestById.mockResolvedValue({ _id: 'gone', fullPaymentPaid: true, deliveredFiles: [{ ...file, storage: 'disk' }] });
  const res = await request(app).get('/api/requests/gone/files/123-site.zip');
  expect(res.status).toBe(410);
});

test('without R2 settings, uploads stay on local disk', async () => {
  const storage = require('../utils/storage');
  expect(storage.r2Configured()).toBe(false);
  await expect(storage.saveDeliveredFile('abc', { filename: 'x', path: '/nope' })).resolves.toBe('disk');
});
