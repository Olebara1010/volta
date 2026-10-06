# ⚡ VOLTA Studio — Full Stack Website

A modern creative studio website with a Node.js/Express backend, SQLite database, email notifications, user authentication, contact form, and newsletter system.

---

## 📁 Project Structure

```
volta/
├── server.js              # Main Express server
├── package.json
├── .env.example           # ← Copy this to .env and fill in your values
├── db/
│   └── database.js        # SQLite setup (creates volta.db automatically)
├── routes/
│   ├── auth.js            # Register, login, /me
│   ├── contact.js         # Contact form submissions
│   └── newsletter.js      # Subscribe / unsubscribe
├── middleware/
│   └── auth.js            # JWT verification
├── utils/
│   └── mailer.js          # Nodemailer email templates
└── public/
    └── index.html         # The full frontend
```

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
cd volta
npm install
```

### 2. Set up environment variables
```bash
cp .env.example .env
```
Open `.env` and fill in:
- Your **Gmail address** and an [App Password](https://support.google.com/accounts/answer/185833)
- A long random **JWT_SECRET** string
- The **email address** where you want to receive notifications

### 3. Run the server
```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

Visit **http://localhost:3000** — the site is live!

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in, get JWT |
| GET | `/api/auth/me` | Get current user (auth required) |
| POST | `/api/contact` | Submit contact form |
| GET | `/api/contact` | List all contacts |
| POST | `/api/newsletter/subscribe` | Subscribe to newsletter |
| POST | `/api/newsletter/unsubscribe` | Unsubscribe |
| GET | `/api/newsletter/subscribers` | List all subscribers |
| GET | `/api/health` | Health check |

---

## 📧 Email Setup (Gmail)

1. Go to your Google Account → Security → 2-Step Verification (enable it)
2. Go to **App Passwords** → create one for "Mail"
3. Paste the 16-character password into `EMAIL_PASS` in your `.env`

> **Other providers:** Change `EMAIL_HOST` and `EMAIL_PORT` for Outlook, SendGrid, Mailgun, etc.

---

## 🌍 Deploying Online (Free)

### Option A — Railway (easiest, recommended)
1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add your `.env` variables in the Railway dashboard
4. Done — Railway gives you a live URL instantly

### Option B — Render
1. Push to GitHub
2. [render.com](https://render.com) → New Web Service → connect repo
3. Set Build Command: `npm install`, Start Command: `npm start`
4. Add environment variables

### Option C — VPS (DigitalOcean, Linode, etc.)
```bash
git clone your-repo && cd volta
npm install
cp .env.example .env && nano .env   # fill in values
npm install -g pm2
pm2 start server.js --name volta
pm2 save
```

---

## 🗃️ Database

SQLite file (`volta.db`) is created automatically on first run. Three tables:

- **users** — registered accounts (passwords are bcrypt-hashed)
- **contacts** — contact form submissions
- **subscribers** — newsletter emails

To view the database, install [DB Browser for SQLite](https://sqlitebrowser.org/) and open `db/volta.db`.

---

## 🔒 Security Features

- Passwords hashed with **bcrypt** (12 rounds)
- **JWT** tokens (7-day expiry)
- **Rate limiting** — 50 req/15min globally, 10 req/15min on auth routes
- Input **validation** on all endpoints
- **CORS** configured for your frontend URL

---

## ✏️ Customisation

- Change studio name/content in `public/index.html`
- Update `NOTIFY_EMAIL` in `.env` to receive submissions
- Email templates are in `utils/mailer.js`
- Swap SQLite for PostgreSQL/MySQL by replacing `better-sqlite3` with `pg` or `mysql2`
