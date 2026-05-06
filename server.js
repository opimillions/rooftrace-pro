/**
 * RoofTrace Pro — Server
 * rooftrace.thepublicadjustertx.com
 */
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const cron = require('node-cron');

const { userOps, lookupOps, alertOps } = require('./db');
const { generateToken, requireAuth, requireAdmin, requireActiveSubscription } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
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
