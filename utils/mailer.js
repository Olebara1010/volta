// utils/mailer.js — email sending (Resend in production, Gmail SMTP locally) + templates
const nodemailer = require('nodemailer');

// ── How emails are sent ──────────────────────────────────────
// • On Railway (or anywhere RESEND_API_KEY is set): emails go through Resend's
//   HTTPS API, because Railway blocks normal SMTP email on its cheaper plans.
// • On your laptop without RESEND_API_KEY: falls back to Gmail SMTP as before.
// EMAIL_FROM sets the sender everyone sees, e.g. Volta Studio <hello@getvoltastudio.co.uk>
const useResend = Boolean(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || `"Volta Studio" <${process.env.EMAIL_USER}>`;
const REPLY_TO = process.env.EMAIL_REPLY_TO || undefined;

let smtp = null;
if (!useResend) {
  smtp = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  smtp.verify((err) => {
    if (err) console.error('❌ Mailer error:', err.message);
    else console.log(`✅ Mailer ready (Gmail/SMTP: ${process.env.EMAIL_HOST}, sending as ${process.env.EMAIL_USER})`);
  });
} else {
  console.log(`✅ Mailer ready (Resend, sending as ${FROM})`);
}

async function sendViaResend({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, ...(REPLY_TO ? { reply_to: REPLY_TO } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || JSON.stringify(data)}`);
  return { accepted: [to], rejected: [], response: `Resend id ${data.id}` };
}

// Every template below calls transporter.sendMail(...). This sends it the right
// way and logs exactly what happened, so a missing email can be traced.
const transporter = {
  async sendMail(options) {
    const info = (useResend
      ? await sendViaResend(options)
      : await smtp.sendMail({ ...options, from: FROM, ...(REPLY_TO ? { replyTo: REPLY_TO } : {}) })) || {};
    console.log(`   ↳ "${options.subject}" to ${options.to} | accepted: ${info.accepted || '-'} | rejected: ${info.rejected && info.rejected.length ? info.rejected : 'none'} | ${info.response}`);
    return info;
  },
};

// ── Send a contact form notification to the studio owner ──
async function sendContactNotification({ name, email, subject, message }) {
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: process.env.NOTIFY_EMAIL,
    subject: `📬 New contact: ${subject || 'No subject'} — from ${name}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00;margin:0 0 24px">New Contact Submission</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#888">Name</td><td style="padding:8px 0">${name}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${email}" style="color:#C6FF00">${email}</a></td></tr>
          <tr><td style="padding:8px 0;color:#888">Subject</td><td style="padding:8px 0">${subject || '—'}</td></tr>
        </table>
        <div style="margin-top:20px;padding:16px;background:rgba(255,255,255,0.05);border-radius:8px;line-height:1.6">${message}</div>
        <p style="margin-top:24px;font-size:12px;color:#555">Received via Volta Studio contact form</p>
      </div>`,
  });
}

// ── Send confirmation to the person who contacted you ─────
async function sendContactConfirmation({ name, email }) {
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `We got your message, ${name} ⚡`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00">Thanks for reaching out, ${name}!</h2>
        <p style="line-height:1.7;color:#aaa">We've received your message and will get back to you within 1–2 business days.</p>
        <p style="line-height:1.7;color:#aaa">In the meantime, feel free to browse our latest work.</p>
        <a href="${process.env.CLIENT_URL}" style="display:inline-block;margin-top:20px;padding:12px 28px;background:#C6FF00;color:#0A0A0F;border-radius:100px;font-weight:700;text-decoration:none">Back to Volta →</a>
        <p style="margin-top:32px;font-size:12px;color:#555">© Volta Studio</p>
      </div>`,
  });
}

// ── Newsletter welcome email ───────────────────────────────
async function sendNewsletterWelcome({ name, email }) {
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `You're in ⚡ Welcome to the Volta newsletter`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00">Welcome${name ? ', ' + name : ''}!</h2>
        <p style="line-height:1.7;color:#aaa">You're now subscribed to the Volta Studio newsletter. Expect creative insights, project showcases, and studio news — no spam, ever.</p>
        <p style="margin-top:32px;font-size:12px;color:#555">© Volta Studio · <a href="${process.env.CLIENT_URL}/unsubscribe" style="color:#555">Unsubscribe</a></p>
      </div>`,
  });
}

// ── New subscriber notification to the studio owner ───────
async function sendSubscriberNotification({ name, email }) {
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: process.env.NOTIFY_EMAIL,
    subject: `🎉 New subscriber: ${email}`,
    html: `<div style="font-family:sans-serif;padding:24px"><p><strong>${name || 'Someone'}</strong> (${email}) just subscribed to the newsletter.</p></div>`,
  });
}

// ── Project request notification to the studio owner ──────
async function sendProjectRequestNotification(request) {
  const f = request.features || {};
  const featureList = Object.entries({
    'User accounts': f.userAccounts,
    'Payments': f.payments,
    'Admin panel': f.adminPanel,
    'Third-party integrations': f.thirdPartyIntegrations,
    'File uploads': f.fileUploads,
    'Search': f.search,
    'Multiple languages': f.multiLanguage,
  }).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None selected';

  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: process.env.NOTIFY_EMAIL,
    subject: `⚡ New project request: ${request.projectTitle} — from ${request.clientName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00;margin:0 0 24px">New Project Request</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#888">Client</td><td style="padding:8px 0">${request.clientName}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${request.clientEmail}" style="color:#C6FF00">${request.clientEmail}</a></td></tr>
          <tr><td style="padding:8px 0;color:#888">Phone</td><td style="padding:8px 0">${request.clientPhone || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Project</td><td style="padding:8px 0">${request.projectTitle}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Type</td><td style="padding:8px 0">${request.projectType}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Timeline</td><td style="padding:8px 0">${request.timeline}${request.timeline === 'rush' ? ' ⚡ (+40% fee)' : ''}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Budget</td><td style="padding:8px 0">${request.budgetRange || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Features</td><td style="padding:8px 0">${featureList}</td></tr>
        </table>
        <div style="margin-top:20px;padding:16px;background:rgba(255,255,255,0.05);border-radius:8px;line-height:1.6">
          <strong style="color:#888">Brief:</strong><br />${request.description}
          ${request.designReferences ? `<br /><br /><strong style="color:#888">Design references:</strong><br />${request.designReferences}` : ''}
          ${request.additionalNotes ? `<br /><br /><strong style="color:#888">Notes:</strong><br />${request.additionalNotes}` : ''}
        </div>
        <p style="margin-top:24px;font-size:12px;color:#555">Received via Volta Studio project request form</p>
      </div>`,
  });
}

// ── Confirmation to the client who submitted a request ─────
async function sendProjectRequestConfirmation({ clientName, clientEmail, projectTitle, _id }) {
  const trackUrl = `${process.env.CLIENT_URL}/status.html?id=${_id}`;
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: clientEmail,
    subject: `We've got your brief, ${clientName} ⚡`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00">Thanks, ${clientName}!</h2>
        <p style="line-height:1.7;color:#aaa">We've received your brief for <strong style="color:#F7F4EE">${projectTitle}</strong> and we're putting together your quote now.</p>
        <p style="line-height:1.7;color:#aaa">Bookmark this link — it's yours for checking your quote and project status any time:</p>
        <a href="${trackUrl}" style="display:inline-block;margin-top:12px;padding:12px 28px;background:#C6FF00;color:#0A0A0F;border-radius:100px;font-weight:700;text-decoration:none">Track your project →</a>
        <p style="margin-top:20px;line-height:1.7;color:#aaa">Your project ID: <strong style="color:#F7F4EE;font-family:monospace">${_id}</strong><br />You can also enter this (or your email) in the "Track your project" box on our website.</p>
        <p style="margin-top:32px;font-size:12px;color:#555">© Volta Studio</p>
      </div>`,
  });
}

// ── Delivery notification to the client ─────────────────────
async function sendDeliveryNotification({ clientName, clientEmail, projectTitle, _id }) {
  const statusUrl = `${process.env.CLIENT_URL}/status.html?id=${_id}`;
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: clientEmail,
    subject: `Your project is ready, ${clientName} \u26a1`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00">Your files are ready!</h2>
        <p style="line-height:1.7;color:#aaa">${projectTitle} is finished and your delivery files are waiting for you.</p>
        <a href="${statusUrl}" style="display:inline-block;margin-top:20px;padding:12px 28px;background:#C6FF00;color:#0A0A0F;border-radius:100px;font-weight:700;text-decoration:none">Download your files \u2192</a>
        <p style="margin-top:32px;font-size:12px;color:#555">\u00a9 Volta Studio</p>
      </div>`,
  });
}

// ── Deposit paid confirmation to the client ─────────────────
async function sendDepositConfirmation({ clientName, clientEmail, projectTitle, depositAmount, _id }) {
  const statusUrl = `${process.env.CLIENT_URL}/status.html?id=${_id}`;
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: clientEmail,
    subject: `Deposit received for ${projectTitle} ⚡`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00">Thanks, ${clientName}!</h2>
        <p style="line-height:1.7;color:#aaa">We've received your deposit of <strong style="color:#F7F4EE">£${Number(depositAmount).toLocaleString('en-GB')}</strong> for <strong style="color:#F7F4EE">${projectTitle}</strong>. We're getting started.</p>
        <a href="${statusUrl}" style="display:inline-block;margin-top:20px;padding:12px 28px;background:#C6FF00;color:#0A0A0F;border-radius:100px;font-weight:700;text-decoration:none">Track your project →</a>
        <p style="margin-top:32px;font-size:12px;color:#555">© Volta Studio</p>
      </div>`,
  });
}

// ── Deposit paid notification to the studio owner ───────────
async function sendDepositNotification({ clientName, clientEmail, projectTitle, depositAmount, _id }) {
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: process.env.NOTIFY_EMAIL,
    subject: `💰 Deposit paid: ${projectTitle} — ${clientName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00;margin:0 0 24px">Deposit Received</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#888">Client</td><td style="padding:8px 0">${clientName}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${clientEmail}" style="color:#C6FF00">${clientEmail}</a></td></tr>
          <tr><td style="padding:8px 0;color:#888">Project</td><td style="padding:8px 0">${projectTitle}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Amount</td><td style="padding:8px 0">£${Number(depositAmount).toLocaleString('en-GB')}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Request ID</td><td style="padding:8px 0">${_id}</td></tr>
        </table>
        <p style="margin-top:24px;font-size:12px;color:#555">You can move this project to "In progress" from the admin dashboard.</p>
      </div>`,
  });
}

// ── Client proposed a budget — notify the studio owner ──────
async function sendBudgetProposalNotification({ clientName, clientEmail, projectTitle, clientBudget, quotedPrice, _id }) {
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: process.env.NOTIFY_EMAIL,
    subject: `💬 Budget proposed: ${projectTitle} — ${clientName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00;margin:0 0 24px">Client Proposed a Budget</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#888">Client</td><td style="padding:8px 0">${clientName}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${clientEmail}" style="color:#C6FF00">${clientEmail}</a></td></tr>
          <tr><td style="padding:8px 0;color:#888">Project</td><td style="padding:8px 0">${projectTitle}</td></tr>
          <tr><td style="padding:8px 0;color:#888">AI quote was</td><td style="padding:8px 0">£${Number(quotedPrice).toLocaleString('en-GB')}</td></tr>
          <tr><td style="padding:8px 0;color:#888">They offered</td><td style="padding:8px 0;font-weight:700;color:#C6FF00">£${Number(clientBudget).toLocaleString('en-GB')}</td></tr>
        </table>
        <p style="margin-top:24px;font-size:13px;color:#aaa">Go to your admin dashboard to accept their price or send back a counter-offer.</p>
      </div>`,
  });
}

// ── You accepted the client's proposed budget outright ──────
async function sendBudgetAccepted({ clientName, clientEmail, projectTitle, quotedPrice, _id }) {
  const payUrl = `${process.env.CLIENT_URL}/api/requests/${_id}/pay`;
  const quoteUrl = `${process.env.CLIENT_URL}/quote.html?id=${_id}`;
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: clientEmail,
    subject: `Deal — your budget works for ${projectTitle} ⚡`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00">Good news, ${clientName}!</h2>
        <p style="line-height:1.7;color:#aaa">We've accepted your budget of <strong style="color:#F7F4EE">£${Number(quotedPrice).toLocaleString('en-GB')}</strong> for <strong style="color:#F7F4EE">${projectTitle}</strong>. Pay your deposit below to get the project started.</p>
        <a href="${payUrl}" style="display:inline-block;margin-top:20px;padding:12px 28px;background:#C6FF00;color:#0A0A0F;border-radius:100px;font-weight:700;text-decoration:none">Pay deposit →</a>
        <p style="margin-top:20px;font-size:13px;color:#888">Button not working? Copy this link into your browser:<br /><a href="${payUrl}" style="color:#C6FF00;word-break:break-all">${payUrl}</a></p>
        <p style="font-size:13px;color:#888"><a href="${quoteUrl}" style="color:#aaa">View your quote</a></p>
        <p style="margin-top:32px;font-size:12px;color:#555">© Volta Studio</p>
      </div>`,
  });
}

// ── You came back with a different price than what the client offered ──
async function sendBudgetCountered({ clientName, clientEmail, projectTitle, counterPrice, _id }) {
  const payUrl = `${process.env.CLIENT_URL}/api/requests/${_id}/pay`;
  const quoteUrl = `${process.env.CLIENT_URL}/quote.html?id=${_id}`;
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: clientEmail,
    subject: `Our best price for ${projectTitle} ⚡`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00">Hi ${clientName},</h2>
        <p style="line-height:1.7;color:#aaa">Thanks for letting us know your budget. The best we can do for <strong style="color:#F7F4EE">${projectTitle}</strong> is <strong style="color:#F7F4EE">£${Number(counterPrice).toLocaleString('en-GB')}</strong>. If that works for you, pay your deposit below and we'll get started.</p>
        <a href="${payUrl}" style="display:inline-block;margin-top:20px;padding:12px 28px;background:#C6FF00;color:#0A0A0F;border-radius:100px;font-weight:700;text-decoration:none">Accept &amp; pay deposit →</a>
        <p style="margin-top:20px;font-size:13px;color:#888">Button not working? Copy this link into your browser:<br /><a href="${payUrl}" style="color:#C6FF00;word-break:break-all">${payUrl}</a></p>
        <p style="font-size:13px;color:#888">Not for you? <a href="${quoteUrl}" style="color:#aaa">View or decline this offer</a></p>
        <p style="margin-top:32px;font-size:12px;color:#555">© Volta Studio</p>
      </div>`,
  });
}

// ── Final payment (remaining balance) paid confirmation to the client ───
async function sendFinalPaymentConfirmation({ clientName, clientEmail, projectTitle, fullPaymentAmount, _id }) {
  const statusUrl = `${process.env.CLIENT_URL}/status.html?id=${_id}`;
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: clientEmail,
    subject: `Payment complete — your files are unlocked ⚡`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00">All paid up, ${clientName}!</h2>
        <p style="line-height:1.7;color:#aaa">We've received your final payment of <strong style="color:#F7F4EE">£${Number(fullPaymentAmount).toLocaleString('en-GB')}</strong> for <strong style="color:#F7F4EE">${projectTitle}</strong>. Your files are ready to download.</p>
        <a href="${statusUrl}" style="display:inline-block;margin-top:20px;padding:12px 28px;background:#C6FF00;color:#0A0A0F;border-radius:100px;font-weight:700;text-decoration:none">Download your files →</a>
        <p style="margin-top:32px;font-size:12px;color:#555">© Volta Studio</p>
      </div>`,
  });
}

// ── Final payment paid notification to the studio owner ─────
async function sendFinalPaymentNotification({ clientName, clientEmail, projectTitle, fullPaymentAmount, _id }) {
  await transporter.sendMail({
    from: `"Volta Studio" <${process.env.EMAIL_USER}>`,
    to: process.env.NOTIFY_EMAIL,
    subject: `💰 Final payment received: ${projectTitle} — ${clientName}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;background:#0A0A0F;color:#F7F4EE;border-radius:12px">
        <h2 style="color:#C6FF00;margin:0 0 24px">Project Fully Paid</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#888">Client</td><td style="padding:8px 0">${clientName}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${clientEmail}" style="color:#C6FF00">${clientEmail}</a></td></tr>
          <tr><td style="padding:8px 0;color:#888">Project</td><td style="padding:8px 0">${projectTitle}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Final payment</td><td style="padding:8px 0">£${Number(fullPaymentAmount).toLocaleString('en-GB')}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Request ID</td><td style="padding:8px 0">${_id}</td></tr>
        </table>
        <p style="margin-top:24px;font-size:12px;color:#555">This project is now paid in full.</p>
      </div>`,
  });
}

module.exports = {
  sendContactNotification,
  sendContactConfirmation,
  sendNewsletterWelcome,
  sendSubscriberNotification,
  sendProjectRequestNotification,
  sendProjectRequestConfirmation,
  sendDeliveryNotification,
  sendDepositConfirmation,
  sendDepositNotification,
  sendBudgetProposalNotification,
  sendBudgetAccepted,
  sendBudgetCountered,
  sendFinalPaymentConfirmation,
  sendFinalPaymentNotification,
};
