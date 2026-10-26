/**
 * Interior API — properties, floors and rooms (LiDAR scans or manual entry).
 * Used by /interior in the web app and by the RoofTrace Scan iPhone app,
 * which authenticates with a Bearer token from POST /api/auth/token.
 */
const express = require('express');
const { propertyOps, roomOps } = require('../db');
const { requireAuth } = require('../auth');
const geo = require('../lib/roomGeometry');

const router = express.Router();
router.use(requireAuth);

const clean = (s, max = 80) => String(s ?? '').trim().slice(0, max);
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error('[interior]', err);
  res.status(400).json({ error: err.message || 'Request failed' });
});

function withMetrics(room) {
  return { ...room, metrics: geo.computeMetrics(room) };
}

async function loadProperty(req, res) {
  const p = await propertyOps.get(req.user._id, req.params.id);
  if (!p) { res.status(404).json({ error: 'Property not found' }); return null; }
  return p;
}

function ensureFloor(property, floor) {
  if (floor && !property.floors.includes(floor)) property.floors.push(floor);
  return floor || property.floors[0] || 'Entrance Floor';
}

// ── Properties ────────────────────────────────────────────────────────────────
router.get('/properties', wrap(async (req, res) => {
  res.json(await propertyOps.listForUser(req.user._id));
}));

router.post('/properties', wrap(async (req, res) => {
  const address = clean(req.body.address, 200);
  if (!address) return res.status(400).json({ error: 'Address is required' });
  const p = await propertyOps.create(req.user._id, {
    address,
    claimNumber: clean(req.body.claimNumber, 60),
    insuredName: clean(req.body.insuredName, 100),
  });
  res.json(p);
}));

router.get('/properties/:id', wrap(async (req, res) => {
  const p = await loadProperty(req, res); if (!p) return;
  const rooms = await roomOps.listForProperty(p._id);
  res.json({ ...p, rooms });
}));

router.patch('/properties/:id', wrap(async (req, res) => {
  const p = await loadProperty(req, res); if (!p) return;
  const patch = {};
  if (req.body.address !== undefined) patch.address = clean(req.body.address, 200);
  if (req.body.claimNumber !== undefined) patch.claimNumber = clean(req.body.claimNumber, 60);
  if (req.body.insuredName !== undefined) patch.insuredName = clean(req.body.insuredName, 100);
  if (Array.isArray(req.body.floors)) patch.floors = req.body.floors.map(f => clean(f, 40)).filter(Boolean);
  res.json(await propertyOps.update(req.user._id, p._id, patch));
}));

router.delete('/properties/:id', wrap(async (req, res) => {
  const n = await propertyOps.remove(req.user._id, req.params.id);
  if (!n) return res.status(404).json({ error: 'Property not found' });
  res.json({ success: true });
}));

// ── Rooms ─────────────────────────────────────────────────────────────────────
// Body: { name, floor, scan: {...RoomPlan export...} }  → LiDAR room
//   or  { name, floor, lengthFt, widthFt, ceilingHeightFt } → manual rectangle
router.post('/properties/:id/rooms', wrap(async (req, res) => {
  const p = await loadProperty(req, res); if (!p) return;
  const name = clean(req.body.name, 60) || 'Room';
  const shape = req.body.scan ? geo.roomFromScan(req.body.scan) : geo.roomFromDimensions(req.body);
  const floor = ensureFloor(p, clean(req.body.floor, 40));
  await propertyOps.update(req.user._id, p._id, { floors: p.floors });
  const room = withMetrics({ name, floor, ...shape });
  res.json(await roomOps.create(p._id, req.user._id, room));
}));

router.patch('/rooms/:roomId', wrap(async (req, res) => {
  const room = await roomOps.get(req.user._id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const next = { ...room };
  if (req.body.name !== undefined) next.name = clean(req.body.name, 60) || room.name;
  if (req.body.ceilingHeightFt !== undefined) {
    const h = Number(req.body.ceilingHeightFt);
    if (!(h > 0 && h < 60)) return res.status(400).json({ error: 'Ceiling height must be between 0 and 60 ft' });
    next.ceilingHeightFt = h;
  }
  if (req.body.floor !== undefined) {
    const p = await propertyOps.get(req.user._id, room.propertyId);
    next.floor = ensureFloor(p, clean(req.body.floor, 40));
    await propertyOps.update(req.user._id, p._id, { floors: p.floors });
  }
  if (req.body.lengthFt !== undefined && room.source === 'manual') {
    Object.assign(next, geo.roomFromDimensions({ ...req.body, ceilingHeightFt: next.ceilingHeightFt }));
  }
  const { _id, createdAt, updatedAt, ...data } = withMetrics(next);
  const saved = await roomOps.replace(req.user._id, room._id, data);
  await propertyOps.touch(room.propertyId);
  res.json(saved);
}));

router.delete('/rooms/:roomId', wrap(async (req, res) => {
  const room = await roomOps.get(req.user._id, req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  await roomOps.remove(req.user._id, room._id);
  await propertyOps.touch(room.propertyId);
  res.json({ success: true });
}));

module.exports = router;
