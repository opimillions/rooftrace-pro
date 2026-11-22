/* RoofTrace Pro — Interior: app install guide + wall-by-wall room sketch.
   Loaded by interior.html after its main script (uses api, esc, go, toast,
   openModal, floorSelect, ftIn, n1, manualRoomModal, current, render). */

/* ═════════════════ Install guide for the RoofTrace Scan iPhone app ═════════════════ */

const TESTFLIGHT_APP = 'https://apps.apple.com/us/app/testflight/id899247664';
let installConfig = null;
const appInstalled = () => { try { return localStorage.getItem('rtsInstalled') === '1'; } catch { return false; } };
const markInstalled = v => { try { v ? localStorage.setItem('rtsInstalled', '1') : localStorage.removeItem('rtsInstalled'); } catch {} };

function scanLink(property) {
  return `rooftracescan://scan?property=${encodeURIComponent(property._id)}&address=${encodeURIComponent(property.address)}&server=${encodeURIComponent(location.origin)}`;
}

async function scanModal(property) {
  if (!installConfig) installConfig = await api('/config').catch(() => ({}));
  if (appInstalled()) return openAppModal(property);
  installGuide(property, 0);
}

function openAppModal(property) {
  const bg = openModal(`<h2>&#128241; Scan with LiDAR</h2>
    <p class="note" style="margin-bottom:14px">Opens <b>RoofTrace Scan</b>. Walk the room slowly with the camera on the walls, tap <b>Done</b>, then <b>Save Room</b> — it lands here automatically.</p>
    <a class="btn green" style="display:block" href="${scanLink(property)}">Open RoofTrace Scan</a>
    <div class="btns">
      <button type="button" class="btn gray" id="guideAgain">Install guide</button>
      <button type="button" class="btn gray" data-close>Close</button>
    </div>`, async () => {});
  bg.querySelector('#guideAgain').onclick = () => { bg.remove(); markInstalled(false); installGuide(property, 0); };
}

function installGuide(property, step) {
  const cfg = installConfig || {};
  const onStore = !!cfg.appStoreUrl;
  const steps = [
    {
      t: 'Check your phone',
      b: `<p>Room scanning uses the <b>LiDAR scanner</b>, which is on these devices:</p>
          <ul class="guide-list"><li>iPhone 12 Pro / Pro Max or any newer <b>Pro</b> model</li><li>iPad Pro (2020 or newer)</li></ul>
          <p>Look at the camera bump: the LiDAR scanner is the small <b>black dot</b> next to the lenses.</p>
          <p class="note">No LiDAR? You can still measure every room with <b>Sketch Room</b> — no download needed.</p>`,
      extra: `<button type="button" class="btn gray" data-sketch>&#9999;&#65039; Use Sketch Room instead</button>`,
    },
    ...(onStore ? [{
      t: 'Get RoofTrace Scan',
      b: `<p>Download <b>RoofTrace Scan</b> from the App Store. It's free with your RoofTrace Pro account.</p>`,
      extra: `<a class="btn" href="${esc(cfg.appStoreUrl)}" target="_blank" rel="noopener">Open the App Store</a>`,
    }] : [{
      t: 'Install TestFlight',
      b: `<p><b>TestFlight</b> is Apple's free app for installing apps before they're in the App Store.</p>
          <p>Tap below, then tap <b>Get</b> in the App Store. Come back here when it's installed.</p>`,
      extra: `<a class="btn" href="${TESTFLIGHT_APP}" target="_blank" rel="noopener">Get TestFlight (free)</a>`,
    }, {
      t: 'Join RoofTrace Scan',
      b: cfg.testflightUrl
        ? `<p>Tap below to open your invite, then tap <b>Accept</b> in TestFlight.</p>`
        : `<p>The invite link isn't ready yet. Call <a href="tel:+18176189884">(817) 618-9884</a> and we'll text it to you.</p>`,
      extra: cfg.testflightUrl ? `<a class="btn" href="${esc(cfg.testflightUrl)}" target="_blank" rel="noopener">Open my invite</a>` : '',
    }]),
    {
      t: 'Install and open',
      b: `<p>${onStore ? 'When the download finishes' : 'In TestFlight, tap <b>Install</b>. When it finishes'}, tap <b>Open</b>.</p>
          <p>When it asks for the camera, tap <b>Allow</b> — that's how it measures the room.</p>`,
    },
    {
      t: 'Sign in and scan',
      b: `<p>Sign in with the <b>same email and password</b> you use for RoofTrace Pro.</p>
          <p>From now on, tap <b>Scan Room (LiDAR)</b> on any property and the app opens straight to it. Scans show up here when you tap <b>Save Room</b>.</p>`,
      extra: `<a class="btn green" data-done href="${scanLink(property)}">I'm signed in — open the scanner</a>`,
    },
  ];
  const s = steps[step];
  const last = step === steps.length - 1;
  const bg = openModal(`
    <div class="guide-top"><span>Set up the LiDAR scanner</span><span>Step ${step + 1} of ${steps.length}</span></div>
    <div class="guide-dots">${steps.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
    <h2><span class="guide-num">${step + 1}</span>${s.t}</h2>
    <div class="guide-body">${s.b}</div>
    ${s.extra ? `<div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">${s.extra}</div>` : ''}
    <div class="btns">
      ${step > 0 ? '<button type="button" class="btn gray" data-back>&#8249; Back</button>' : '<button type="button" class="btn gray" data-close>Close</button>'}
      ${last ? '' : '<button type="button" class="btn" data-next>Next &#8250;</button>'}
    </div>`, async () => {});
  const q = sel => bg.querySelector(sel);
  if (q('[data-next]')) q('[data-next]').onclick = () => { bg.remove(); installGuide(property, step + 1); };
  if (q('[data-back]')) q('[data-back]').onclick = () => { bg.remove(); installGuide(property, step - 1); };
  if (q('[data-sketch]')) q('[data-sketch]').onclick = () => { bg.remove(); go(`#/p/${property._id}/sketch`); };
  if (q('[data-done]')) q('[data-done]').addEventListener('click', () => { markInstalled(true); setTimeout(() => bg.remove(), 300); });
}

/* ═════════════════ Wall-by-wall room sketch ═════════════════
   Two ways to draw a room, both walking it clockwise (always move to the
   wall on your right):

   • Turn buttons — enter each wall's length and say which way you turned.
   • Touch the wall (RoomScan-style) — walk the room pressing the phone flat
     on each wall; it beeps and moves on by itself. Touch wall 1 again at the
     end to cancel sensor drift. Then enter lengths (or say them): any two
     walls can be left blank and are calculated so the room closes. */

const sk = {
  property: null, name: '', floor: '', ceiling: 8,
  mode: 'turns',            // 'turns' | 'touch'
  walls: [],                // turns: { len, heading }  touch: { raw, heading, len|null }
  turn: 90,                 // next turn in turns mode (right = +90)
  phase: 'walk',            // touch: 'walk' → 'check' → 'measure'
  listening: false,         // touch: sensors armed
  drift: 0,                 // touch: degrees of drift found by re-touching wall 1
};

const rad = d => d * Math.PI / 180;
const norm360 = d => ((d % 360) + 360) % 360;
const signed = d => ((d + 540) % 360) - 180;
const angDiff = (a, b) => Math.abs(signed(a - b));

// In touch mode the sensor's zero is arbitrary, so turn the drawing until the first wall runs left → right.
const viewOffset = () => (sk.mode === 'touch' && sk.walls.length ? sk.walls[0].heading - 90 : 0);
const dispH = h => (h == null ? null : h - viewOffset());
const unitVec = h => { const r = rad(dispH(h)); return [Math.sin(r), -Math.cos(r)]; };

function sketchPoints(lens = sk.walls.map(w => w.len)) {
  const pts = [[0, 0]];
  sk.walls.forEach((w, i) => {
    const p = pts[pts.length - 1], v = unitVec(w.heading);
    pts.push([p[0] + lens[i] * v[0], p[1] + lens[i] * v[1]]);
  });
  return pts;
}

function nextHeading() {
  if (sk.mode === 'touch') return null;
  if (!sk.walls.length) return 90; // first wall runs left → right on the plan
  return norm360(sk.walls[sk.walls.length - 1].heading + sk.turn);
}

/* lens: lengths to draw. calc: indexes of calculated walls. guess: lengths are placeholders. */
function sketchSVG(lens = sk.walls.map(w => w.len), { calc = [], guess = false } = {}) {
  const pts = sketchPoints(lens);
  const W = 600, pad = 56;
  const h = dispH(nextHeading());
  const tail = pts[pts.length - 1];
  const ref = Math.max(6, ...lens.filter(Boolean)) * 0.35;
  const ghost = h == null ? tail : [tail[0] + ref * Math.sin(rad(h)), tail[1] - ref * Math.cos(rad(h))];
  const all = pts.concat([ghost]);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, (maxY - minY) * 0.85, 8);
  const sc = (W - pad * 2) / span;
  const H = Math.max(240, Math.round((maxY - minY) * sc + pad * 2));
  const ox = (W - (maxX - minX) * sc) / 2;
  const P = p => [ox + (p[0] - minX) * sc, pad + (p[1] - minY) * sc];
  const S = pts.map(P);
  let out = '';
  if (pts.length >= 3) {
    out += `<polygon points="${S.map(p => p.join(',')).join(' ')}" fill="${guess ? '#eef2f7' : '#f7f2e1'}" stroke="none"/>`;
    const a = S[S.length - 1], b = S[0];
    const gap = Math.hypot(pts[0][0] - tail[0], pts[0][1] - tail[1]);
    if (gap > 0.5 && !guess) {
      out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#94a3b8" stroke-width="3" stroke-dasharray="8 6"/>`;
      out += label((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ftIn(gap), '#64748b');
    }
  }
  sk.walls.forEach((w, i) => {
    const a = S[i], b = S[i + 1];
    const isCalc = calc.includes(i);
    out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${isCalc ? '#7c3aed' : '#0f172a'}" stroke-width="7" stroke-linecap="square"${guess && !w.len ? ' stroke-dasharray="10 6"' : ''}/>`;
  });
  sk.walls.forEach((w, i) => {
    const a = S[i], b = S[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    // labels outside a clockwise outline = to the left of travel
    const txt = guess && !w.len ? `${i + 1}` : `${i + 1}: ${ftIn(lens[i])}`;
    out += label((a[0] + b[0]) / 2 + (dy / L) * 20, (a[1] + b[1]) / 2 - (dx / L) * 20, txt, calc.includes(i) ? '#7c3aed' : '#334155');
  });
  if (h != null) {
    const g = P(ghost), t = P(tail);
    out += `<defs><marker id="arw" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#2563eb"/></marker></defs>
      <line x1="${t[0]}" y1="${t[1]}" x2="${g[0]}" y2="${g[1]}" stroke="#2563eb" stroke-width="3" stroke-dasharray="6 5" marker-end="url(#arw)"/>`;
  }
  out += `<circle cx="${S[0][0]}" cy="${S[0][1]}" r="7" fill="#16a34a"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${out}</svg>`;
}

function label(x, y, txt, fill) {
  const w = txt.length * 8 + 14;
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><rect x="${-w / 2}" y="-11" width="${w}" height="22" rx="4" fill="${fill}"/>
    <text y="5" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" font-family="Arial">${esc(txt)}</text></g>`;
}

async function viewSketch(pid) {
  if (!sk.property || sk.property._id !== pid) {
    const p = await api('/properties/' + pid);
    const floors = [...p.floors]; p.rooms.forEach(r => { if (!floors.includes(r.floor)) floors.push(r.floor); });
    Object.assign(sk, { property: { ...p, floors }, name: '', floor: floors[0], ceiling: 8, mode: 'touch', walls: [], turn: 90, phase: 'walk', listening: false, drift: 0 });
  }
  drawSketch();
}

function syncFloor() {
  const sel = document.getElementById('skFloor');
  if (sel && sel.value && sel.value !== '__new') sk.floor = sel.value;
  if (sk.floor && !sk.property.floors.includes(sk.floor)) sk.property.floors.push(sk.floor);
}

const micBtn = onclick => (SpeechRec ? `<button type="button" class="mic" title="Say the length" onclick="${onclick}">&#127908;</button>` : '');

function drawSketch() {
  syncFloor();
  const p = sk.property;
  const touch = sk.mode === 'touch';

  $app.innerHTML = `
    <div class="crumb"><button onclick="go('#/p/${p._id}')">&#8249; ${esc(p.address)}</button></div>
    <h1>Sketch a Room</h1>
    <p class="sub">Go around the room clockwise &mdash; always move to the wall on your right.</p>

    <div class="card card-pad" style="margin-top:14px">
      <label class="field"><span>Room Name</span><input id="skName" value="${esc(sk.name)}" placeholder="Bed 1, Kitchen, Hallway…" oninput="sk.name=this.value"></label>
      <div class="grid2">
        ${floorSelect(p.floors, sk.floor).replace('name="floor"', 'id="skFloor"')}
        <label class="field"><span>Ceiling (ft)</span><input type="number" step="0.01" min="1" value="${sk.ceiling}" inputmode="decimal" oninput="sk.ceiling=this.value"></label>
      </div>
      <div class="segs" role="tablist" style="margin-bottom:0">
        <button type="button" class="seg ${touch ? 'on' : ''}" onclick="setSketchMode('touch')">&#128241; Touch the walls</button>
        <button type="button" class="seg ${touch ? '' : 'on'}" onclick="setSketchMode('turns')">&#8635; Turn buttons</button>
      </div>
    </div>

    ${touch ? touchSection() : turnsSection()}
    <p class="note" style="text-align:center;margin:6px 0 24px">Simple rectangle? <a href="#" onclick="event.preventDefault();manualRoomModal(sk.property)">Enter length &times; width</a></p>`;

  document.getElementById('skFloor')?.addEventListener('change', syncFloor);
  if (touch && sk.phase === 'measure') updateMeasure();
}

function setSketchMode(mode) {
  if (mode === sk.mode) return;
  if (sk.walls.length && !confirm('Switching methods starts this room over. Continue?')) return;
  stopCapture();
  Object.assign(sk, { mode, walls: [], turn: 90, phase: 'walk', listening: false, drift: 0 });
  drawSketch();
}

/* ── Turn-buttons mode ── */

function turnsSection() {
  const n = sk.walls.length + 1;
  const pts = sketchPoints();
  const tail = pts[pts.length - 1];
  const gap = Math.hypot(tail[0], tail[1]);
  const closed = sk.walls.length >= 3 && gap < 1;
  const turnBtn = (deg, txt) => `<button type="button" class="seg ${sk.turn === deg ? 'on' : ''}" onclick="sk.turn=${deg};drawSketch()">${txt}</button>`;
  return `
    <div class="plan">${sketchSVG()}</div>
    ${closed ? `<div class="card card-pad"><b style="color:#86efac">&#10003; Room closes.</b> <span class="note">Name it and save.</span></div>` : `
    <div class="card card-pad">
      <div class="wall-head">Wall ${n}${sk.walls.length >= 2 ? `<span class="note">Skip the last wall &mdash; it closes automatically.</span>` : ''}</div>
      <div class="len-row">
        <label class="field"><span>Feet</span><input id="skFt" type="number" min="0" step="1" inputmode="numeric" placeholder="12"></label>
        <label class="field"><span>Inches</span><input id="skIn" type="number" min="0" max="11.99" step="0.5" inputmode="decimal" placeholder="0"></label>
        ${micBtn("sayLength(this,'skFt','skIn')")}
      </div>
      ${sk.walls.length ? `
        <div class="field"><span>Then turn</span></div>
        <div class="segs">${turnBtn(90, '&#8631; Right')}${turnBtn(-90, '&#8630; Left')}${turnBtn(0, '&#8593; Straight')}
          <button type="button" class="seg ${[90, -90, 0].includes(sk.turn) ? '' : 'on'}" onclick="customTurn()">&#8736; ${[90, -90, 0].includes(sk.turn) ? 'Angle' : sk.turn + '°'}</button></div>`
        : `<p class="note" style="margin-bottom:12px">Start at any corner. The first wall is drawn left to right.</p>`}
      <div class="btns" style="margin-bottom:0">
        <button type="button" class="btn" onclick="addWall()">+ Add Wall ${n}</button>
        ${sk.walls.length ? '<button type="button" class="btn gray small" onclick="sk.walls.pop();drawSketch()">&#8617; Undo</button>' : ''}
      </div>
    </div>`}
    ${sk.walls.length >= 2 ? `<div class="card card-pad">
      ${closed ? '' : `<p class="note" style="margin-bottom:10px">Closing wall back to the start: <b>${ftIn(gap)}</b>. If you measured it, it should match &mdash; if not, check your lengths and turns.</p>`}
      <button type="button" class="btn green" style="width:100%" onclick="saveSketch()">&#10003; Save Room</button>
    </div>` : ''}`;
}

function customTurn() {
  const v = prompt('Turn angle in degrees. Right is positive (e.g. 45), left is negative (e.g. -45).', '45');
  if (v == null) return;
  const d = Number(v);
  if (!Number.isFinite(d) || Math.abs(d) >= 180) return toast('Enter an angle between -179 and 179');
  sk.turn = d; drawSketch();
}

function readLen(ftId, inId) {
  const fv = document.getElementById(ftId)?.value, iv = document.getElementById(inId)?.value;
  if (!fv && !iv) return null;
  const len = Number(fv || 0) + Number(iv || 0) / 12;
  return len > 0.2 ? Math.round(len * 1000) / 1000 : null;
}

function addWall() {
  const len = readLen('skFt', 'skIn');
  if (!len) return toast('Enter the wall length');
  sk.walls.push({ len, heading: nextHeading() });
  drawSketch();
  document.getElementById('skFt')?.focus({ preventScroll: true });
}

/* ── Touch-the-walls mode ── */

function touchSection() {
  const n = sk.walls.length;
  if (sk.phase === 'measure') return measureSection();
  const preview = n ? `<div class="plan">${sketchSVG(sk.walls.map(() => 10), { guess: true })}</div>` : '';
  const listenBtn = (idleTxt) => `<button type="button" class="btn ${sk.listening ? 'blue-pulse' : 'amber'}" style="width:100%" onclick="startWalk()">${sk.listening ? '&#9679; Listening&hellip;' : idleTxt}</button>`;

  if (sk.phase === 'check') return `${preview}
    <div class="card card-pad">
      <div class="wall-head">Last step: touch wall 1 again</div>
      <p class="note" style="margin-bottom:12px">Press the phone on the <b>first wall</b> one more time. The phone's angle sense drifts a little as you walk &mdash; this measures the drift and squares up the corners.</p>
      ${listenBtn('&#128241; Touch wall 1 again')}
      <p class="note" id="skCapNote" style="margin-top:8px">&nbsp;</p>
      <div class="btns" style="margin-bottom:0"><button type="button" class="btn gray" onclick="skipCheck()">Skip</button></div>
    </div>`;

  return `${preview}
    <div class="card card-pad">
      <div class="wall-head">${n ? `${n} wall${n > 1 ? 's' : ''} captured` : 'Walk the room'}</div>
      ${n ? '' : `<ol class="steps">
        <li>Stand at any wall. Tap <b>Start</b>.</li>
        <li>Press the <b>back of the phone flat on the wall</b>, screen facing you. Hold still until it <b>beeps</b>.</li>
        <li>Move to the next wall on your right and do the same. Count every wall, even short ones at closets and bump-outs.</li>
        <li>When you're back where you started, tap <b>Back at wall 1</b>.</li></ol>`}
      ${listenBtn(n ? '&#9654; Keep going' : '&#9654; Start')}
      <p class="note" id="skCapNote" style="margin-top:8px">${sk.listening ? `Press the phone on wall ${n + 1}.` : '&nbsp;'}</p>
      <div class="btns" style="margin-bottom:0">
        ${n ? '<button type="button" class="btn gray small" onclick="undoTouch()">&#8617; Undo</button>' : ''}
        ${n >= 3 ? '<button type="button" class="btn green" onclick="startCheck()">&#10003; Back at wall 1</button>' : ''}
      </div>
    </div>`;
}

function measureSection() {
  return `
    <div class="plan" id="skPlan"></div>
    <div class="card card-pad">
      <div class="wall-head">Wall lengths<span class="note">Measure every wall except <b>any two</b> &mdash; leave those blank and they're calculated. Best: two walls that meet at a corner.</span></div>
      ${sk.walls.map((w, i) => `
        <div class="len-row" data-row="${i}">
          <div class="len-label">${i + 1}</div>
          <label class="field"><span>Feet</span><input id="tFt${i}" type="number" min="0" step="1" inputmode="numeric" value="${w.len ? Math.floor(w.len + 1e-6) : ''}" oninput="readTouchLen(${i})"></label>
          <label class="field"><span>Inches</span><input id="tIn${i}" type="number" min="0" max="11.99" step="0.5" inputmode="decimal" value="${w.len ? Math.round((w.len - Math.floor(w.len + 1e-6)) * 12 * 2) / 2 || '' : ''}" oninput="readTouchLen(${i})"></label>
          ${micBtn(`sayLength(this,'tFt${i}','tIn${i}',${i})`)}
        </div>`).join('')}
      <div id="skStatus" class="note" style="margin:6px 0 12px"></div>
      <button type="button" class="btn green" id="skSave" style="width:100%" onclick="saveSketch()">&#10003; Save Room</button>
      <div class="btns" style="margin-bottom:0"><button type="button" class="btn gray small" onclick="rewalk()">&#8634; Walk the room again</button></div>
    </div>`;
}

function readTouchLen(i) {
  sk.walls[i].len = readLen('tFt' + i, 'tIn' + i);
  updateMeasure();
}

/* Solve the touch sketch: known lengths + angles; up to two blank walls are
   calculated so the outline closes (two equations: x and y). */
function solveTouch() {
  const N = sk.walls.length;
  const lens = sk.walls.map(w => (w.len > 0 ? w.len : null));
  const blank = lens.map((l, i) => (l == null ? i : -1)).filter(i => i >= 0);
  let K = [0, 0];
  lens.forEach((l, i) => { if (l) { const v = unitVec(sk.walls[i].heading); K[0] += l * v[0]; K[1] += l * v[1]; } });
  if (blank.length > 2) return { ok: false, lens, calc: [], msg: `Enter ${blank.length - 2} more length${blank.length - 2 > 1 ? 's' : ''} &mdash; only two walls can be left blank.` };
  if (blank.length === 0) {
    const gap = Math.hypot(K[0], K[1]);
    return { ok: true, lens, calc: [], gap };
  }
  if (blank.length === 1) {
    const i = blank[0], u = unitVec(sk.walls[i].heading);
    const a = -(K[0] * u[0] + K[1] * u[1]);
    const gap = Math.hypot(K[0] + a * u[0], K[1] + a * u[1]);
    if (a <= 0.2) return { ok: false, lens, calc: [], msg: `Wall ${i + 1} can't be worked out from these numbers &mdash; measure it, or check the other lengths.` };
    lens[i] = a;
    return { ok: true, lens, calc: [i], gap };
  }
  const [i, j] = blank, u = unitVec(sk.walls[i].heading), v = unitVec(sk.walls[j].heading);
  const det = u[0] * v[1] - u[1] * v[0];
  if (Math.abs(det) < 0.25) return { ok: false, lens, calc: [], msg: `Walls ${i + 1} and ${j + 1} run parallel, so they can't both be calculated. Measure one of them and leave a wall that turns a corner blank instead.` };
  const a = (-K[0] * v[1] + K[1] * v[0]) / det;
  const b = (-u[0] * K[1] + u[1] * K[0]) / det;
  if (a <= 0.2 || b <= 0.2) return { ok: false, lens, calc: [], msg: `These lengths don't close the room &mdash; double-check them (or walk the room again if a wall was skipped).` };
  lens[i] = a; lens[j] = b;
  return { ok: true, lens, calc: [i, j], gap: 0 };
}

function updateMeasure() {
  const r = solveTouch();
  const plan = document.getElementById('skPlan'), status = document.getElementById('skStatus'), save = document.getElementById('skSave');
  if (!plan) return;
  const shown = r.lens.map(l => l || 10);
  plan.innerHTML = sketchSVG(shown, { calc: r.calc, guess: !r.ok });
  sk.walls.forEach((w, i) => {
    const row = document.querySelector(`[data-row="${i}"]`);
    row?.classList.toggle('calc', r.calc.includes(i));
    const ft = document.getElementById('tFt' + i);
    if (ft) ft.placeholder = r.calc.includes(i) ? ftIn(r.lens[i]).replace(/"/, '″') : '';
  });
  let msg = '';
  if (!r.ok) msg = r.msg;
  else if (r.calc.length) msg = `<b style="color:#c4b5fd">Calculated:</b> ${r.calc.map(i => `wall ${i + 1} = ${ftIn(r.lens[i])}`).join(', ')}.`;
  if (r.ok && r.gap > 0.5) msg += ` <b style="color:#fbbf24">Off by ${ftIn(r.gap)}</b> &mdash; the walls don't quite meet. Check a length or two, or leave two walls blank to have them calculated.`;
  else if (r.ok && !r.calc.length) msg += ' <b style="color:#86efac">&#10003; All walls measured and the room closes.</b>';
  status.innerHTML = msg;
  save.disabled = !r.ok;
  save.style.opacity = r.ok ? 1 : 0.45;
}

async function startWalk() {
  if (sk.listening) return;
  if (!(await motionPermission())) return;
  unlockAudio();
  sk.listening = true;
  drawSketch();
  if (sk.phase === 'check') listenForCheck(); else listenForWall();
}

function listenForWall() {
  const last = sk.walls[sk.walls.length - 1];
  startCapture({
    // the next wall must face a different way, so a lingering touch isn't counted twice
    needMoveFrom: last ? norm360(last.raw - 90) : null,
    onDone: outward => {
      const raw = norm360(outward + 90); // walking clockwise, the wall runs 90° right of the way it faces
      sk.walls.push({ raw, heading: raw, len: null });
      applyHeadings();
      beep(); navigator.vibrate?.(150);
      drawSketch();
      listenForWall();
    },
  });
}

function undoTouch() {
  sk.walls.pop();
  applyHeadings();
  drawSketch();
  if (sk.listening) { stopCapture(); listenForWall(); }
}

async function startCheck() {
  stopCapture();
  sk.phase = 'check';
  sk.listening = false;
  drawSketch();
}

function skipCheck() {
  stopCapture();
  Object.assign(sk, { phase: 'measure', listening: false, drift: 0 });
  applyHeadings();
  drawSketch();
}

function rewalk() {
  if (!confirm('Walk the room again? Lengths you entered will be cleared.')) return;
  Object.assign(sk, { walls: [], phase: 'walk', listening: false, drift: 0 });
  drawSketch();
}

// Check step: wall 1 again. The difference from the first reading is the drift.
function listenForCheck() {
  startCapture({
    onDone: outward => {
      const raw = norm360(outward + 90);
      const d = signed(raw - sk.walls[0].raw);
      beep(); navigator.vibrate?.(150);
      if (Math.abs(d) > 25) { toast("That didn't look like wall 1 — kept the readings as they were"); sk.drift = 0; }
      else { sk.drift = d; toast(`Drift corrected: ${Math.abs(d).toFixed(1)}°`); }
      Object.assign(sk, { phase: 'measure', listening: false });
      applyHeadings();
      drawSketch();
    },
  });
}

/* Drift spreads evenly over the walk (wall i read at step i of N, the check at
   step N). Then square each wall to the first one when it's within 6° of a 45° step. */
function applyHeadings() {
  const N = sk.walls.length;
  if (!N) return;
  const fixed = sk.walls.map((w, i) => norm360(w.raw - sk.drift * i / N));
  sk.walls.forEach((w, i) => {
    let h = fixed[i];
    if (i) {
      const rel = norm360(h - fixed[0]);
      const snap = Math.round(rel / 45) * 45;
      if (angDiff(rel, snap) <= 6) h = norm360(fixed[0] + snap);
    }
    w.heading = h;
  });
}

async function saveSketch() {
  syncFloor();
  const name = (sk.name || '').trim();
  if (!name) { toast('Name the room first'); window.scrollTo(0, 0); document.getElementById('skName')?.focus(); return; }
  let lens;
  if (sk.mode === 'touch') {
    const r = solveTouch();
    if (!r.ok) return toast('Finish the wall lengths first');
    lens = r.lens;
  }
  try {
    await api(`/properties/${sk.property._id}/rooms`, { method: 'POST', body: {
      name, floor: sk.floor, ceilingHeightFt: sk.ceiling, polygonFt: sketchPoints(lens),
    } });
    stopCapture();
    const pid = sk.property._id;
    sk.property = null;
    toast('Room saved');
    go('#/p/' + pid);
  } catch (err) { toast(err.message); }
}

/* ── Motion sensors ──
   The phone's back is pressed against the wall, so the back of the phone
   points out through the wall. We turn the device orientation into that
   direction on the floor plan, wait until it's steady, then beep. */

let capture = null;

async function motionPermission() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') throw new Error('Motion access was declined. In Safari: tap aA → Website Settings → allow Motion & Orientation Access, then try again.');
    }
    return true;
  } catch (err) {
    const note = document.getElementById('skCapNote');
    if (note) note.innerHTML = esc(err.message); else toast(err.message);
    return false;
  }
}

function backHeading(e) {
  const a = rad(e.alpha || 0), b = rad(e.beta || 0), g = rad(e.gamma || 0);
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  // third column of the W3C rotation matrix = device +Z (out of the screen) in world space
  const zx = cG * sA * sB + cA * sG, zy = sA * sG - cA * cG * sB, zz = cB * cG;
  const bx = -zx, by = -zy, bz = -zz;           // back of the phone
  const horiz = Math.hypot(bx, by);
  return { heading: norm360(Math.atan2(bx, by) * 180 / Math.PI), upright: horiz > 0.9 && Math.abs(bz) < 0.45 };
}

function circularMean(list) {
  let x = 0, y = 0; list.forEach(d => { x += Math.cos(rad(d)); y += Math.sin(rad(d)); });
  return norm360(Math.atan2(y, x) * 180 / Math.PI);
}

function startCapture({ onDone, needMoveFrom = null }) {
  stopCapture();
  const note = () => document.getElementById('skCapNote') || { set innerHTML(v) {} };
  const samples = [];
  let sawEvent = false;
  const onOrient = e => {
    if (e.alpha == null) return;
    sawEvent = true;
    const r = backHeading(e);
    const now = performance.now();
    if (!r.upright) { samples.length = 0; return; }
    samples.push({ t: now, h: r.heading });
    while (samples.length && now - samples[0].t > 900) samples.shift();
    const mean = circularMean(samples.map(s => s.h));
    const spread = Math.max(...samples.map(s => angDiff(s.h, mean)));
    if (needMoveFrom != null && angDiff(mean, needMoveFrom) < 20) return; // still on the last wall
    if (samples.length > 8 && now - samples[0].t > 750 && spread < 1.5) {
      stopCapture();
      onDone(mean);
    } else if (spread >= 1.5) {
      note().innerHTML = 'Hold still&hellip;';
    }
  };
  capture = {
    onOrient,
    timer: setTimeout(() => {
      if (sawEvent) return;
      stopCapture();
      sk.listening = false;
      drawSketch();
      note().innerHTML = 'This device isn’t sending motion data. Use <b>Turn buttons</b> instead.';
    }, 2500),
  };
  window.addEventListener('deviceorientation', onOrient);
}

function stopCapture() {
  if (!capture) return;
  window.removeEventListener('deviceorientation', capture.onOrient);
  clearTimeout(capture.timer);
  capture = null;
}

let audioCtx = null;
function unlockAudio() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch {}
}
function beep() {
  try {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 1046; g.gain.value = 0.25;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18); o.stop(audioCtx.currentTime + 0.2);
  } catch {}
}

window.addEventListener('hashchange', () => { if (!/\/sketch$/.test(location.hash)) { stopCapture(); sk.listening = false; } });

/* ── Say the length ──
   "twelve six", "12 feet 6 inches", "eleven and a half", "nine point five"
   → feet + inches in the two boxes. */

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;

const NUM_WORDS = { zero: 0, oh: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7,
  eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function parseSpokenLength(text) {
  let t = ` ${String(text).toLowerCase()} `
    .replace(/(\d)\s*(?:'|’|ft\b)/g, '$1 feet ').replace(/(\d)\s*(?:"|”|in\b)/g, '$1 inches ')
    .replace(/[-,]/g, ' ');
  let half = false, quarter = 0;
  if (/\band (a|one) half\b|\bhalf\b/.test(t)) { half = true; t = t.replace(/\band (a|one) half\b|\bhalf\b/g, ' '); }
  if (/\band (a|one) quarter\b/.test(t)) { quarter = 0.25; t = t.replace(/\band (a|one) quarter\b/g, ' '); }
  const toks = t.split(/\s+/).filter(Boolean);
  const items = []; // {n} numbers or {unit:'ft'|'in'}
  for (let k = 0; k < toks.length; k++) {
    const w = toks[k];
    if (/^(feet|foot)$/.test(w)) { items.push({ unit: 'ft' }); continue; }
    if (/^inch(es)?$/.test(w)) { items.push({ unit: 'in' }); continue; }
    if (w === 'point' || w === 'dot') { items.push({ point: true }); continue; }
    let n = null;
    if (/^\d+(\.\d+)?$/.test(w)) n = Number(w);
    else if (w in NUM_WORDS) n = NUM_WORDS[w];
    if (n == null) continue;
    const prev = items[items.length - 1];
    // "twenty three" → 23
    if (prev && prev.n != null && prev.n >= 20 && prev.n % 10 === 0 && n < 10 && !prev.joined) { prev.n += n; prev.joined = true; continue; }
    // "nine point five" → 9.5
    if (prev && prev.point && items.length >= 2 && items[items.length - 2].n != null) {
      items.pop(); const base = items[items.length - 1];
      base.n = Number(`${Math.floor(base.n)}.${String(n).replace('.', '')}`); continue;
    }
    items.push({ n });
  }
  let ft = null, inch = null;
  const nums = [];
  items.forEach((it, k) => {
    if (it.n == null) return;
    const unit = items[k + 1]?.unit;
    if (unit === 'in') inch = it.n;
    else if (unit === 'ft') ft = it.n;
    else nums.push(it.n);
  });
  nums.forEach(n => { if (ft == null) ft = n; else if (inch == null) inch = n; });
  if (ft == null && inch == null) return null;
  ft = ft || 0; inch = inch || 0;
  if (half) { if (inch) inch += 0.5; else ft += 0.5; }
  ft += quarter;
  if (inch >= 12) return null;
  const total = ft + inch / 12;
  if (!(total > 0.2 && total < 500)) return null;
  const wholeFt = Math.floor(total + 1e-9);
  return { ft: wholeFt, inch: Math.round((total - wholeFt) * 12 * 2) / 2 };
}

let activeRec = null;
function sayLength(btn, ftId, inId, row) {
  if (!SpeechRec) return;
  if (activeRec) { try { activeRec.abort(); } catch {} activeRec = null; }
  const rec = new SpeechRec();
  activeRec = rec;
  rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 4;
  btn.classList.add('on');
  const done = () => { btn.classList.remove('on'); if (activeRec === rec) activeRec = null; };
  rec.onresult = e => {
    const alts = Array.from(e.results[0] || []).map(a => a.transcript);
    const hit = alts.map(parseSpokenLength).find(Boolean);
    if (!hit) { toast(`Didn't catch a length in "${alts[0] || ''}" — try "twelve six"`); return; }
    document.getElementById(ftId).value = hit.ft;
    document.getElementById(inId).value = hit.inch || '';
    if (row != null) {
      readTouchLen(row);
      // jump to the next empty row's mic
      const next = sk.walls.findIndex((w, i) => i > row && !w.len);
      if (next >= 0) document.getElementById('tFt' + next)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };
  rec.onerror = e => { if (e.error === 'not-allowed') toast('Microphone access is off for this site.'); done(); };
  rec.onend = done;
  try { rec.start(); } catch { done(); }
}
