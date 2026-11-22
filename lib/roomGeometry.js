/**
 * Room geometry — turns a LiDAR scan (Apple RoomPlan, meters) or a manual
 * L x W entry into a 2D floor outline in feet plus the quantities an
 * adjuster writes from: floor/ceiling SF, wall SF, perimeter, openings.
 *
 * Coordinates: 2D plan, x = right, y = down (screen-style), units = feet.
 */

const M_TO_FT = 3.28084;

const round = (n, d = 2) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const isPt = p => Array.isArray(p) && p.length >= 2 && p.every(v => Number.isFinite(Number(v)));
const toPt = (p, k = 1) => [Number(p[0]) * k, Number(p[1]) * k];

function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

function polygonPerimeter(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length]);
  return s;
}

/**
 * Chain loose wall segments into an ordered outline. RoomPlan walls meet at
 * corners but arrive unordered and with small gaps, so we walk from wall to
 * wall by nearest endpoint and average each junction into one corner.
 */
function chainWalls(walls) {
  if (walls.length < 3) return null;
  const segs = walls.map(w => ({ a: w.a, b: w.b }));
  const used = new Array(segs.length).fill(false);
  const order = [{ a: segs[0].a, b: segs[0].b }];
  used[0] = true;
  for (let step = 1; step < segs.length; step++) {
    const tail = order[order.length - 1].b;
    let best = -1, bestD = Infinity, flip = false;
    segs.forEach((s, i) => {
      if (used[i]) return;
      const da = dist(tail, s.a), db = dist(tail, s.b);
      if (da < bestD) { bestD = da; best = i; flip = false; }
      if (db < bestD) { bestD = db; best = i; flip = true; }
    });
    if (best < 0 || bestD > 3) break; // > 3 ft gap: not part of this loop
    used[best] = true;
    const s = segs[best];
    order.push(flip ? { a: s.b, b: s.a } : { a: s.a, b: s.b });
  }
  if (order.length < 3) return null;
  // Corner i = junction between wall i-1 (end) and wall i (start)
  return order.map((w, i) => {
    const prev = order[(i - 1 + order.length) % order.length];
    return [(prev.b[0] + w.a[0]) / 2, (prev.b[1] + w.a[1]) / 2];
  });
}

/** Rotate/translate the plan so the longest wall is horizontal and the bbox starts at 0,0. */
function normalize(poly, extras) {
  let ang = 0, longest = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = dist(a, b);
    if (L > longest) { longest = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const rot = p => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  let pts = poly.map(rot);
  const minX = Math.min(...pts.map(p => p[0])), minY = Math.min(...pts.map(p => p[1]));
  const tr = p => { const r = rot(p); return [round(r[0] - minX, 3), round(r[1] - minY, 3)]; };
  pts = poly.map(tr);
  const rotDeg = -ang * 180 / Math.PI;
  return {
    polygon: pts,
    openings: extras.openings.map(o => ({ ...o, a: tr(o.a), b: tr(o.b) })),
    objects: extras.objects.map(o => ({ ...o, center: tr(o.center), rotationDeg: round((o.rotationDeg || 0) + rotDeg, 1) })),
  };
}

/**
 * Build a room from a RoomPlan upload (meters). Expected shape:
 * {
 *   walls:    [{ start:[x,z], end:[x,z], height }],
 *   doors|windows|openings: [{ start:[x,z], end:[x,z], height, bottom? }],
 *   objects:  [{ category, width, depth, height, center:[x,z], yawDeg }],
 *   floorPolygon?: [[x,z], ...]   // iOS 17+ floor outline, preferred
 * }
 */
function roomFromScan(scan) {
  const k = scan.units === 'ft' ? 1 : M_TO_FT;
  const walls = (scan.walls || [])
    .filter(w => isPt(w.start) && isPt(w.end))
    .map(w => ({ a: toPt(w.start, k), b: toPt(w.end, k), h: Number(w.height) * k || 0 }))
    .filter(w => dist(w.a, w.b) > 0.25);

  const openingsIn = [];
  for (const type of ['door', 'window', 'opening']) {
    for (const o of scan[type + 's'] || []) {
      if (!isPt(o.start) || !isPt(o.end)) continue;
      openingsIn.push({
        type,
        a: toPt(o.start, k),
        b: toPt(o.end, k),
        heightFt: round(Number(o.height) * k, 2),
        bottomFt: round(Number(o.bottom || 0) * k, 2),
      });
    }
  }
  const objectsIn = (scan.objects || []).filter(o => isPt(o.center)).map(o => ({
    category: String(o.category || 'object').slice(0, 40),
    widthFt: round(Number(o.width) * k, 2),
    depthFt: round(Number(o.depth) * k, 2),
    heightFt: round(Number(o.height) * k, 2),
    center: toPt(o.center, k),
    rotationDeg: Number(o.yawDeg) || 0,
  }));

  // Walls are LiDAR-measured planes, so the outline built from them is the
  // most accurate. Fall back to RoomPlan's floor polygon (iOS 17+) only when
  // the walls don't close into one loop (open plans, missed walls).
  let outline = chainWalls(walls);
  const floorPoly = Array.isArray(scan.floorPolygon) ? scan.floorPolygon.filter(isPt) : [];
  if ((!outline || outline.length < Math.ceil(walls.length * 0.75)) && floorPoly.length >= 3) {
    outline = floorPoly.map(p => toPt(p, k));
  }
  if (!outline) throw new Error('Scan needs at least 3 connected walls');

  const heights = walls.map(w => w.h).filter(h => h > 0);
  const ceilingHeightFt = heights.length
    ? heights.sort((a, b) => a - b)[Math.floor(heights.length / 2)] // median
    : 8;

  const n = normalize(outline, { openings: openingsIn, objects: objectsIn });
  return {
    source: 'lidar',
    polygon: n.polygon,
    ceilingHeightFt: round(ceilingHeightFt, 2),
    openings: n.openings.map(o => ({ ...o, widthFt: round(dist(o.a, o.b), 2) })),
    objects: n.objects.map(o => ({ ...o, center: o.center })),
  };
}

/** Rectangle from a tape measure / laser: length (x) by width (y). */
function roomFromDimensions({ lengthFt, widthFt, ceilingHeightFt }) {
  const L = Number(lengthFt), W = Number(widthFt);
  if (!(L > 0 && W > 0)) throw new Error('Length and width must be greater than 0');
  return {
    source: 'manual',
    polygon: [[0, 0], [L, 0], [L, W], [0, W]],
    ceilingHeightFt: round(Number(ceilingHeightFt) || 8, 2),
    openings: [],
    objects: [],
  };
}

/**
 * Room drawn wall-by-wall in the browser sketch tool: outline points in feet.
 * A last point that lands back on the start (within 1 ft) closes the loop.
 */
function roomFromPolygon({ polygonFt, ceilingHeightFt }) {
  let pts = (Array.isArray(polygonFt) ? polygonFt : []).filter(isPt).map(p => toPt(p));
  if (pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 1) pts = pts.slice(0, -1);
  if (pts.length < 3) throw new Error('Sketch needs at least 3 walls');
  if (pts.length > 60) throw new Error('Sketch has too many walls');
  if (polygonArea(pts) < 4) throw new Error('Sketch area is too small — check the wall lengths');
  const n = normalize(pts, { openings: [], objects: [] });
  return {
    source: 'sketch',
    polygon: n.polygon,
    ceilingHeightFt: round(Number(ceilingHeightFt) || 8, 2),
    openings: [],
    objects: [],
  };
}

/**
 * Quantities in the terms used on an estimate. Walls are measured along the
 * floor outline at the room's ceiling height; doors/windows/openings come
 * off the wall SF, and door widths come off the baseboard run.
 */
function computeMetrics(room) {
  const poly = room.polygon || [];
  const h = Number(room.ceilingHeightFt) || 8;
  const floorSF = polygonArea(poly);
  const perimeterLF = polygonPerimeter(poly);
  const openings = room.openings || [];
  const openingSF = openings.reduce((s, o) => s + (o.widthFt || 0) * Math.min(o.heightFt || 0, h), 0);
  const doorLF = openings.filter(o => o.type !== 'window').reduce((s, o) => s + (o.widthFt || 0), 0);
  const wallSFGross = perimeterLF * h;
  const wallSF = Math.max(0, wallSFGross - openingSF);
  return {
    floorSF: round(floorSF, 1),
    floorSY: round(floorSF / 9, 2),
    ceilingSF: round(floorSF, 1),
    wallSFGross: round(wallSFGross, 1),
    openingSF: round(openingSF, 1),
    wallSF: round(wallSF, 1),
    wallsAndCeilingSF: round(wallSF + floorSF, 1),
    perimeterLF: round(perimeterLF, 1),
    baseboardLF: round(Math.max(0, perimeterLF - doorLF), 1),
    ceilingHeightFt: round(h, 2),
    walls: poly.map((p, i) => round(dist(p, poly[(i + 1) % poly.length]), 2)),
    doors: openings.filter(o => o.type === 'door').length,
    windows: openings.filter(o => o.type === 'window').length,
  };
}

module.exports = { roomFromScan, roomFromDimensions, roomFromPolygon, computeMetrics, chainWalls, polygonArea, M_TO_FT };
