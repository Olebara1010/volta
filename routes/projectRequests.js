// routes/projectRequests.js
// Wired into server.js via: app.use('/api/requests', require('./routes/projectRequests'));

const express = require('express');
const router = express.Router();
const validator = require('validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/adminAuth');
const { honeypot, text, oneOf, ValidationError } = require('../middleware/security');
const {
  sendProjectRequestNotification, sendProjectRequestConfirmation, sendDeliveryNotification,
  sendBudgetProposalNotification, sendBudgetAccepted, sendBudgetCountered,
  sendFinalPaymentConfirmation, sendFinalPaymentNotification,
} = require('../utils/mailer');
const { generateQuote } = require('../utils/pricingCalculator');

// ── File delivery storage ───────────────────────────────────
// Files land in /uploads/deliveries/<requestId>/ on the server's own disk.
// Fine for now — if you later deploy somewhere whose filesystem resets on
// redeploy (e.g. Railway), this is the first thing to swap for cloud storage.
const deliveryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'deliveries', req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Sanitise the original filename so it's safe to use on disk
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({ storage: deliveryStorage, limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB per file

// Sends an email in the background and logs the result, so you can see in the
// server terminal whether each email actually went out (and why, if it didn't).
function sendInBackground(label, sendFn, request) {
  sendFn(request)
    .then(() => console.log(`📧 ${label} email sent to ${request.clientEmail}`))
    .catch(err => console.error(`❌ ${label} email FAILED:`, err.message));
}

// Creates a Stripe Checkout session for the deposit on `price`.
// `acceptCounter` marks a session paid from a counter-offer link — the webhook
// only locks in the counter price once the payment actually succeeds.
async function createDepositSession(request, { price, acceptCounter = false }) {
  const settings = await db.getSettings();
  const depositPercentage = settings.depositPercentage || 25;
  const depositAmount = Math.round(price * (depositPercentage / 100));
  if (depositAmount < 1) throw new Error('Deposit amount is too small to charge.');

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: request.clientEmail,
    line_items: [{
      price_data: {
        currency: 'gbp',
        unit_amount: depositAmount * 100, // Stripe wants pence
        product_data: {
          name: `${request.projectTitle} — deposit (${depositPercentage}% of £${Number(price).toLocaleString('en-GB')})`,
          description: `VOLTA project deposit for "${request.projectTitle}"`,
        },
      },
      quantity: 1,
    }],
    metadata: {
      requestId: String(request._id),
      paymentType: 'deposit',
      acceptCounter: acceptCounter ? 'true' : 'false',
    },
    success_url: `${process.env.CLIENT_URL}/status.html?id=${request._id}&payment=success`,
    cancel_url: `${process.env.CLIENT_URL}/quote.html?id=${request._id}&payment=cancelled`,
  });
}

const { PROJECT_TYPES, TIMELINES, FEATURE_FLAGS } = require('../utils/projectOptions');
const MAX_BUDGET = 1000000;

// Builds the new request from an explicit list of fields. Copying req.body
// straight into the database would let someone add fields like
// "fullPaymentPaid: true" or "quotedPrice: 1" to their own request.
function buildProjectRequest(body) {
  const features = body.features && typeof body.features === 'object' ? body.features : {};
  const data = {
    clientName: text(body.clientName, 'Name', 100, { required: true }),
    clientEmail: text(body.clientEmail, 'Email', 254, { required: true }),
    clientPhone: text(body.clientPhone, 'Phone', 30),
    projectTitle: text(body.projectTitle, 'Project title', 150, { required: true }),
    projectType: oneOf(body.projectType, 'project type', PROJECT_TYPES),
    description: text(body.description, 'Description', 5000, { required: true }),
    features: { other: text(features.other, 'Other features', 500) },
    designReferences: text(body.designReferences, 'Design references', 1000),
    timeline: oneOf(body.timeline, 'timeline', TIMELINES),
    budgetRange: text(body.budgetRange, 'Budget range', 100),
    additionalNotes: text(body.additionalNotes, 'Additional notes', 2000),
  };
  for (const flag of FEATURE_FLAGS) data.features[flag] = features[flag] === true;
  if (!validator.isEmail(data.clientEmail)) throw new ValidationError('Please provide a valid email address.');
  return data;
}

// POST /api/requests — client submits the form (public, no auth required)
// Generates the itemised AI quote synchronously, so the client can be sent
// straight to the quote page with a number already waiting for them.
router.post('/', honeypot({ message: "Got it — we'll have your quote ready shortly.", requestId: null, quote: null }), async (req, res) => {
  try {
    let data;
    try {
      data = buildProjectRequest(req.body);
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }

    const request = await db.createProjectRequest(data);

    // Fire-and-forget — a slow/failed email shouldn't block the client's response
    sendProjectRequestNotification(request).catch(err => console.error('Request notification email failed:', err.message));
    sendProjectRequestConfirmation(request).catch(err => console.error('Request confirmation email failed:', err.message));

    let quote = null;
    try {
      quote = await generateQuote(request);
      await db.saveQuote(request._id, {
        quotedPrice: quote.total,
        quoteBreakdown: quote.lineItems,
        quoteNotes: quote.notes,
      });
    } catch (err) {
      console.error('Instant quote generation failed:', err.message);
      await db.markQuoteFailed(request._id);
      // Don't fail the whole submission — the client can still retry from the quote page.
    }

    res.status(201).json({
      message: quote ? 'Your quote is ready.' : "Got it — we'll have your quote ready shortly.",
      requestId: request._id,
      quote,
    });
  } catch (err) {
    console.error('Project request failed:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// GET /api/requests — list all requests, newest first (admin dashboard only)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const requests = await db.getProjectRequests();
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/requests/lookup?email=... — client looks up their own projects by email
// Must stay ABOVE the /:id route below, or Express would treat "lookup" as an :id value.
router.get('/lookup', async (req, res) => {
  try {
    const { email } = req.query;
    if (typeof email !== 'string' || !validator.isEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    const requests = await db.getProjectRequestsByEmail(email);
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/requests/:id — single request (for the quote generation page)
router.get('/:id', async (req, res) => {
  try {
    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    res.json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/requests/:id/quote — (re)generate the AI quote for a request.
// Used by the quote page as a fallback if the instant quote at submission-time failed.
router.post('/:id/quote', async (req, res) => {
  try {
    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    // Only quote once. Otherwise anyone with the link could keep re-rolling the
    // AI price (and run up API costs), even after a price had been agreed.
    if (request.quotedPrice && !request.quoteFailed) {
      return res.status(409).json({ error: 'This project already has a quote.' });
    }

    const quote = await generateQuote(request);
    const updated = await db.saveQuote(req.params.id, {
      quotedPrice: quote.total,
      quoteBreakdown: quote.lineItems,
      quoteNotes: quote.notes,
    });

    res.json({ request: updated, quote });
  } catch (err) {
    console.error('Quote generation failed:', err.message);
    await db.markQuoteFailed(req.params.id).catch(() => {});
    res.status(500).json({ error: 'Could not generate a quote right now. Please try again.' });
  }
});

// PATCH /api/requests/:id/respond — client accepts or rejects their quote
router.patch('/:id/respond', async (req, res) => {
  try {
    const { decision } = req.body;
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be "accepted" or "rejected".' });
    }
    const updated = await db.respondToQuote(req.params.id, decision);
    if (!updated) return res.status(404).json({ error: 'Request not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/requests/:id/propose-budget — client clicked "Not right now" and typed in
// what they can actually pay. Doesn't reject the quote — just flags it for your review.
router.post('/:id/propose-budget', async (req, res) => {
  try {
    const { budget } = req.body;
    const amount = Number(budget);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_BUDGET) {
      return res.status(400).json({ error: 'Please enter a valid budget amount.' });
    }
    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const updated = await db.proposeBudget(req.params.id, amount);
    sendBudgetProposalNotification(updated)
      .then(() => console.log(`📧 Budget proposal email sent to you (${process.env.NOTIFY_EMAIL})`))
      .catch(err => console.error('❌ Budget proposal email FAILED:', err.message));

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/requests/:id/respond-budget — ADMIN accepts the client's proposed budget
// outright, or comes back with a different number (a counter-offer).
router.patch('/:id/respond-budget', requireAdmin, async (req, res) => {
  try {
    const { action, counterPrice } = req.body; // action: 'accept' | 'counter'
    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.negotiationStatus !== 'pending') {
      return res.status(400).json({ error: 'There is no pending budget proposal on this request.' });
    }

    let updated;
    if (action === 'accept') {
      updated = await db.acceptBudget(req.params.id);
      sendInBackground('Budget accepted (with payment link)', sendBudgetAccepted, updated);
    } else if (action === 'counter') {
      const amount = Number(counterPrice);
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Please enter a valid counter price.' });
      }
      updated = await db.counterBudget(req.params.id, amount);
      sendInBackground('Counter-offer (with payment link)', sendBudgetCountered, updated);
    } else {
      return res.status(400).json({ error: 'Action must be "accept" or "counter".' });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/requests/:id/resend-payment-email — ADMIN re-sends the payment-link email.
// Unlike the automatic emails, this one WAITS for the send, so if it fails the
// dashboard shows you the actual reason (wrong password, blocked, etc).
router.post('/:id/resend-payment-email', requireAdmin, async (req, res) => {
  try {
    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.depositPaid) return res.status(400).json({ error: 'The deposit has already been paid.' });

    if (request.negotiationStatus === 'countered') {
      await sendBudgetCountered(request);
    } else if (request.status === 'accepted') {
      await sendBudgetAccepted(request);
    } else {
      return res.status(400).json({ error: 'There is no agreed price to pay yet on this project.' });
    }
    console.log(`📧 Payment email re-sent to ${request.clientEmail}`);
    res.json({ message: `Payment email sent to ${request.clientEmail}.` });
  } catch (err) {
    console.error('❌ Resend payment email FAILED:', err.message);
    res.status(500).json({ error: `Email could not be sent: ${err.message}` });
  }
});

// PATCH /api/requests/:id/respond-counter — client accepts or declines YOUR counter-offer.
router.patch('/:id/respond-counter', async (req, res) => {
  try {
    const { decision } = req.body;
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be "accepted" or "rejected".' });
    }
    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.negotiationStatus !== 'countered') {
      return res.status(400).json({ error: 'There is no counter-offer on this request to respond to.' });
    }
    const updated = await db.respondToCounter(req.params.id, decision);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/requests/:id/create-checkout-session — client has accepted their quote and
// is being sent to pay the deposit. Returns a Stripe Checkout URL to redirect them to.
router.post('/:id/create-checkout-session', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Payments are not set up on this server yet (missing STRIPE_SECRET_KEY).' });
    }

    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'accepted') {
      return res.status(400).json({ error: 'This quote needs to be accepted before paying a deposit.' });
    }
    if (!request.quotedPrice) {
      return res.status(400).json({ error: 'No quoted price on this request.' });
    }
    if (request.depositPaid) {
      return res.status(400).json({ error: 'The deposit for this project has already been paid.' });
    }

    const session = await createDepositSession(request, { price: request.quotedPrice });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout session creation failed:', err.message);
    res.status(500).json({ error: 'Could not start the payment. Please try again.' });
  }
});

// GET /api/requests/:id/pay — the one-click payment link used in emails.
// Opens Stripe Checkout straight away for:
//   • a budget you accepted (status 'accepted'), or
//   • your counter-offer (negotiationStatus 'countered') — paying = accepting it.
// It never changes the project by itself; the counter price is only locked in by
// the Stripe webhook once the payment succeeds (so email link-scanners can't
// accidentally "accept" an offer just by opening the link).
router.get('/:id/pay', async (req, res) => {
  const quotePage = `${process.env.CLIENT_URL}/quote.html?id=${req.params.id}`;
  try {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('Missing STRIPE_SECRET_KEY');

    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.redirect(303, `${process.env.CLIENT_URL}/`);
    if (request.depositPaid) {
      return res.redirect(303, `${process.env.CLIENT_URL}/status.html?id=${request._id}`);
    }

    let session;
    if (request.negotiationStatus === 'countered' && request.counterPrice) {
      session = await createDepositSession(request, { price: request.counterPrice, acceptCounter: true });
    } else if (request.status === 'accepted' && request.quotedPrice) {
      session = await createDepositSession(request, { price: request.quotedPrice });
    } else {
      // Nothing payable yet (e.g. still waiting on your decision) — show them their quote page.
      return res.redirect(303, quotePage);
    }

    res.redirect(303, session.url);
  } catch (err) {
    console.error('Payment link failed:', err.message);
    res.redirect(303, `${quotePage}&payment=error`);
  }
});

// POST /api/requests/:id/create-balance-checkout-session — the project is delivered and
// the client is paying what's left (quotedPrice minus the deposit already paid) to unlock
// their downloads.
router.post('/:id/create-balance-checkout-session', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Payments are not set up on this server yet (missing STRIPE_SECRET_KEY).' });
    }

    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'delivered') {
      return res.status(400).json({ error: 'The project needs to be delivered before the final payment can be taken.' });
    }
    if (!request.depositPaid) {
      return res.status(400).json({ error: 'The deposit on this project has not been paid yet.' });
    }
    if (request.fullPaymentPaid) {
      return res.status(400).json({ error: 'The full amount for this project has already been paid.' });
    }

    const balanceAmount = Math.max(0, Math.round((request.quotedPrice || 0) - (request.depositAmount || 0)));
    if (!balanceAmount) {
      return res.status(400).json({ error: 'There is no remaining balance on this project.' });
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: request.clientEmail,
      line_items: [{
        price_data: {
          currency: 'gbp',
          unit_amount: balanceAmount * 100,
          product_data: {
            name: `${request.projectTitle} — final payment`,
            description: `VOLTA remaining balance for "${request.projectTitle}"`,
          },
        },
        quantity: 1,
      }],
      metadata: { requestId: String(request._id), paymentType: 'balance' },
      success_url: `${process.env.CLIENT_URL}/status.html?id=${request._id}&payment=success`,
      cancel_url: `${process.env.CLIENT_URL}/status.html?id=${request._id}&payment=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe balance checkout session creation failed:', err.message);
    res.status(500).json({ error: 'Could not start the payment. Please try again.' });
  }
});

// PATCH /api/requests/:id/status — you manually move a project between stages
// (e.g. accepted -> in_progress). "delivered" isn't allowed here — that only
// happens through the /deliver upload, so it always comes with real files attached.
router.patch('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['new', 'quoted', 'accepted', 'rejected', 'in_progress'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
    }
    const updated = await db.updateProjectRequestStatus(req.params.id, status);
    if (!updated) return res.status(404).json({ error: 'Request not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/requests/:id/deliver — upload the finished files and mark as delivered
router.post('/:id/deliver', requireAdmin, upload.array('files', 20), async (req, res) => {
  try {
    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!req.files || !req.files.length) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    const fileRecords = req.files.map(f => ({
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
      mimetype: f.mimetype,
      uploadedAt: new Date(),
    }));

    const updated = await db.saveDeliveredFiles(req.params.id, fileRecords);

    sendDeliveryNotification(updated).catch(err => console.error('Delivery email failed:', err.message));

    res.json({ message: 'Files delivered.', request: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/requests/:id/files/:filename — download one delivered file.
// Gated behind the final payment — files are delivered to the server as soon as you
// upload them, but the client can't actually download them until the balance is paid.
router.get('/:id/files/:filename', async (req, res) => {
  try {
    const request = await db.getProjectRequestById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (!request.fullPaymentPaid) {
      return res.status(402).json({ error: 'The final payment needs to be made before these files can be downloaded.' });
    }

    const fileRecord = (request.deliveredFiles || []).find(f => f.filename === req.params.filename);
    if (!fileRecord) return res.status(404).json({ error: 'File not found' });

    const filePath = path.join(__dirname, '..', 'uploads', 'deliveries', req.params.id, fileRecord.filename);
    res.download(filePath, fileRecord.originalName);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
