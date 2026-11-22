/**
 * Database — NeDB (pure JavaScript, no compilation needed)
 */
const Datastore = require('nedb-promises');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Use Railway persistent volume if available, otherwise local data dir
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
  : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const users = Datastore.create({ filename: path.join(DATA_DIR, 'users.db'), autoload: true });
const lookups = Datastore.create({ filename: path.join(DATA_DIR, 'lookups.db'), autoload: true });
const alerts = Datastore.create({ filename: path.join(DATA_DIR, 'alerts.db'), autoload: true });
const properties = Datastore.create({ filename: path.join(DATA_DIR, 'properties.db'), autoload: true });
const rooms = Datastore.create({ filename: path.join(DATA_DIR, 'rooms.db'), autoload: true });
properties.ensureIndex({ fieldName: 'userId' });
rooms.ensureIndex({ fieldName: 'propertyId' });

// Indexes
users.ensureIndex({ fieldName: 'email', unique: true });
users.ensureIndex({ fieldName: 'stripeCustomerId', sparse: true });

// ── User Operations ───────────────────────────────────────────────────────────
const userOps = {
  async create(data) {
    const hash = bcrypt.hashSync(data.password, 12);
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    return users.insert({
      email: data.email.toLowerCase(),
      passwordHash: hash,
      name: data.name,
      company: data.company || null,
      role: data.role || 'subscriber',
      tier: data.tier || 'trial',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionStatus: 'inactive',
      lookupsThisMonth: 0,
      lookupLimit: data.lookupLimit !== undefined ? data.lookupLimit : (data.tier === 'pro' || data.tier === 'client' || data.tier === 'admin' ? -1 : 1),
      notes: data.notes || null,
      createdAt: new Date().toISOString(),
      lastLogin: null,
      trialEndsAt: null, // No time limit — 1 free lookup only
    });
  },

  async findByEmail(email) {
    return users.findOne({ email: email.toLowerCase() });
  },

  async findById(id) {
    return users.findOne({ _id: id });
  },

  verifyPassword(user, password) {
    return bcrypt.compareSync(password, user.passwordHash);
  },

  async updateLastLogin(id) {
    return users.update({ _id: id }, { $set: { lastLogin: new Date().toISOString() } });
  },

  async updateTier(id, tier, lookupLimit) {
    const limits = { admin: -1, pro: -1, client: -1, trial: 10, suspended: 0 };
    const limit = lookupLimit !== undefined ? lookupLimit : (limits[tier] ?? 10);
    return users.update({ _id: id }, { $set: { tier, lookupLimit: limit } });
  },

  async updateSubscription(id, data) {
    const update = {};
    if (data.customerId) update.stripeCustomerId = data.customerId;
    if (data.subscriptionId) update.stripeSubscriptionId = data.subscriptionId;
    if (data.status) update.subscriptionStatus = data.status;
    if (data.tier) update.tier = data.tier;
    return users.update({ _id: id }, { $set: update });
  },

  async incrementLookups(id) {
    return users.update({ _id: id }, { $inc: { lookupsThisMonth: 1 } });
  },

  async resetMonthlyLookups() {
    return users.update({}, { $set: { lookupsThisMonth: 0 } }, { multi: true });
  },

  canLookup(user) {
    if (user.tier === 'suspended') return false;
    if (user.lookupLimit === -1) return true;
    // No time-based trial expiry — only lookup limit applies
    return user.lookupsThisMonth < user.lookupLimit;
  },

  async getAll() {
    const all = await users.find({}).sort({ createdAt: -1 });
    return all.map(u => { const { passwordHash, ...rest } = u; return rest; });
  },

  async update(id, data) {
    return users.update({ _id: id }, { $set: data });
  },

  async setResetToken(email, token, expiresAt) {
    return users.update({ email: email.toLowerCase() }, { $set: { resetToken: token, resetTokenExpires: expiresAt } });
  },

  async findByResetToken(token) {
    return users.findOne({ resetToken: token, resetTokenExpires: { $gt: new Date().toISOString() } });
  },

  async clearResetToken(id, newPasswordHash) {
    return users.update({ _id: id }, { $set: { passwordHash: newPasswordHash, resetToken: null, resetTokenExpires: null } });
  },

  async delete(id) {
    return users.remove({ _id: id });
  },

  async findByStripeCustomer(customerId) {
    return users.findOne({ stripeCustomerId: customerId });
  }
};

// ── Lookup Operations ─────────────────────────────────────────────────────────
const lookupOps = {
  async create(data) {
    return lookups.insert({
      userId: data.userId,
      address: data.address,
      lat: data.lat,
      lon: data.lon,
      eventsFound: data.eventsFound || 0,
      impactScore: data.impactScore || 0,
      createdAt: new Date().toISOString(),
    });
  },

  async getForUser(userId, limit = 20) {
    return lookups.find({ userId }).sort({ createdAt: -1 }).limit(limit);
  },

  async getRecent(limit = 50) {
    const recent = await lookups.find({}).sort({ createdAt: -1 }).limit(limit);
    // Join with user data
    const enriched = await Promise.all(recent.map(async l => {
      const user = await users.findOne({ _id: l.userId });
      return { ...l, email: user?.email, name: user?.name };
    }));
    return enriched;
  },

  async getStats() {
    const all = await lookups.find({});
    const today = new Date().toDateString();
    const thisMonth = new Date().toISOString().slice(0, 7);
    return {
      total: all.length,
      today: all.filter(l => new Date(l.createdAt).toDateString() === today).length,
      thisMonth: all.filter(l => l.createdAt.startsWith(thisMonth)).length,
    };
  }
};

// ── Alert Operations ──────────────────────────────────────────────────────────
const alertOps = {
  async upsert(data) {
    const existing = await alerts.findOne({ alertId: data.alertId });
    if (existing) return existing;
    return alerts.insert({
      alertId: data.alertId,
      area: data.area,
      eventType: data.eventType,
      hailSize: data.hailSize,
      severity: data.severity,
      onset: data.onset,
      detectedAt: new Date().toISOString(),
    });
  },

  async getRecent(limit = 20) {
    return alerts.find({}).sort({ detectedAt: -1 }).limit(limit);
  }
};

// ── Interior: Properties & Rooms ──────────────────────────────────────────────
const now = () => new Date().toISOString();

const propertyOps = {
  async create(userId, data) {
    return properties.insert({
      userId,
      address: String(data.address || '').trim(),
      claimNumber: data.claimNumber || '',
      insuredName: data.insuredName || '',
      floors: Array.isArray(data.floors) && data.floors.length ? data.floors : ['Entrance Floor'],
      createdAt: now(),
      updatedAt: now(),
    });
  },
  async listForUser(userId) {
    const list = await properties.find({ userId }).sort({ updatedAt: -1 });
    return Promise.all(list.map(async p => {
      const rs = await rooms.find({ propertyId: p._id });
      return { ...p, roomCount: rs.length, floorSF: rs.reduce((s, r) => s + (r.metrics?.floorSF || 0), 0) };
    }));
  },
  async get(userId, id) {
    return properties.findOne({ _id: id, userId });
  },
  async update(userId, id, data) {
    const allowed = {};
    for (const k of ['address', 'claimNumber', 'insuredName', 'floors']) if (data[k] !== undefined) allowed[k] = data[k];
    allowed.updatedAt = now();
    await properties.update({ _id: id, userId }, { $set: allowed });
    return properties.findOne({ _id: id, userId });
  },
  async touch(id) {
    return properties.update({ _id: id }, { $set: { updatedAt: now() } });
  },
  async remove(userId, id) {
    const n = await properties.remove({ _id: id, userId });
    if (n) await rooms.remove({ propertyId: id }, { multi: true });
    return n;
  },
};

const roomOps = {
  async create(propertyId, userId, data) {
    return rooms.insert({ ...data, propertyId, userId, createdAt: now(), updatedAt: now() });
  },
  async listForProperty(propertyId) {
    return rooms.find({ propertyId }).sort({ createdAt: 1 });
  },
  async get(userId, id) {
    return rooms.findOne({ _id: id, userId });
  },
  async replace(userId, id, data) {
    await rooms.update({ _id: id, userId }, { $set: { ...data, updatedAt: now() } });
    return rooms.findOne({ _id: id, userId });
  },
  async remove(userId, id) {
    return rooms.remove({ _id: id, userId });
  },
};

// ── Pricing: area price sheets, contractor pricing, change log, requests ─────
const pricing = require('./lib/pricing');
const priceSheets   = Datastore.create({ filename: path.join(DATA_DIR, 'price_sheets.db'), autoload: true });
const userPricing   = Datastore.create({ filename: path.join(DATA_DIR, 'user_pricing.db'), autoload: true });
const priceChanges  = Datastore.create({ filename: path.join(DATA_DIR, 'price_changes.db'), autoload: true });
const priceRequests = Datastore.create({ filename: path.join(DATA_DIR, 'price_requests.db'), autoload: true });
userPricing.ensureIndex({ fieldName: 'userId', unique: true });

const pricingOps = {
  // Area price sheets (admin-managed, visible to every user)
  async listSheets() {
    return priceSheets.find({}).sort({ isDefault: -1, area: 1 });
  },
  async getSheet(id) { return priceSheets.findOne({ _id: id }); },
  async getDefaultSheet() {
    return (await priceSheets.findOne({ isDefault: true })) || (await priceSheets.findOne({}));
  },
  async saveSheet(data, id) {
    const doc = {
      area: String(data.area || '').trim().slice(0, 80),
      version: String(data.version || '').trim().slice(0, 40),
      source: String(data.source || '').trim().slice(0, 60),
      prices: { ...pricing.defaultPrices(), ...pricing.cleanPrices(data.prices) },
      codes: pricing.cleanCodes(data.codes),
      updatedAt: now(),
    };
    if (!doc.area) throw new Error('Area is required');
    if (id) {
      await priceSheets.update({ _id: id }, { $set: doc });
      return priceSheets.findOne({ _id: id });
    }
    const hasDefault = await priceSheets.findOne({ isDefault: true });
    return priceSheets.insert({ ...doc, isDefault: !hasDefault, createdAt: now() });
  },
  async setDefaultSheet(id) {
    await priceSheets.update({}, { $set: { isDefault: false } }, { multi: true });
    await priceSheets.update({ _id: id }, { $set: { isDefault: true } });
  },
  async removeSheet(id) {
    const s = await priceSheets.findOne({ _id: id });
    if (s?.isDefault) throw new Error('Set another sheet as the default before deleting this one');
    return priceSheets.remove({ _id: id });
  },

  // A contractor's own saved pricing (one per user)
  async getUserPricing(userId) { return userPricing.findOne({ userId }); },
  async saveUserPricing(user, data) {
    const prev = await userPricing.findOne({ userId: user._id });
    const base = data.baseSheetId ? await priceSheets.findOne({ _id: data.baseSheetId }) : null;
    const doc = {
      userId: user._id,
      area: String(data.area || '').trim().slice(0, 80),
      baseSheetId: base?._id || prev?.baseSheetId || null,
      baseSheetLabel: base ? `${base.area}${base.version ? ' — ' + base.version : ''}` : (prev?.baseSheetLabel || null),
      prices: { ...pricing.defaultPrices(), ...(prev?.prices || {}), ...pricing.cleanPrices(data.prices) },
      updatedAt: now(),
    };
    if (!doc.area) throw new Error('Enter the area you work in (city, state)');
    // What changed: vs. their last save, or vs. the sheet they started from
    const compareTo = prev?.prices || base?.prices || pricing.defaultPrices();
    const changes = pricing.diffPrices(compareTo, doc.prices);
    if (prev) await userPricing.update({ userId: user._id }, { $set: doc });
    else await userPricing.insert({ ...doc, createdAt: now() });
    if (changes.length || !prev || prev.area !== doc.area) {
      await priceChanges.insert({
        userId: user._id, name: user.name, email: user.email, company: user.company || null,
        area: doc.area, baseSheetLabel: doc.baseSheetLabel, firstSave: !prev, changes, createdAt: now(),
      });
    }
    return { pricing: doc, changes, firstSave: !prev };
  },
  async listAllUserPricing() {
    const list = await userPricing.find({}).sort({ updatedAt: -1 });
    return Promise.all(list.map(async p => {
      const u = await users.findOne({ _id: p.userId });
      const base = p.baseSheetId ? await priceSheets.findOne({ _id: p.baseSheetId }) : null;
      return {
        ...p, name: u?.name, email: u?.email, company: u?.company,
        differences: pricing.diffPrices(base?.prices || pricing.defaultPrices(), p.prices),
      };
    }));
  },
  async recentChanges(limit = 100) {
    return priceChanges.find({}).sort({ createdAt: -1 }).limit(limit);
  },

  // "Request local pricing"
  async createRequest(user, data) {
    return priceRequests.insert({
      userId: user._id, name: user.name, email: user.email, company: user.company || null,
      area: String(data.area || '').trim().slice(0, 80),
      notes: String(data.notes || '').trim().slice(0, 500),
      address: String(data.address || '').trim().slice(0, 200),
      status: 'open', sheetId: null, createdAt: now(),
    });
  },
  async listRequests() { return priceRequests.find({}).sort({ status: -1, createdAt: -1 }); },
  async openRequestsForUser(userId) { return priceRequests.find({ userId, status: 'open' }); },
  async fulfillRequests(ids, sheetId) {
    const reqs = await priceRequests.find({ _id: { $in: ids } });
    await priceRequests.update({ _id: { $in: ids } }, { $set: { status: 'fulfilled', sheetId, fulfilledAt: now() } }, { multi: true });
    return reqs;
  },
  async closeRequest(id) {
    return priceRequests.update({ _id: id }, { $set: { status: 'closed', fulfilledAt: now() } });
  },
};

// First run: create the default DFW sheet from the current built-in prices
(async () => {
  if (!(await priceSheets.count({}))) {
    await priceSheets.insert({
      area: 'DFW', version: 'Starter prices', source: 'RoofTrace defaults — replace with Xactimate DFW',
      prices: pricing.defaultPrices(), codes: {}, isDefault: true, createdAt: now(), updatedAt: now(),
    });
  }
})().catch(console.error);

// ── Seed Admin ────────────────────────────────────────────────────────────────
async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || 'ryan@thepublicadjustertx.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'FirstCall2026!';
  const existing = await userOps.findByEmail(adminEmail);
  if (!existing) {
    await userOps.create({
      email: adminEmail,
      password: adminPassword,
      name: 'Ryan',
      company: 'First Call Public Adjusters',
      role: 'admin',
      tier: 'admin',
      lookupLimit: -1,
    });
    console.log(`Admin account created: ${adminEmail}`);
  } else {
    // Always sync admin password from env var on startup
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(adminPassword, 12);
    await users.update({ email: adminEmail }, { $set: { passwordHash: hash, role: 'admin', tier: 'admin', lookupLimit: -1 } });
    console.log(`Admin password synced from env: ${adminEmail}`);
  }
}

seedAdmin().catch(console.error);

// Auto-seed client users from environment variables
// Format: SEED_USERS=name:email:password:tier|name:email:password:tier
async function seedClientUsers() {
  const seedData = process.env.SEED_USERS;
  if (!seedData) return;
  const entries = seedData.split('|');
  for (const entry of entries) {
    const [name, email, password, tier] = entry.split(':');
    if (!name || !email || !password) continue;
    const existing = await userOps.findByEmail(email);
    if (!existing) {
      await userOps.create({ name, email, password, tier: tier || 'client', role: 'subscriber', lookupLimit: -1 });
      console.log(`Auto-seeded user: ${email} (${tier || 'client'})`);
    }
  }
}

seedClientUsers().catch(console.error);

module.exports = { userOps, lookupOps, alertOps, propertyOps, roomOps, pricingOps };
