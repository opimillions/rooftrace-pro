/**
 * Pricing API
 *  - Everyone: list area price sheets, load/save "My pricing", request local pricing
 *  - Admin: manage area sheets, see contractor pricing + change log, handle requests
 * Admin is emailed (ADMIN_EMAIL) when a contractor saves pricing or requests local pricing.
 */
const express = require('express');
const { pricingOps } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { ITEMS } = require('../lib/pricing');

const router = express.Router();
router.use(requireAuth);

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error('[pricing]', err);
  res.status(400).json({ error: err.message || 'Request failed' });
});

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v, unit) => unit === '%' ? `${v}%` : `$${Number(v).toFixed(2)}`;

async function sendMail(to, subject, html) {
  if (!to) return;
  if (!process.env.SMTP_HOST) { console.log(`\n[pricing email → ${to}] ${subject}\n`); return; }
  try {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await t.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
  } catch (err) { console.error('[pricing email failed]', err.message); }
}
const adminEmail = () => process.env.ADMIN_EMAIL || 'ryan@thepublicadjustertx.com';
const adminLink = () => `${process.env.BASE_URL || ''}/admin/pricing`;

// ── Everyone ──────────────────────────────────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const [sheets, mine, openRequests] = await Promise.all([
    pricingOps.listSheets(),
    pricingOps.getUserPricing(req.user._id),
    pricingOps.openRequestsForUser(req.user._id),
  ]);
  res.json({ items: ITEMS, sheets, mine, openRequests });
}));

router.put('/mine', wrap(async (req, res) => {
  const result = await pricingOps.saveUserPricing(req.user, req.body || {});
  if (req.user.role !== 'admin' && (result.changes.length || result.firstSave)) {
    const u = req.user, p = result.pricing;
    const rows = result.changes.map(c =>
      `<tr><td>${esc(c.label)}</td><td>${c.from == null ? '—' : money(c.from, c.unit)}</td><td><b>${money(c.to, c.unit)}</b></td></tr>`).join('');
    await sendMail(adminEmail(),
      `RoofTrace pricing saved — ${u.company || u.name} (${p.area})`,
      `<p><b>${esc(u.name)}</b> (${esc(u.email)}${u.company ? ', ' + esc(u.company) : ''}) saved their pricing.</p>
       <p>Area: <b>${esc(p.area)}</b><br>Started from: ${esc(p.baseSheetLabel || 'default prices')}</p>
       ${rows ? `<table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Item</th><th>Was</th><th>Now</th></tr>${rows}</table>` : '<p>No price changes from the sheet they started from.</p>'}
       <p><a href="${adminLink()}">Open contractor pricing</a></p>`);
  }
  res.json(result);
}));

router.post('/requests', wrap(async (req, res) => {
  const area = String(req.body?.area || '').trim();
  if (!area) return res.status(400).json({ error: 'Enter the area you need pricing for' });
  const r = await pricingOps.createRequest(req.user, req.body);
  const u = req.user;
  await sendMail(adminEmail(),
    `Local pricing requested — ${r.area}`,
    `<p><b>${esc(u.name)}</b> (${esc(u.email)}${u.company ? ', ' + esc(u.company) : ''}) requested a price sheet for <b>${esc(r.area)}</b>.</p>
     ${r.address ? `<p>Property: ${esc(r.address)}</p>` : ''}
     ${r.notes ? `<p>Notes: ${esc(r.notes)}</p>` : ''}
     <p><a href="${adminLink()}">Create the price sheet</a></p>`);
  res.json(r);
}));

// ── Admin ─────────────────────────────────────────────────────────────────────
router.get('/admin/overview', requireAdmin, wrap(async (req, res) => {
  const [sheets, contractors, changes, requests] = await Promise.all([
    pricingOps.listSheets(), pricingOps.listAllUserPricing(),
    pricingOps.recentChanges(), pricingOps.listRequests(),
  ]);
  res.json({ items: ITEMS, sheets, contractors, changes, requests });
}));

async function notifyFulfilled(requestIds, sheet) {
  if (!Array.isArray(requestIds) || !requestIds.length) return;
  const reqs = await pricingOps.fulfillRequests(requestIds, sheet._id);
  for (const r of reqs) {
    await sendMail(r.email,
      `Local pricing ready — ${sheet.area}`,
      `<p>Hi ${esc(r.name || '')},</p>
       <p>The <b>${esc(sheet.area)}</b> price sheet you requested is now available in RoofTrace Pro.
       Open the Estimate and choose it from the <b>Price list</b> menu. You can adjust it and save it as your own pricing.</p>
       <p><a href="${process.env.BASE_URL || ''}/tool">Open RoofTrace Pro</a></p>`);
  }
}

router.post('/admin/sheets', requireAdmin, wrap(async (req, res) => {
  const sheet = await pricingOps.saveSheet(req.body || {});
  await notifyFulfilled(req.body?.fulfillRequestIds, sheet);
  res.json(sheet);
}));

router.put('/admin/sheets/:id', requireAdmin, wrap(async (req, res) => {
  const sheet = await pricingOps.saveSheet(req.body || {}, req.params.id);
  await notifyFulfilled(req.body?.fulfillRequestIds, sheet);
  res.json(sheet);
}));

router.post('/admin/sheets/:id/default', requireAdmin, wrap(async (req, res) => {
  await pricingOps.setDefaultSheet(req.params.id);
  res.json({ success: true });
}));

router.delete('/admin/sheets/:id', requireAdmin, wrap(async (req, res) => {
  await pricingOps.removeSheet(req.params.id);
  res.json({ success: true });
}));

router.post('/admin/requests/:id/close', requireAdmin, wrap(async (req, res) => {
  await pricingOps.closeRequest(req.params.id);
  res.json({ success: true });
}));

module.exports = router;
