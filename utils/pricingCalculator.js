// utils/pricingCalculator.js
// Calls the Claude API to generate an itemised quote for a project request,
// grounded in VOLTA's pricing minimums — which now live in the database
// (editable from the admin dashboard) rather than being hardcoded here.
// These defaults are only used if no settings document exists yet.

const db = require('../db/database');

const DEFAULT_PRICING_MINIMUMS = {
  simple_website: 500,
  ecommerce: 1500,
  mobile_app: 3000,
  web_app: 2000,
  not_sure: 500,
};
const DEFAULT_RUSH_MULTIPLIER = 1.4;

function buildPrompt(request, minimums, rushMultiplier) {
  const minimum = minimums[request.projectType] ?? minimums.simple_website;
  const f = request.features || {};
  const selectedFeatures = Object.entries({
    'User accounts / login': f.userAccounts,
    'Payments': f.payments,
    'Admin panel': f.adminPanel,
    'Third-party integrations': f.thirdPartyIntegrations,
    'File uploads': f.fileUploads,
    'Search': f.search,
    'Multiple languages': f.multiLanguage,
  }).filter(([, v]) => v).map(([k]) => k);
  if (f.other) selectedFeatures.push(f.other);

  const rushPercent = Math.round((rushMultiplier - 1) * 100);

  return `You are VOLTA Studio's pricing assistant. Generate a fair, itemised quote in GBP for the project below, based strictly on VOLTA's own pricing rules.

VOLTA's pricing rules:
- Simple website minimum: £${minimums.simple_website}
- E-commerce minimum: £${minimums.ecommerce}
- Mobile app minimum: £${minimums.mobile_app}
- Web app minimum: £${minimums.web_app}
- Rush jobs (timeline = "rush"): add a ${rushPercent}% priority fee on top of the full total, as the last line item

This project's type is "${request.projectType}", so its baseline minimum is £${minimum}. The final total must never be below this minimum.

Project brief:
- Title: ${request.projectTitle}
- Description: ${request.description}
- Requested features: ${selectedFeatures.length ? selectedFeatures.join(', ') : 'None specified beyond the brief'}
- Design references: ${request.designReferences || 'None provided'}
- Timeline: ${request.timeline}
- Client's stated budget range: ${request.budgetRange || 'Not specified'}
- Additional notes: ${request.additionalNotes || 'None'}

Break the total into sensible line items (e.g. "Base build — simple website", "User accounts", "Admin panel", "Rush priority fee") with a short plain-English rationale in "notes". Price each feature reasonably relative to the baseline — don't just split the minimum evenly.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "lineItems": [ { "label": string, "amount": number } ],
  "subtotal": number,
  "rushFeeApplied": boolean,
  "total": number,
  "notes": string
}
All amounts are whole-number GBP. "total" must equal the sum of lineItems, and must be at least £${minimum}.`;
}

async function generateQuote(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in your environment.');

  // Pull current pricing from the database — falls back to the hardcoded
  // defaults above only if the DB read fails or nothing's been saved yet.
  let settings;
  try {
    settings = await db.getSettings();
  } catch (err) {
    console.error('Could not load pricing settings, using defaults:', err.message);
    settings = { ...DEFAULT_PRICING_MINIMUMS, rushMultiplier: DEFAULT_RUSH_MULTIPLIER };
  }
  const minimums = {
    simple_website: settings.simple_website ?? DEFAULT_PRICING_MINIMUMS.simple_website,
    ecommerce: settings.ecommerce ?? DEFAULT_PRICING_MINIMUMS.ecommerce,
    mobile_app: settings.mobile_app ?? DEFAULT_PRICING_MINIMUMS.mobile_app,
    web_app: settings.web_app ?? DEFAULT_PRICING_MINIMUMS.web_app,
    not_sure: settings.not_sure ?? DEFAULT_PRICING_MINIMUMS.not_sure,
  };
  const rushMultiplier = settings.rushMultiplier ?? DEFAULT_RUSH_MULTIPLIER;

  const minimum = minimums[request.projectType] ?? minimums.simple_website;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: buildPrompt(request, minimums, rushMultiplier) }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('Claude API returned no text content.');

  let quote;
  try {
    const cleaned = textBlock.text.trim().replace(/^```json\s*|```$/g, '');
    quote = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse the quote JSON: ${err.message}`);
  }

  // Hard floor — never let the AI's number undercut the studio's current
  // stated minimum, and never let a rush job slip below the rush multiplier.
  // The total is always recalculated from the line items so the breakdown
  // the client sees adds up exactly, whatever the AI wrote as "total".
  quote.lineItems = (Array.isArray(quote.lineItems) ? quote.lineItems : [])
    .map(item => ({ label: String(item.label || 'Item'), amount: Math.max(0, Math.round(Number(item.amount) || 0)) }))
    .filter(item => item.amount > 0);
  let total = quote.lineItems.reduce((sum, item) => sum + item.amount, 0);

  const floor = request.timeline === 'rush' ? Math.round(minimum * rushMultiplier) : minimum;
  if (total < floor) {
    // Show the top-up as its own line, so the breakdown still matches the total.
    quote.lineItems.push({ label: 'Minimum project price adjustment', amount: floor - total });
    total = floor;
  }
  quote.total = total;

  return quote;
}

module.exports = { generateQuote, DEFAULT_PRICING_MINIMUMS, DEFAULT_RUSH_MULTIPLIER };
