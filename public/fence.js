/* RoofTrace Pro — Fence draw mode.
   Loaded after tool.html's main script (uses map, modeStyles, setMode, fmt,
   undoStack, attachLineEvents, refreshStats, currentMode).

   Draw: tap along the fence line; every tap adds a post point and the run
   keeps going. Tap the last point again (or Finish) to end the run, or tap
   the first point to close a loop around the yard.
   Gates: tap 🚪 Gate, then tap on a fence line.
   Totals: fence LF (gate openings taken out), gates, terminal / line / gate
   posts, and fence SF one side (height × LF) for stain or paint. */

const FENCE_COLOR = '#ec4899';
const fenceLayer = new L.FeatureGroup().addTo(map);      // finished runs (polylines)
const fenceGateLayer = new L.FeatureGroup().addTo(map);  // gate markers
const fenceLabelLayer = new L.FeatureGroup().addTo(map); // segment length labels + gate openings

const FENCE_TYPES = ['Wood privacy', 'Wood picket', 'Board-on-board', 'Chain link', 'Ornamental iron', 'Vinyl', 'Split rail'];
const fenceDefaults = { type: 'Wood privacy', height: 6, spacing: 8, gateWidth: 4 };
const fenceCfg = (() => {
  try { return { ...fenceDefaults, ...JSON.parse(localStorage.getItem('rtFence') || '{}') }; } catch { return { ...fenceDefaults }; }
})();
const saveFenceCfg = () => { try { localStorage.setItem('rtFence', JSON.stringify(fenceCfg)); } catch {} };

let fenceDraft = [];        // points of the run being drawn
let fenceDraftLine = null;  // its polyline
let fenceDraftDots = null;  // its post dots
let fenceGateArmed = false;

modeStyles.fence = { poly: false, color: FENCE_COLOR, weight: 4 };
const _fenceHint = 'Tap along the fence. Tap the last point again to finish a run, or the first point to close it.';

/* ── Geometry ── */

const feetBetween = (a, b) => map.distance(a, b) * 3.28084;

function runLengthFt(pts, closed) {
  let t = 0;
  for (let i = 0; i < pts.length - 1; i++) t += feetBetween(pts[i], pts[i + 1]);
  if (closed && pts.length > 2) t += feetBetween(pts[pts.length - 1], pts[0]);
  return t;
}

function bearing(a, b) {
  const p = map.options.crs.project(a), q = map.options.crs.project(b);
  return Math.atan2(q.x - p.x, q.y - p.y) * 180 / Math.PI;
}

function turnAt(prev, cur, next) {
  const d = Math.abs(((bearing(cur, next) - bearing(prev, cur)) + 540) % 360 - 180);
  return d;
}

/** Terminal posts (ends + corners ≥ 15°) and the straight stretches between them. */
function runStructure(pts, closed) {
  const n = pts.length;
  if (n < 2) return { terminals: [], stretches: [] };
  const isCorner = i => {
    if (!closed && (i === 0 || i === n - 1)) return true;
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n];
    return turnAt(prev, pts[i], next) >= 15;
  };
  let term = [];
  for (let i = 0; i < n; i++) if (isCorner(i)) term.push(i);
  if (closed && !term.length) term = [0]; // a perfectly straight loop can't exist, but stay safe
  const stretches = [];
  const segs = closed ? n : n - 1;
  // walk segments, splitting at terminals
  let cur = { len: 0, segIdx: [] };
  const start = closed ? term[0] : 0;
  for (let k = 0; k < segs; k++) {
    const i = (start + k) % n, j = (i + 1) % n;
    cur.len += feetBetween(pts[i], pts[j]);
    cur.segIdx.push(i);
    if (term.includes(j)) { stretches.push(cur); cur = { len: 0, segIdx: [] }; }
  }
  if (cur.segIdx.length) stretches.push(cur);
  return { terminals: term.map(i => pts[i]), stretches };
}

/* ── Totals ── */

function allRuns() {
  const runs = fenceLayer.getLayers().map(l => ({ pts: runPts(l), closed: !!l._fenceClosed, layer: l }));
  if (fenceDraft.length >= 2) runs.push({ pts: fenceDraft, closed: false, draft: true });
  return runs;
}

function fenceTotals() {
  const runs = allRuns();
  const gates = fenceGateLayer.getLayers().map(m => ({ width: m._gateWidth, run: m._gateRun, seg: m._gateSeg }));
  let grossFt = 0, linePosts = 0;
  const terminals = [];
  runs.forEach((r, ri) => {
    grossFt += runLengthFt(r.pts, r.closed);
    const s = runStructure(r.pts, r.closed);
    s.terminals.forEach(t => terminals.push(t));
    s.stretches.forEach(st => {
      const onStretch = gates.filter(g => g.run === r.layer && st.segIdx.includes(g.seg));
      const net = Math.max(0, st.len - onStretch.reduce((a, g) => a + g.width, 0));
      const pieces = onStretch.length + 1;
      linePosts += Math.max(0, Math.ceil(net / fenceCfg.spacing - 0.02) - pieces); // tolerance: 96.01 ft at 8 ft spacing is 12 bays, not 13
    });
  });
  // a run that starts or ends on another run shares that post
  const uniq = [];
  terminals.forEach(t => { if (!uniq.some(u => map.distance(u, t) < 0.5)) uniq.push(t); });
  const gateFt = gates.reduce((a, g) => a + g.width, 0);
  const netFt = Math.max(0, grossFt - gateFt);
  return {
    runs: runs.length,
    grossFt, gateFt, netFt,
    gates: gates.length,
    gateList: gates.map(g => g.width),
    terminalPosts: uniq.length,
    gatePosts: gates.length * 2,
    linePosts,
    totalPosts: uniq.length + gates.length * 2 + linePosts,
    sf: netFt * fenceCfg.height,
    type: fenceCfg.type, height: fenceCfg.height, spacing: fenceCfg.spacing,
  };
}

/* ── Drawing ── */

function fenceSnap(latlng) {
  const px = map.latLngToContainerPoint(latlng);
  let best = null, bestD = 28;
  const consider = ll => { const d = px.distanceTo(map.latLngToContainerPoint(ll)); if (d < bestD) { bestD = d; best = ll; } };
  fenceLayer.getLayers().forEach(l => runPts(l).forEach(consider));
  fenceDraft.forEach(consider);
  return best || latlng;
}

function drawDraft() {
  if (fenceDraftLine) { map.removeLayer(fenceDraftLine); fenceDraftLine = null; }
  if (fenceDraftDots) { map.removeLayer(fenceDraftDots); fenceDraftDots = null; }
  if (!fenceDraft.length) return;
  fenceDraftLine = L.polyline(fenceDraft, { color: FENCE_COLOR, weight: 4, dashArray: '8,6', opacity: 0.95, interactive: false }).addTo(map);
  fenceDraftDots = L.layerGroup(fenceDraft.map((p, i) => L.circleMarker(p, {
    radius: i === 0 || i === fenceDraft.length - 1 ? 7 : 5,
    color: '#fff', weight: 2, fillColor: i === 0 ? '#16a34a' : FENCE_COLOR, fillOpacity: 1,
  }))).addTo(map);
}

const runPts = l => (l._fenceClosed ? l.getLatLngs()[0] : l.getLatLngs());

function finishRun(closed = false) {
  if (fenceDraft.length >= 2) {
    const opts = { color: FENCE_COLOR, weight: 4, opacity: 0.95 };
    const line = closed ? L.polygon(fenceDraft.slice(), { ...opts, fill: false }) : L.polyline(fenceDraft.slice(), opts);
    line._fenceClosed = closed;
    fenceLayer.addLayer(line);
    attachLineEvents(line, fenceLayer);
    line.on('mouseout', () => line.setStyle({ weight: 4, opacity: 0.95 }));
    line.on('remove', () => { removeGatesOn(line); setTimeout(refreshFence, 0); });
    undoStack.push({ layer: line, group: fenceLayer });
  }
  fenceDraft = [];
  drawDraft();
  refreshFence();
}

function resetFence() {
  fenceDraft = []; drawDraft(); setGateArmed(false); refreshFence();
}

function removeGatesOn(runLayer) {
  fenceGateLayer.getLayers().forEach(m => { if (m._gateRun === runLayer) fenceGateLayer.removeLayer(m); });
}

function onFenceTap(e) {
  if (fenceGateArmed) return placeGate(e.latlng);
  const p = fenceSnap(e.latlng);
  const n = fenceDraft.length;
  if (n >= 2 && p === fenceDraft[n - 1]) return finishRun(false);            // tap last point = done
  if (n >= 3 && p === fenceDraft[0]) return finishRun(true);                 // tap first point = close loop
  if (n && map.distance(p, fenceDraft[n - 1]) < 0.15) return;               // double tap on same spot
  fenceDraft.push(p);
  drawDraft();
  refreshFence();
}

/* ── Gates ── */

function nearestSegment(latlng) {
  const px = map.latLngToContainerPoint(latlng);
  let best = null;
  fenceLayer.getLayers().forEach(l => {
    const pts = runPts(l);
    const n = pts.length, segs = l._fenceClosed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = map.latLngToContainerPoint(pts[i]), b = map.latLngToContainerPoint(pts[(i + 1) % n]);
      const ab = b.subtract(a), len2 = ab.x * ab.x + ab.y * ab.y || 1;
      const t = Math.max(0, Math.min(1, ((px.x - a.x) * ab.x + (px.y - a.y) * ab.y) / len2));
      const q = L.point(a.x + ab.x * t, a.y + ab.y * t);
      const d = q.distanceTo(px);
      if (!best || d < best.d) best = { d, layer: l, seg: i, at: map.containerPointToLatLng(q), angle: Math.atan2(ab.y, ab.x) * 180 / Math.PI };
    }
  });
  return best && best.d < 40 ? best : null;
}

function gateIcon(width) {
  return L.divIcon({ className: 'fence-gate', html: `<div class="fg-tag">&#128682; ${width}'</div>`, iconSize: [0, 0] });
}

function placeGate(latlng) {
  const hit = nearestSegment(latlng);
  if (!hit) { fenceToast('Tap right on a fence line to add the gate'); return; }
  const w = fenceCfg.gateWidth;
  const m = L.marker(hit.at, { icon: gateIcon(w), keyboard: false });
  m._gateWidth = w; m._gateRun = hit.layer; m._gateSeg = hit.seg;
  m.on('click', ev => {
    L.DomEvent.stopPropagation(ev);
    if (confirm(`Remove this ${m._gateWidth}' gate?`)) { fenceGateLayer.removeLayer(m); refreshFence(); }
  });
  fenceGateLayer.addLayer(m);
  undoStack.push({ layer: m, group: fenceGateLayer });
  setGateArmed(false);
  refreshFence();
}

function setGateArmed(on) {
  fenceGateArmed = on;
  if (on && fenceDraft.length >= 2) finishRun(false);
  const b = document.getElementById('fpGate');
  if (b) { b.classList.toggle('on', on); b.innerHTML = on ? 'Tap the fence&hellip;' : `&#128682; Gate ${fenceCfg.gateWidth}'`; }
  updateFenceHint();
}

/* ── Labels, panel, stats ── */

function refreshFence() {
  fenceLabelLayer.clearLayers();
  const gates = fenceGateLayer.getLayers();
  // gate openings: a yellow gap of the gate's real width, centered where it was tapped
  gates.forEach(m => {
    const pts = runPts(m._gateRun), n = pts.length;
    const a = pts[m._gateSeg], b = pts[(m._gateSeg + 1) % n];
    if (!a || !b) return;
    const segFt = feetBetween(a, b) || 1, k = Math.min(0.5, (m._gateWidth / 2) / segFt);
    const c = m.getLatLng(), dLat = (b.lat - a.lat) * k, dLng = (b.lng - a.lng) * k;
    fenceLabelLayer.addLayer(L.polyline([[c.lat - dLat, c.lng - dLng], [c.lat + dLat, c.lng + dLng]],
      { color: '#facc15', weight: 7, opacity: 1, interactive: false }));
  });
  allRuns().forEach(r => {
    const n = r.pts.length, segs = r.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = r.pts[i], b = r.pts[(i + 1) % n];
      const ft = feetBetween(a, b);
      if (ft < 2) continue;
      // keep the length label clear of a gate on this side
      const g = r.layer && gates.find(m => m._gateRun === r.layer && m._gateSeg === i);
      let f = 0.5;
      if (g) { const gf = map.distance(a, g.getLatLng()) / (map.distance(a, b) || 1); f = gf > 0.5 ? gf / 2 : (1 + gf) / 2; }
      const at = L.latLng(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f);
      fenceLabelLayer.addLayer(L.marker(at, {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'fence-len', html: `<span>${Math.round(ft)}'</span>`, iconSize: [0, 0] }),
      }));
    }
  });
  const t = fenceTotals();
  const stat = document.getElementById('statFence');
  if (stat) stat.textContent = t.netFt ? fmt(t.netFt, 0) + ' ft' : '— ft';
  const sum = document.getElementById('fpSum');
  if (sum) sum.innerHTML = t.grossFt
    ? `<b>${fmt(t.netFt, 0)} LF</b> &middot; ${t.gates} gate${t.gates === 1 ? '' : 's'} &middot; ${t.totalPosts} posts`
    : `${esc2(fenceCfg.type)} &middot; ${fenceCfg.height}' tall`;
  updateFenceHint();
}

function updateFenceHint() {
  const hint = document.getElementById('fpHint');
  if (!hint) return;
  const n = fenceDraft.length;
  hint.textContent = fenceGateArmed ? 'Tap on a fence line to place the gate.'
    : !n ? 'Tap where the fence starts.'
    : n === 1 ? 'Tap the next corner or post.'
    : 'Keep tapping. Tap the last point again to finish, or the first point to close the loop.';
  const fin = document.getElementById('fpFinish');
  if (fin) fin.disabled = n < 2;
}

const esc2 = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fenceToast(msg) {
  const t = document.createElement('div');
  t.className = 'fence-toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2400);
}

function buildFencePanel() {
  if (document.getElementById('fencePanel')) return;
  const el = document.createElement('div');
  el.id = 'fencePanel';
  el.innerHTML = `
    <div class="fp-top"><span class="fp-title">&#9638; Fence</span><span id="fpSum"></span>
      <button class="fp-x" title="Fence settings" onclick="fenceSettings()">&#9881;</button></div>
    <div id="fpHint" class="fp-hint"></div>
    <div class="fp-btns">
      <button id="fpFinish" onclick="finishRun(false)">&#10003; Finish run</button>
      <button id="fpGate" onclick="setGateArmed(!fenceGateArmed)">&#128682; Gate ${fenceCfg.gateWidth}'</button>
      <button onclick="showFenceSummary()">&#128203; Totals</button>
    </div>`;
  L.DomEvent.disableClickPropagation(el);
  document.body.appendChild(el);
}

function fenceSettings() {
  const bg = document.createElement('div');
  bg.className = 'fence-modal-bg';
  bg.innerHTML = `<div class="fence-modal">
    <h3>Fence settings</h3>
    <label>Fence type<select id="fsType">${FENCE_TYPES.map(t => `<option ${t === fenceCfg.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <div class="fs-row">
      <label>Height (ft)<select id="fsHeight">${[3, 4, 5, 6, 7, 8].map(h => `<option ${h === fenceCfg.height ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
      <label>Post spacing (ft)<select id="fsSpacing">${[6, 8, 10].map(h => `<option ${h === fenceCfg.spacing ? 'selected' : ''}>${h}</option>`).join('')}</select></label>
    </div>
    <label>Gate width for the next gate
      <select id="fsGate">${[[3, "3' walk"], [4, "4' walk"], [5, "5' walk"], [6, "6' wide"], [8, "8' double"], [10, "10' double drive"], [12, "12' double drive"], [16, "16' RV"]].map(([v, l]) => `<option value="${v}" ${v === fenceCfg.gateWidth ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="fs-btns"><button onclick="this.closest('.fence-modal-bg').remove()">Cancel</button>
      <button class="primary" id="fsSave">Save</button></div></div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  bg.querySelector('#fsSave').onclick = () => {
    fenceCfg.type = bg.querySelector('#fsType').value;
    fenceCfg.height = Number(bg.querySelector('#fsHeight').value);
    fenceCfg.spacing = Number(bg.querySelector('#fsSpacing').value);
    fenceCfg.gateWidth = Number(bg.querySelector('#fsGate').value);
    saveFenceCfg();
    bg.remove();
    setGateArmed(fenceGateArmed);
    refreshFence();
  };
}

function fenceRowsHTML(t) {
  const row = (l, v) => `<tr><td>${l}</td><td>${v}</td></tr>`;
  const gatesTxt = t.gates ? t.gateList.reduce((m, w) => (m[w] = (m[w] || 0) + 1, m), {}) : null;
  return [
    row('Fence type', `${esc2(t.type)}, ${t.height}' tall`),
    row('Fence (less gates)', `${fmt(t.netFt, 0)} LF`),
    row('Total run incl. gates', `${fmt(t.grossFt, 0)} LF`),
    row('Gates', t.gates ? Object.entries(gatesTxt).map(([w, c]) => `${c} &times; ${w}'`).join(', ') : '0'),
    row('Terminal posts (ends &amp; corners)', t.terminalPosts),
    row('Gate posts', t.gatePosts),
    row(`Line posts (${t.spacing}' on center)`, t.linePosts),
    row('<b>Total posts</b>', `<b>${t.totalPosts}</b>`),
    row(`Fence area, one side (${t.height}' &times; LF)`, `${fmt(t.sf, 0)} SF`),
    row('Fence area, both sides', `${fmt(t.sf * 2, 0)} SF`),
  ].join('');
}

function showFenceSummary() {
  if (fenceDraft.length >= 2) finishRun(false);
  const t = fenceTotals();
  const bg = document.createElement('div');
  bg.className = 'fence-modal-bg';
  bg.innerHTML = `<div class="fence-modal"><h3>Fence Totals</h3>
    ${t.grossFt ? `<table class="fence-table">${fenceRowsHTML(t)}</table>
      <p class="fence-note">Posts assume ${t.spacing}' spacing with a terminal post at every end and corner, and 2 posts per gate. Runs that meet share a post.</p>`
    : '<p class="fence-note">No fence drawn yet. Tap along the fence line on the map.</p>'}
    <div class="fs-btns"><button class="primary" onclick="this.closest('.fence-modal-bg').remove()">Close</button></div></div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
}

/* ── Hook into the roof tool ── */

const _setModeRoof = setMode;
setMode = function (mode) {
  if (currentMode === 'fence' && mode !== 'fence') {
    finishRun(false);
    setGateArmed(false);
    document.getElementById('fencePanel')?.classList.remove('show');
    map.doubleClickZoom.enable();
  }
  _setModeRoof(mode);
  const mtb = document.getElementById('mtb-fence');
  if (mtb) { mtb.style.background = mode === 'fence' ? FENCE_COLOR : 'transparent'; mtb.style.color = mode === 'fence' ? '#fff' : FENCE_COLOR; }
  if (mode === 'fence') {
    map.doubleClickZoom.disable(); // fast taps add posts instead of zooming
    buildFencePanel();
    document.getElementById('fencePanel').classList.add('show');
    document.getElementById('modeHint').textContent = _fenceHint;
    refreshFence();
  }
};
window.setMode = setMode;

map.on('click', e => {
  if (currentMode !== 'fence') return;
  if (e.originalEvent?.target?.closest?.('.leaflet-control, #fencePanel')) return;
  onFenceTap(e);
});

const _refreshRoof = refreshStats;
refreshStats = function () { _refreshRoof(); refreshFence(); };

const _undoRoof = window.undoLast;
window.undoLast = function () {
  if (currentMode === 'fence' && fenceGateArmed) return setGateArmed(false);
  if (currentMode === 'fence' && fenceDraft.length) { fenceDraft.pop(); drawDraft(); refreshFence(); return; }
  _undoRoof();
  refreshFence();
};
document.addEventListener('keydown', e => {
  if (currentMode === 'fence' && (e.ctrlKey || e.metaKey) && e.key === 'z' && fenceDraft.length) {
    e.stopImmediatePropagation(); e.preventDefault(); fenceDraft.pop(); drawDraft(); refreshFence();
  }
  if (currentMode === 'fence' && e.key === 'Enter') finishRun(false);
}, true);

Object.assign(window, { resetFence, finishRun, setGateArmed, fenceSettings, showFenceSummary, fenceTotals, fenceRowsHTML });
