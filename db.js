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

module.exports = { userOps, lookupOps, alertOps, propertyOps, roomOps };
