// Tests for the AI quote engine. The Claude API and the database are mocked,
// so these run offline and never cost anything.
jest.mock('../db/database', () => ({ getSettings: jest.fn() }));

const db = require('../db/database');
const { generateQuote } = require('../utils/pricingCalculator');

// Makes the mocked Claude API reply with the given quote JSON.
function mockClaudeReply(quote) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(quote) }] }),
  });
}

const baseRequest = {
  projectTitle: 'Test shop',
  projectType: 'ecommerce',
  description: 'An online store',
  timeline: 'standard',
  features: { payments: true },
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  db.getSettings.mockResolvedValue({ ecommerce: 1500, simple_website: 500, rushMultiplier: 1.4 });
});

test('raises a quote below the minimum up to the minimum, with a visible adjustment line', async () => {
  mockClaudeReply({ lineItems: [{ label: 'Base build', amount: 900 }, { label: 'Payments', amount: 100 }], total: 1000 });

  const quote = await generateQuote(baseRequest);

  expect(quote.total).toBe(1500);
  expect(quote.lineItems).toContainEqual({ label: 'Minimum project price adjustment', amount: 500 });
});

test('the total always equals the sum of the line items, even if the AI adds up wrongly', async () => {
  mockClaudeReply({ lineItems: [{ label: 'Base build', amount: 1500 }, { label: 'Payments', amount: 300 }], total: 9999 });

  const quote = await generateQuote(baseRequest);

  const sum = quote.lineItems.reduce((s, i) => s + i.amount, 0);
  expect(quote.total).toBe(1800);
  expect(sum).toBe(quote.total);
});

test('rush jobs use the minimum multiplied by the rush multiplier as the floor', async () => {
  mockClaudeReply({ lineItems: [{ label: 'Base build', amount: 1000 }], total: 1000 });

  const quote = await generateQuote({ ...baseRequest, timeline: 'rush' });

  expect(quote.total).toBe(2100); // 1500 x 1.4
});

test('ignores negative, zero and non-numeric amounts from the AI', async () => {
  mockClaudeReply({ lineItems: [
    { label: 'Base build', amount: 1600 },
    { label: 'Bad', amount: -500 },
    { label: 'Zero', amount: 0 },
    { label: 'Text', amount: 'lots' },
  ] });

  const quote = await generateQuote(baseRequest);

  expect(quote.lineItems).toEqual([{ label: 'Base build', amount: 1600 }]);
  expect(quote.total).toBe(1600);
});

test('falls back to default minimums if settings cannot be loaded', async () => {
  db.getSettings.mockRejectedValue(new Error('DB down'));
  mockClaudeReply({ lineItems: [{ label: 'Base build', amount: 100 }] });

  const quote = await generateQuote(baseRequest);

  expect(quote.total).toBe(1500); // default e-commerce minimum
});

test('throws a clear error when the Claude API fails', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
  await expect(generateQuote(baseRequest)).rejects.toThrow('Claude API error (500)');
});

test('refuses to run without an API key', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await expect(generateQuote(baseRequest)).rejects.toThrow('ANTHROPIC_API_KEY');
});
