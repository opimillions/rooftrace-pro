/**
 * RoofTrace Pro — Server
 * rooftrace.thepublicadjustertx.com
 */
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const cron = require('node-cron');

const { userOps, lookupOps, alertOps, invoiceOps } = require('./db');
const { generateToken, requireAuth, requireAdmin, requireActiveSubscription } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
    next();
  });
}

app.use(express.static(path.join(__dirname, 'public')));

// ── Auth Routes ───────────────────────────────────────────────────────────────
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'forgot-password.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reset-password.html')));
app.get('/upgrade', (req, res) => res.sendFile(path.join(__dirname, 'public', 'upgrade.html')));
app.get('/admin', requireAuth, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin', requireAuth, requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const user = await userOps.findByEmail(email);
    if (!user || !userOps.verifyPassword(user, password)) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.tier === 'suspended') return res.status(403).json({ error: 'Account suspended. Contact support.' });
    await userOps.updateLastLogin(user._id);
    const token = generateToken(user);
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7*24*60*60*1000 });
    res.json({ success: true, redirect: user.role === 'admin' ? '/admin' : '/tool' });
  } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, company } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email, and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const existing = await userOps.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });
    await userOps.create({ email, password, name, company, role: 'subscriber', tier: 'trial', lookupLimit: 1 });
    const user = await userOps.findByEmail(email);
    const token = generateToken(user);
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7*24*60*60*1000 });
    res.json({ success: true, redirect: '/tool' });
  } catch (err) { res.status(500).json({ error: 'Registration failed' }); }
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ success: true }); });

// Forgot/Reset password
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await userOps.findByEmail(email || '');
    if (user) {
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60*60*1000).toISOString();
      await userOps.setResetToken(email, token, expires);
      const resetUrl = `${process.env.BASE_URL}/reset-password?token=${token}`;
      if (process.env.SMTP_HOST) {
        const nodemailer = require('nodemailer');
        const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT||'587'), auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
        await t.sendMail({ from: process.env.SMTP_FROM, to: email, subject: 'Reset your RoofTrace Pro password', html: `<p>Click to reset your password: <a href="${resetUrl}">${resetUrl}</a></p><p>Expires in 1 hour.</p>` });
      } else { console.log(`\nROOFTRACE RESET LINK for ${email}:\n${resetUrl}\n`); }
    }
    res.json({ success: true });
  } catch (err) { res.json({ success: true }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || password.length < 8) return res.status(400).json({ error: 'Invalid request' });
  try {
    const user = await userOps.findByResetToken(token);
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    const bcrypt = require('bcryptjs');
    await userOps.clearResetToken(user._id, bcrypt.hashSync(password, 12));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Reset failed' }); }
});

// ── Tool Route (protected) ────────────────────────────────────────────────────
app.get('/tool', requireAuth, (req, res) => {
  // Admins always have access
  if (req.user.role === 'admin') return res.sendFile(path.join(__dirname, 'public', 'tool.html'));
  // Check subscription for regular users
  if (!userOps.canLookup(req.user)) return res.redirect('/upgrade?reason=limit');
  res.sendFile(path.join(__dirname, 'public', 'tool.html'));
});

// ── Me API ────────────────────────────────────────────────────────────────────

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => res.json(await userOps.getAll()));
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, name, company, tier, notes } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email, password required' });
  const existing = await userOps.findByEmail(email);
  if (existing) return res.status(409).json({ error: 'Email already exists' });
  await userOps.create({ email, password, name, company, tier: tier||'trial', notes, role:'subscriber', lookupLimit: (tier==='pro'||tier==='client')?-1:1 });
  res.json({ success: true });
});
app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { tier, notes } = req.body;
  if (tier) await userOps.updateTier(req.params.id, tier);
  if (notes !== undefined) await userOps.update(req.params.id, { notes });
  res.json({ success: true });
});
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  await userOps.delete(req.params.id); res.json({ success: true });
});
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  const allUsers = await userOps.getAll();
  res.json({ users: { total: allUsers.length, pro: allUsers.filter(u=>u.tier==='pro').length, trial: allUsers.filter(u=>u.tier==='trial').length, client: allUsers.filter(u=>u.tier==='client').length }, lookups: { total: 0, today: 0 }, recentAlerts: [], recentLookups: [] });
});
app.get('/api/me', requireAuth, async (req, res) => {
  const { passwordHash, ...user } = req.user;
  res.json({ user });
});

// ── Track report generation (count against limit) ─────────────────────────────
app.post('/api/track-report', requireAuth, requireActiveSubscription, async (req, res) => {
  await userOps.incrementLookups(req.user._id);
  res.json({ success: true });
});

// ── Admin Routes ──────────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => res.json(await userOps.getAll()));
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, name, company, tier, notes } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Name, email, password required' });
  const existing = await userOps.findByEmail(email);
  if (existing) return res.status(409).json({ error: 'Email already exists' });
  await userOps.create({ email, password, name, company, tier: tier||'trial', notes, role:'subscriber', lookupLimit: (tier==='pro'||tier==='client')?-1:1 });
  res.json({ success: true });
});
app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { tier, notes } = req.body;
  if (tier) await userOps.updateTier(req.params.id, tier);
  if (notes !== undefined) await userOps.update(req.params.id, { notes });
  res.json({ success: true });
});
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  await userOps.delete(req.params.id); res.json({ success: true });
});
app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  const all = await userOps.getAll();
  res.json({ users: { total: all.length, pro: all.filter(u=>u.tier==='pro').length, trial: all.filter(u=>u.tier==='trial').length, client: all.filter(u=>u.tier==='client').length } });
});

// ── Stripe ────────────────────────────────────────────────────────────────────
app.post('/api/stripe/checkout', requireAuth, async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) return res.status(500).json({ error: 'Stripe not configured' });
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', payment_method_types: ['card'],
      customer_email: req.user.email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.BASE_URL}/tool?subscribed=1`,
      cancel_url: `${process.env.BASE_URL}/upgrade`,
      metadata: { userId: req.user._id },
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/stripe/webhook', express.raw({ type:'application/json' }), async (req, res) => {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  try {
    const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const user = await userOps.findByEmail(s.customer_email);
      if (user) { await userOps.updateSubscription(user._id, { customerId:s.customer, subscriptionId:s.subscription, status:'active', tier:'pro' }); await userOps.updateTier(user._id, 'pro', -1); }
    }
    if (event.type === 'customer.subscription.deleted') {
      const user = await userOps.findByStripeCustomer(event.data.object.customer);
      if (user) { await userOps.updateSubscription(user._id, { status:'canceled', tier:'trial' }); await userOps.updateTier(user._id, 'trial', 1); }
    }
  } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }
  res.json({ received: true });
});

// ── Invoices Page ─────────────────────────────────────────────────────────────
app.get('/invoices', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoices.html')));

// Public invoice view (no auth — uses viewToken for security)
app.get('/invoice/view/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoice-view.html')));

// Tracking pixel — fired when client opens the email
const TRACKING_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
app.get('/track/:token.gif', async (req, res) => {
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' });
  res.send(TRACKING_GIF);
  try {
    const inv = await invoiceOps.findByTrackToken(req.params.token);
    if (inv) {
      await invoiceOps.addEvent(inv._id, 'email_opened', {
        recipient: inv.clientEmail,
        ip: req.headers['x-forwarded-for'] || req.ip,
        ua: req.headers['user-agent'] || '',
      });
    }
  } catch (_) {}
});

// ── Invoice API ───────────────────────────────────────────────────────────────
// List
app.get('/api/invoices', requireAuth, async (req, res) => {
  try { res.json(await invoiceOps.getForUser(req.user._id)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Create
app.post('/api/invoices', requireAuth, async (req, res) => {
  try { res.json(await invoiceOps.create(req.user._id, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Get single (authenticated)
app.get('/api/invoices/:id', requireAuth, async (req, res) => {
  try {
    const inv = await invoiceOps.findById(req.params.id);
    if (!inv || (inv.userId !== req.user._id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Not found' });
    res.json(inv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get single (public — by viewToken)
app.get('/api/invoices/:id/public', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(403).json({ error: 'Token required' });
  try {
    const inv = await invoiceOps.findByViewToken(req.params.id, token);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    // Record view event
    await invoiceOps.addEvent(inv._id, 'invoice_viewed', {
      ip: req.headers['x-forwarded-for'] || req.ip,
      ua: req.headers['user-agent'] || '',
    });
    res.json(inv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update
app.patch('/api/invoices/:id', requireAuth, async (req, res) => {
  try {
    const inv = await invoiceOps.findById(req.params.id);
    if (!inv || inv.userId !== req.user._id) return res.status(404).json({ error: 'Not found' });
    await invoiceOps.update(req.params.id, req.user._id, req.body);
    await invoiceOps.addEvent(req.params.id, 'draft_saved', { note: 'Invoice version saved' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete
app.delete('/api/invoices/:id', requireAuth, async (req, res) => {
  try {
    const inv = await invoiceOps.findById(req.params.id);
    if (!inv || inv.userId !== req.user._id) return res.status(404).json({ error: 'Not found' });
    await invoiceOps.delete(req.params.id, req.user._id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get events / history
app.get('/api/invoices/:id/events', requireAuth, async (req, res) => {
  try {
    const inv = await invoiceOps.findById(req.params.id);
    if (!inv || inv.userId !== req.user._id) return res.status(404).json({ error: 'Not found' });
    res.json(await invoiceOps.getEvents(req.params.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send invoice
app.post('/api/invoices/:id/send', requireAuth, async (req, res) => {
  const { method } = req.body; // 'email' | 'sms'
  try {
    const inv = await invoiceOps.findById(req.params.id);
    if (!inv || inv.userId !== req.user._id) return res.status(404).json({ error: 'Not found' });

    const base = process.env.BASE_URL || `http://localhost:${PORT}`;
    const viewUrl  = `${base}/invoice/view/${inv._id}?token=${inv.viewToken}`;
    const trackUrl = `${base}/track/${inv.trackToken}.gif`;
    const bizName  = inv.businessInfo?.businessName || req.user.company || req.user.name;
    const total    = `$${(inv.total || 0).toFixed(2)}`;

    if (method === 'email') {
      if (!inv.clientEmail) return res.status(400).json({ error: 'No client email on this invoice' });
      if (!process.env.SMTP_HOST) return res.status(400).json({ error: 'Email not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM in environment.' });

      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });

      const itemRows = (inv.items || []).map(it =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${it.description}</td>
         <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center">${it.qty || 1} × $${Number(it.rate || 0).toFixed(2)}</td>
         <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">$${Number(it.amount || 0).toFixed(2)}</td></tr>`
      ).join('');

      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a2e">
<h2 style="margin:0 0 4px">${bizName}</h2>
${inv.businessInfo?.businessPhone ? `<p style="margin:0;color:#555;font-size:0.9em">${inv.businessInfo.businessPhone}</p>` : ''}
<hr style="margin:16px 0;border:none;border-top:2px solid #3b4ed8">
<p style="margin:0 0 4px;font-size:0.85em;color:#888">INVOICE</p>
<h3 style="margin:0 0 16px">${inv.invoiceNumber} — ${total}</h3>
<p>Hi ${inv.clientName || 'there'},</p>
<p>Please find your invoice details below.</p>
<table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:0.9em">
  <thead><tr style="background:#f3f4f6">
    <th style="padding:10px 8px;text-align:left">Description</th>
    <th style="padding:10px 8px;text-align:center">Qty × Rate</th>
    <th style="padding:10px 8px;text-align:right">Amount</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
  <tfoot>
    ${inv.discount ? `<tr><td colspan="2" style="padding:8px;text-align:right;color:#555">Discount</td><td style="padding:8px;text-align:right;color:#555">-$${Number(inv.discount).toFixed(2)}</td></tr>` : ''}
    ${inv.tax ? `<tr><td colspan="2" style="padding:8px;text-align:right;color:#555">Tax (${inv.taxRate}%)</td><td style="padding:8px;text-align:right;color:#555">$${Number(inv.tax).toFixed(2)}</td></tr>` : ''}
    <tr style="font-weight:bold;font-size:1.05em"><td colspan="2" style="padding:10px 8px;text-align:right">Total Due</td><td style="padding:10px 8px;text-align:right">${total}</td></tr>
  </tfoot>
</table>
${inv.businessInfo?.paymentInfo ? `<p style="background:#f9fafb;padding:12px;border-radius:6px;font-size:0.88em"><strong>Payment Options:</strong><br>${inv.businessInfo.paymentInfo.replace(/\n/g,'<br>')}</p>` : ''}
${inv.notes ? `<p style="margin-top:16px;font-size:0.9em;color:#444">${inv.notes}</p>` : ''}
<p style="margin-top:24px">
  <a href="${viewUrl}" style="display:inline-block;background:#3b4ed8;color:white;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:0.95em">View Invoice Online</a>
</p>
<p style="margin-top:24px;font-size:0.82em;color:#999">You received this because ${bizName} sent you an invoice.<br>${inv.dueDate ? `Due date: ${new Date(inv.dueDate).toLocaleDateString()}` : 'Due on receipt'}</p>
<img src="${trackUrl}" width="1" height="1" style="display:block;opacity:0;position:absolute" alt="">
</body></html>`;

      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: inv.clientEmail,
        subject: `Invoice ${inv.invoiceNumber} from ${bizName} — ${total}`,
        html,
      });

      await invoiceOps.update(req.params.id, req.user._id, { status: inv.status === 'draft' ? 'sent' : inv.status, sentAt: new Date().toISOString() });
      await invoiceOps.addEvent(req.params.id, 'sent_email', { recipient: inv.clientEmail });
      return res.json({ success: true, viewUrl });
    }

    if (method === 'sms') {
      if (!inv.clientPhone) return res.status(400).json({ error: 'No client phone number on this invoice' });
      if (!process.env.TWILIO_ACCOUNT_SID) return res.status(400).json({ error: 'SMS not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in environment.' });

      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const smsBody = `Hi ${inv.clientName || 'there'}, your invoice ${inv.invoiceNumber} for ${total} from ${bizName} is ready. View & pay here: ${viewUrl}`;
      await twilio.messages.create({ body: smsBody, from: process.env.TWILIO_PHONE_NUMBER, to: inv.clientPhone });

      await invoiceOps.update(req.params.id, req.user._id, { status: inv.status === 'draft' ? 'sent' : inv.status, sentAt: new Date().toISOString() });
      await invoiceOps.addEvent(req.params.id, 'sent_sms', { recipient: inv.clientPhone });
      return res.json({ success: true, viewUrl });
    }

    res.status(400).json({ error: 'method must be email or sms' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mark paid
app.post('/api/invoices/:id/mark-paid', requireAuth, async (req, res) => {
  try {
    const inv = await invoiceOps.findById(req.params.id);
    if (!inv || inv.userId !== req.user._id) return res.status(404).json({ error: 'Not found' });
    await invoiceOps.update(req.params.id, req.user._id, { status: 'paid', paidAt: new Date().toISOString() });
    await invoiceOps.addEvent(req.params.id, 'marked_paid', {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const token = req.cookies?.token;
  if (token) return res.redirect('/tool');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.redirect('/');
});

// Monthly lookup reset
cron.schedule('0 0 1 * *', () => userOps.resetMonthlyLookups(), { timezone: 'America/Chicago' });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nRoofTrace Pro running on http://0.0.0.0:${PORT}`);
  console.log(`Admin: ${process.env.ADMIN_EMAIL}\n`);
});

module.exports = app;
