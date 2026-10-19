// utils/claude.js
// One place that talks to the Claude API, shared by the quote engine and the
// brief assistant.

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

async function callClaude({ system, messages, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in your environment.');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('Claude API returned no text content.');
  return textBlock.text;
}

// Pulls the JSON object out of a reply, even if the model wrapped it in a
// ```json fence or added a sentence before or after it.
function parseJsonReply(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in the reply.');
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = { callClaude, parseJsonReply, MODEL };
