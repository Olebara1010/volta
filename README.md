# ⚡ Volta

**Live at [getvoltastudio.co.uk](https://getvoltastudio.co.uk)**

Volta is a full-stack platform where businesses order a website or app online. A client describes what they need, gets an itemised AI-generated quote in seconds, can negotiate a price, pays a deposit through Stripe, tracks progress live and downloads the finished files once the balance is paid.

I designed, built and deployed it end to end.

---

## How it works

1. **Choose a project:** business website, online store, booking system, portfolio, web app or mobile app.
2. **Describe it:** features, design references and timeline.
3. **Instant AI quote:** the Claude API turns the brief into an itemised price breakdown, with the reasoning explained.
4. **Negotiate:** if the quote is too high, the client proposes a budget. The admin accepts it or sends a counter-offer.
5. **Pay a 25% deposit:** the client gets a one-click payment link by email that opens Stripe Checkout.
6. **Track the project:** by project ID or email, with a live progress stepper.
7. **Delivery:** files unlock for download once the balance is paid.

---

## Technical highlights

- **AI integration with guardrails:** quotes come from the Claude API as structured JSON. The server re-totals every line item and enforces the admin-configured minimum prices and rush multiplier, so the AI can never quote below the floor and the breakdown always matches the total.
- **Stripe Checkout and verified webhooks:** deposits and balance payments run through Stripe Checkout. The webhook route uses a raw-body parser registered *before* the JSON middleware, so Stripe's signature verification works, and payment status updates automatically.
- **Payment-gated downloads:** delivered files can only be downloaded once the project is paid in full, and this is enforced on the server.
- **Transactional email that works in production:** the hosting platform blocks outbound SMTP, so email goes through the Resend HTTPS API from a verified custom domain, with an SMTP fallback for local development.
- **Admin dashboard:** JWT-secured. It manages pricing settings, accept/counter decisions, status updates, file delivery and resending payment emails.
- **Rate-limited API routes** and input validation on all public endpoints.

---

## Tech stack

| Area | Tools |
|---|---|
| Backend | Node.js, Express |
| Database | MongoDB Atlas (Mongoose) |
| AI | Claude API (Anthropic) |
| Payments | Stripe Checkout + webhooks |
| Email | Resend API (Nodemailer for local SMTP) |
| Auth | JWT, bcrypt |
| Frontend | HTML, CSS, JavaScript (light/dark theme) |
| Hosting | Railway, with Cloudflare for DNS and email routing |

---

## Project structure

```
volta/
├── server.js               # Express app, middleware, routes
├── db/database.js          # Mongoose models and data access
├── middleware/             # JWT auth and admin auth
├── routes/
│   ├── projectRequests.js  # Requests, quotes, negotiation, Stripe checkout, file delivery
│   ├── stripeWebhook.js    # Verified Stripe webhook handler
│   ├── admin.js            # Admin login and settings
│   ├── auth.js, contact.js, newsletter.js
├── utils/
│   ├── pricingCalculator.js  # Claude API quote generation and price-floor enforcement
│   └── mailer.js             # Resend / SMTP email templates
└── public/                 # Frontend pages: home, request, quote, status, admin
```

---

## Running locally

```bash
git clone https://github.com/Olebara1010/volta.git
cd volta
npm install
cp .env.example .env   # then fill in your own values
npm run dev
```

Open http://localhost:3000. To test payments locally, forward Stripe events with the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

---

## Author

**Chigozirim Olebara**, full-stack software developer, Birmingham, UK
[LinkedIn](https://www.linkedin.com/in/chigozirim-olebara-a79277275) · [getvoltastudio.co.uk](https://getvoltastudio.co.uk)
