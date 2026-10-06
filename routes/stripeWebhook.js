// routes/stripeWebhook.js
// This is NOT a normal router — it's a single request handler, wired directly
// into server.js BEFORE express.json() runs, because Stripe needs the raw,
// unparsed request body to verify the webhook signature.
//
// Wired into server.js via:
//   app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), require('./routes/stripeWebhook'));

const db = require('../db/database');
const {
  sendDepositConfirmation, sendDepositNotification,
  sendFinalPaymentConfirmation, sendFinalPaymentNotification,
} = require('../utils/mailer');

module.exports = async function stripeWebhook(req, res) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Stripe webhook hit, but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are not set.');
    return res.status(500).send('Stripe is not configured on this server.');
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    const signature = req.headers['stripe-signature'];
    // req.body is a raw Buffer here (see express.raw() above) — required for signature verification.
    event = stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const requestId = session.metadata && session.metadata.requestId;
    const paymentType = (session.metadata && session.metadata.paymentType) || 'deposit'; // older sessions had no paymentType — treat as deposit

    if (requestId) {
      try {
        const amount = (session.amount_total || 0) / 100; // Stripe amounts are in pence

        if (paymentType === 'balance') {
          const updated = await db.markFullPaymentPaid(requestId, { amount, sessionId: session.id });
          if (updated) {
            sendFinalPaymentConfirmation(updated).catch(err => console.error('Final payment confirmation email failed:', err.message));
            sendFinalPaymentNotification(updated).catch(err => console.error('Final payment notification email failed:', err.message));
          }
        } else {
          // Paid from a counter-offer email link: paying IS accepting, so lock in the counter price now.
          if (session.metadata.acceptCounter === 'true') {
            const current = await db.getProjectRequestById(requestId);
            if (current && current.negotiationStatus === 'countered') {
              await db.respondToCounter(requestId, 'accepted');
            }
          }
          const updated = await db.markDepositPaid(requestId, { amount, sessionId: session.id });
          if (updated) {
            sendDepositConfirmation(updated).catch(err => console.error('Deposit confirmation email failed:', err.message));
            sendDepositNotification(updated).catch(err => console.error('Deposit notification email failed:', err.message));
          }
        }
      } catch (err) {
        console.error('Failed to record payment:', err.message);
        // Still 200 the webhook — Stripe will retry on failure, and a retry loop on our
        // own DB error isn't useful. Log it and fix manually if this ever happens.
      }
    }
  }

  res.json({ received: true });
};
