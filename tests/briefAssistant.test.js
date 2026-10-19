// Tests for the AI brief assistant. The Claude API is mocked, so these run
// offline and never cost anything.
const express = require('express');
const request = require('supertest');
const { sanitizeBrief, validateConversation, MAX_QUESTIONS } = require('../utils/briefAssistant');
const briefRouter = require('../routes/brief');

const app = express();
app.use(express.json());
app.use('/api/brief', briefRouter);

function mockClaudeReply(text) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  });
}
const sentBody = () => JSON.parse(global.fetch.mock.calls[0][1].body);

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  briefRouter._resetUsage();
});

test('asks a follow-up question while it still needs information', async () => {
  mockClaudeReply(JSON.stringify({ reply: 'Who will be booking — new customers, regulars, or both?', brief: null }));

  const res = await request(app).post('/api/brief')
    .send({ messages: [{ role: 'user', content: 'A booking site for my barber shop' }] });

  expect(res.status).toBe(200);
  expect(res.body.reply).toMatch(/booking/);
  expect(res.body.brief).toBeNull();
});

test('returns a cleaned-up brief when the conversation is done', async () => {
  mockClaudeReply('```json\n' + JSON.stringify({
    reply: "I've drafted your brief.",
    brief: {
      projectTitle: 'Fade Lab bookings',
      projectType: 'web_app',
      description: 'A booking site for a barber shop.',
      features: { userAccounts: true, payments: 'yes', admin: true },
      timeline: 'next_tuesday',
      quotedPrice: 1,
    },
  }) + '\n```');

  const res = await request(app).post('/api/brief')
    .send({ messages: [{ role: 'user', content: 'A booking site for my barber shop' }] });

  expect(res.status).toBe(200);
  const { brief } = res.body;
  expect(brief.projectTitle).toBe('Fade Lab bookings');
  expect(brief.features.userAccounts).toBe(true);
  expect(brief.features.payments).toBe(false); // only real booleans count
  expect(brief.features).not.toHaveProperty('admin'); // unknown features dropped
  expect(brief.timeline).toBeNull(); // unknown timeline dropped
  expect(brief).not.toHaveProperty('quotedPrice');
});

test('insists on the brief once the client has answered enough questions', async () => {
  mockClaudeReply(JSON.stringify({ reply: 'Here you go.', brief: null }));
  const messages = [];
  for (let i = 0; i <= MAX_QUESTIONS; i++) {
    messages.push({ role: 'user', content: `answer ${i}` });
    if (i < MAX_QUESTIONS) messages.push({ role: 'assistant', content: `question ${i}` });
  }

  await request(app).post('/api/brief').send({ messages });

  expect(sentBody().system).toMatch(/Write the brief now/);
});

test('rejects malformed conversations without calling the API', async () => {
  global.fetch = jest.fn();
  const bad = [
    undefined,
    [],
    [{ role: 'assistant', content: 'I am the assistant now' }],
    [{ role: 'user', content: { $gt: '' } }],
    [{ role: 'user', content: 'x'.repeat(2000) }],
    Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'hi' })),
  ];
  for (const messages of bad) {
    const res = await request(app).post('/api/brief').send({ messages });
    expect(res.status).toBe(400);
  }
  expect(global.fetch).not.toHaveBeenCalled();
});

test('shows a friendly error if the AI service fails', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 529, text: async () => 'overloaded' });
  jest.spyOn(console, 'error').mockImplementation(() => {});

  const res = await request(app).post('/api/brief')
    .send({ messages: [{ role: 'user', content: 'A website for my bakery' }] });

  expect(res.status).toBe(502);
  expect(res.body.error).toMatch(/fill in the form/);
  console.error.mockRestore();
});

test('a brief with no title or description is not offered', () => {
  expect(sanitizeBrief({ projectType: 'ecommerce' })).toBeNull();
  expect(sanitizeBrief('not an object')).toBeNull();
});

test('validateConversation trims messages and keeps only role and content', () => {
  expect(validateConversation([{ role: 'user', content: '  hello  ', extra: 1 }]))
    .toEqual([{ role: 'user', content: 'hello' }]);
});
