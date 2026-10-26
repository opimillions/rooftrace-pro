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
   Walk the room clockwise (keep moving to the wall on your right). For each
   wall enter its length, then set its direction either with turn buttons or
   by pressing the phone flat against the wall: the motion sensors read which
   way the wall faces, it beeps when it has a steady reading, and you move on. */

const sk = {
  property: null, name: '', floor: '', ceiling: 8,
  mode: 'turns',            // 'turns' | 'touch'
  walls: [],                // { len (ft), heading (deg, 0 = up on the plan, clockwise) }
  turn: 90,                 // next turn in turns mode (right = +90)
  captured: null,           // heading captured from the wall in touch mode
};

const rad = d => d * Math.PI / 180;
const norm360 = d => ((d % 360) + 360) % 360;

// In touch mode the sensor's zero is arbitrary, so turn the drawing until the first wall runs left → right.
const viewOffset = () => (sk.mode === 'touch' && sk.walls.length ? sk.walls[0].heading - 90 : 0);
const dispH = h => (h == null ? null : h - viewOffset());

function sketchPoints() {
  const pts = [[0, 0]];
  sk.walls.forEach(w => {
    const p = pts[pts.length - 1], h = rad(dispH(w.heading));
    pts.push([p[0] + w.len * Math.sin(h), p[1] - w.len * Math.cos(h)]);
  });
  return pts;
}

function nextHeading() {
  if (sk.mode === 'touch') return sk.captured;
  if (!sk.walls.length) return 90; // first wall runs left → right on the plan
  return norm360(sk.walls[sk.walls.length - 1].heading + sk.turn);
}

function sketchSVG() {
  const pts = sketchPoints();
  const W = 600, pad = 56;
  const h = dispH(nextHeading());
  // include a ghost point for the next direction so the arrow stays in view
  const tail = pts[pts.length - 1];
  const ref = Math.max(6, ...sk.walls.map(w => w.len)) * 0.35;
  const ghost = h == null ? tail : [tail[0] + ref * Math.sin(rad(h)), tail[1] - ref * Math.cos(rad(h))];
  const all = pts.concat([ghost]);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, (maxY - minY) * 0.85, 8);
  const sc = (W - pad * 2) / span;
  const H = Math.max(260, Math.round((maxY - minY) * sc + pad * 2));
  const ox = (W - (maxX - minX) * sc) / 2;
  const P = p => [ox + (p[0] - minX) * sc, pad + (p[1] - minY) * sc];
  const S = pts.map(P);
  let out = '';
  if (pts.length >= 3) {
    out += `<polygon points="${S.map(p => p.join(',')).join(' ')}" fill="#f7f2e1" stroke="none"/>`;
    const a = S[S.length - 1], b = S[0];
    const gap = Math.hypot(pts[0][0] - tail[0], pts[0][1] - tail[1]);
    if (gap > 0.5) {
      out += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#94a3b8" stroke-width="3" stroke-dasharray="8 6"/>`;
      out += label((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ftIn(gap), '#64748b');
    }
  }
  if (S.length > 1) out += `<polyline points="${S.map(p => p.join(',')).join(' ')}" fill="none" stroke="#0f172a" stroke-width="7" stroke-linejoin="miter"/>`;
  sk.walls.forEach((w, i) => {
    const a = S[i], b = S[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    // labels outside a clockwise outline = to the left of travel
    out += label((a[0] + b[0]) / 2 + (dy / L) * 20, (a[1] + b[1]) / 2 - (dx / L) * 20, `${i + 1}: ${ftIn(w.len)}`, '#334155');
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
    Object.assign(sk, { property: { ...p, floors }, name: '', floor: floors[0], ceiling: 8, mode: 'turns', walls: [], turn: 90, captured: null });
  }
  drawSketch();
}

function syncFloor() {
  const sel = document.getElementById('skFloor');
  if (sel && sel.value && sel.value !== '__new') sk.floor = sel.value;
  if (sk.floor && !sk.property.floors.includes(sk.floor)) sk.property.floors.push(sk.floor);
}

function drawSketch() {
  syncFloor();
  const p = sk.property;
  const n = sk.walls.length + 1;
  const pts = sketchPoints();
  const tail = pts[pts.length - 1];
  const gap = Math.hypot(tail[0], tail[1]);
  const closed = sk.walls.length >= 3 && gap < 1;
  const turnBtn = (deg, txt) => `<button type="button" class="seg ${sk.turn === deg ? 'on' : ''}" onclick="sk.turn=${deg};drawSketch()">${txt}</button>`;

  $app.innerHTML = `
    <div class="crumb"><button onclick="go('#/p/${p._id}')">&#8249; ${esc(p.address)}</button></div>
    <h1>Sketch a Room</h1>
    <p class="sub">Measure each wall and go around the room clockwise &mdash; always move to the wall on your right.</p>

    <div class="card card-pad" style="margin-top:14px">
      <label class="field"><span>Room Name</span><input id="skName" value="${esc(sk.name)}" placeholder="Bed 1, Kitchen, Hallway…" oninput="sk.name=this.value"></label>
      <div class="grid2">
        ${floorSelect(p.floors, sk.floor).replace('name="floor"', 'id="skFloor"')}
        <label class="field"><span>Ceiling (ft)</span><input type="number" step="0.01" min="1" value="${sk.ceiling}" inputmode="decimal" oninput="sk.ceiling=this.value"></label>
      </div>
      <div class="segs" role="tablist">
        <button type="button" class="seg ${sk.mode === 'turns' ? 'on' : ''}" onclick="setSketchMode('turns')">&#8635; Turn buttons</button>
        <button type="button" class="seg ${sk.mode === 'touch' ? 'on' : ''}" onclick="setSketchMode('touch')">&#128241; Touch the wall</button>
      </div>
    </div>

    <div class="plan">${sketchSVG()}</div>

    ${closed ? `<div class="card card-pad"><b style="color:#86efac">&#10003; Room closes.</b> <span class="note">Name it and save.</span></div>` : `
    <div class="card card-pad">
      <div class="wall-head">Wall ${n}${sk.walls.length >= 2 ? `<span class="note">Skip the last wall &mdash; it closes automatically.</span>` : ''}</div>
      <div class="grid2">
        <label class="field"><span>Feet</span><input id="skFt" type="number" min="0" step="1" inputmode="numeric" placeholder="12"></label>
        <label class="field"><span>Inches</span><input id="skIn" type="number" min="0" max="11.99" step="0.5" inputmode="decimal" placeholder="0"></label>
      </div>
      ${sk.mode === 'turns' ? (sk.walls.length ? `
        <div class="field"><span>Then turn</span></div>
        <div class="segs">${turnBtn(90, '&#8631; Right')}${turnBtn(-90, '&#8630; Left')}${turnBtn(0, '&#8593; Straight')}
          <button type="button" class="seg ${[90, -90, 0].includes(sk.turn) ? '' : 'on'}" onclick="customTurn()">&#8736; ${[90, -90, 0].includes(sk.turn) ? 'Angle' : sk.turn + '°'}</button></div>`
        : `<p class="note" style="margin-bottom:12px">Start at any corner. The first wall is drawn left to right.</p>`)
      : `
        <button type="button" class="btn ${sk.captured == null ? 'amber' : 'gray'}" style="width:100%" id="skCapture" onclick="startCapture()">
          ${sk.captured == null ? '&#128241; Capture this wall' : '&#10003; Wall captured &mdash; tap to redo'}</button>
        <p class="note" id="skCapNote" style="margin-top:8px">${sk.captured == null
          ? 'Tap, then press the <b>back of the phone flat against the wall</b> and hold still until it beeps.'
          : 'Got it. Enter the length and add the wall.'}</p>`}
      <div class="btns" style="margin-bottom:0">
        <button type="button" class="btn" onclick="addWall()">+ Add Wall ${n}</button>
        ${sk.walls.length ? '<button type="button" class="btn gray small" onclick="sk.walls.pop();sk.captured=null;drawSketch()">&#8617; Undo</button>' : ''}
      </div>
    </div>`}

    ${sk.walls.length >= 2 ? `<div class="card card-pad">
      ${closed ? '' : `<p class="note" style="margin-bottom:10px">Closing wall back to the start: <b>${ftIn(gap)}</b>. If you measured it, it should match &mdash; if not, check your lengths and turns.</p>`}
      <button type="button" class="btn green" style="width:100%" onclick="saveSketch()">&#10003; Save Room</button>
    </div>` : ''}
    <p class="note" style="text-align:center;margin:6px 0 24px">Simple rectangle? <a href="#" onclick="event.preventDefault();manualRoomModal(sk.property)">Enter length &times; width</a></p>`;

  document.getElementById('skFloor')?.addEventListener('change', syncFloor);
  if (!closed) document.getElementById('skFt')?.focus({ preventScroll: true });
}

function setSketchMode(mode) {
  if (mode === sk.mode) return;
  if (sk.walls.length && !confirm('Switching methods starts this room over. Continue?')) return;
  stopCapture();
  Object.assign(sk, { mode, walls: [], captured: null, turn: 90 });
  drawSketch();
}

function customTurn() {
  const v = prompt('Turn angle in degrees. Right is positive (e.g. 45), left is negative (e.g. -45).', '45');
  if (v == null) return;
  const d = Number(v);
  if (!Number.isFinite(d) || Math.abs(d) >= 180) return toast('Enter an angle between -179 and 179');
  sk.turn = d; drawSketch();
}

function addWall() {
  const ft = Number(document.getElementById('skFt').value || 0);
  const inch = Number(document.getElementById('skIn').value || 0);
  const len = ft + inch / 12;
  if (!(len > 0.2)) return toast('Enter the wall length');
  const h = nextHeading();
  if (h == null) return toast('Capture the wall first — press the phone flat against it');
  sk.walls.push({ len: Math.round(len * 1000) / 1000, heading: h });
  sk.captured = null;
  drawSketch();
}

async function saveSketch() {
  syncFloor();
  const name = (sk.name || '').trim();
  if (!name) { toast('Name the room first'); document.getElementById('skName')?.focus(); return; }
  try {
    await api(`/properties/${sk.property._id}/rooms`, { method: 'POST', body: {
      name, floor: sk.floor, ceilingHeightFt: sk.ceiling, polygonFt: sketchPoints(),
    } });
    stopCapture();
    const pid = sk.property._id;
    sk.property = null;
    toast('Room saved');
    go('#/p/' + pid);
  } catch (err) { toast(err.message); }
}

/* ── Touch the wall: motion sensors ──
   The phone's back is pressed against the wall, so the back of the phone
   points out through the wall. We turn the device orientation into that
   direction on the floor plan, wait until it's steady, then beep. */

let capture = null;

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
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

async function startCapture() {
  stopCapture();
  const note = document.getElementById('skCapNote'), btn = document.getElementById('skCapture');
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') throw new Error('Motion access was declined. In Safari: aA menu → Website Settings → Motion & Orientation Access.');
    }
  } catch (err) { note.innerHTML = esc(err.message); return; }
  unlockAudio();
  btn.textContent = 'Hold the phone flat against the wall…';
  btn.className = 'btn blue-pulse';
  note.innerHTML = 'Back of the phone on the wall, screen facing you. Hold still.';
  const samples = [];
  let sawEvent = false;
  const onOrient = e => {
    if (e.alpha == null) return;
    sawEvent = true;
    const r = backHeading(e);
    const now = performance.now();
    if (!r.upright) { samples.length = 0; note.innerHTML = 'Stand the phone <b>upright</b> with its back flat on the wall.'; return; }
    samples.push({ t: now, h: r.heading });
    while (samples.length && now - samples[0].t > 900) samples.shift();
    const mean = circularMean(samples.map(s => s.h));
    const spread = Math.max(...samples.map(s => angDiff(s.h, mean)));
    if (samples.length > 8 && now - samples[0].t > 750 && spread < 1.5) {
      finishCapture(mean);
    } else {
      note.innerHTML = 'Holding… keep it still.';
    }
  };
  capture = { onOrient, timer: setTimeout(() => { if (!sawEvent) { stopCapture(); note.innerHTML = 'This device isn’t sending motion data. Use <b>Turn buttons</b> instead.'; btn.textContent = 'Try again'; btn.className = 'btn amber'; } }, 2500) };
  window.addEventListener('deviceorientation', onOrient);
}

function finishCapture(outward) {
  stopCapture();
  // Walking clockwise, the wall runs 90° clockwise from the direction it faces.
  let h = norm360(outward + 90);
  if (sk.walls.length) {
    // Line up with the first wall and square it off when it's within 6° of a 45° step.
    const h0 = sk.walls[0].heading;
    const rel = norm360(h - h0);
    const snap = Math.round(rel / 45) * 45;
    if (angDiff(rel, snap) <= 6) h = norm360(h0 + snap);
  }
  sk.captured = h;
  beep();
  navigator.vibrate?.(150);
  // carry over the length the user may have typed before capturing
  const ft = document.getElementById('skFt')?.value, inch = document.getElementById('skIn')?.value;
  drawSketch();
  if (ft) document.getElementById('skFt').value = ft;
  if (inch) document.getElementById('skIn').value = inch;
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

window.addEventListener('hashchange', () => { if (!/\/sketch$/.test(location.hash)) stopCapture(); });
