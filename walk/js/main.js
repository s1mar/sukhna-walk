// Walk controller: input, state, loop, save. Glues world, render, people, dialogue, audio.
(function () {
  "use strict";
  var W = SW.world;
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("scene");
  // The art is chosen once at boot: ?art=first keeps the first-person painting, anything else is the
  // pixel-art side view. Whichever is live also owns SW.people (the crowd and AI Simar's avatar).
  var ART = /(^|[?&])art=first(&|$)/.test(location.search) ? "first" : "pixel";
  SW.art = ART;
  SW.peopleFirst = SW.people;
  if (ART === "pixel" && SW.pix && SW.pixPeople) SW.people = SW.pixPeople; else ART = SW.art = "first";
  var R = ART === "pixel" ? SW.pix : SW.render;

  var SPEED = 5.0;          // metres per second at a brisk walk (the far end of the joystick)
  var STROLL = 1.2;         // metres per second just past the dead zone
  var DUSK_DIST = 2300;     // metres of walking from golden hour to night
  var WALK_YAW = 26;        // look this far toward the water while looking along the path (gaze 0)
  var LEAN_YAW = 90;        // face the water square on (gaze 1)
  var S_MIN = 6, S_MAX = W.L - 8;
  var ZONE_TOP = 0.72;      // the bottom 28 percent of the screen is the thumb zone
  var STRIP_RESERVE = 84;   // px kept free at the very bottom: the jump strip (about 52) plus a 32 px gap that starts nothing
  var BAND_MIN = 96;        // the walk band is at least this tall, even on a short landscape screen
  var EDGE = 82;            // the joystick centre stays this far from each screen edge (half the ring), so the ring is never cut off
  var FLIP_HOLD = 0.2;      // s: after a change of direction the speed eases off and a second flip waits (a wiggle cannot pin the pose)
  var HOLD_MIN = 250;       // ms the stone name must have been on screen before a release on the strip jumps
  var KEY_PACE = 2.6;       // m/s walking with the keyboard; Shift goes brisk
  var DEAD = 10, CAP = 64;  // joystick: dead zone and full-pace distance from where the thumb landed (px)
  var LOOK_PX = 200;        // a look drag of this many px sweeps the whole gaze range
  var MOVE_CLICK = 10;      // a gesture that moved further than this never fires a click
  var HINT_METRES = 10;     // the resting hint goes away after she has really walked this far
  var DAY_HOUR = 17.5;      // golden hour: where the day starts in "with the walk" mode
  var HOURS = 3;            // hours from golden hour (dusk 0) to night (dusk 1)

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function num(v) { var n = (typeof v === "string" && v.trim() !== "") || typeof v === "number" ? Number(v) : NaN; return isFinite(n) ? n : null; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function validHour(v) { var n = num(v); return n !== null && n >= 0 && n <= 24 ? n : null; }
  function duskForHour(h) { return h >= DAY_HOUR ? clamp((h - DAY_HOUR) / HOURS, 0, 1) : h < 5.5 ? 1 : 0; }
  function lampsLit(h) { return h >= 19 || h < 6; }

  var q = {};
  function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  location.search.replace(/^\?/, "").split("&").forEach(function (kv) {
    if (!kv) return; var p = kv.split("="); var k = dec(p[0]);
    if (k === "__proto__") return;
    q[k] = dec(p.slice(1).join("="));
  });
  var qS = own(q, "s") ? num(q.s) : null;

  var st = {
    s: 14, dir: 1, dusk: 0, hour: null, speed: 0, flipHold: 0, yaw: WALK_YAW, gaze: 0, gazeGoal: 0, holding: false, stillFor: 0, jumping: false,
    t: 0, started: false, withAvatar: true, seasonKind: null, muted: false, sky: "real", frames: 0, walked: 0,
    lampOn: new Float32Array(W.lamps.length), lampLit: new Uint8Array(W.lamps.length)
  };
  var season = SW.season.today();
  function hourNow() { return st.hour === null ? DAY_HOUR + st.dusk * HOURS : st.hour; }

  // ---------- save / restore (Messenger reloads the page when it comes back) ----------
  // keys are per edition (js/edition.js): the editions share one origin. The old unprefixed key is read as a fallback
  // by the editions that had it (never by the generic one), so a walk saved before this change is not lost.
  var KEY_BASE = "sukhna-walk-v1", KEY = SW.edition.key(KEY_BASE), KEY_OLD = SW.edition.legacy(KEY_BASE);
  function readSave() {
    var raw = localStorage.getItem(KEY);
    if (raw === null && KEY_OLD) raw = localStorage.getItem(KEY_OLD);
    return raw;
  }
  function save() {
    if (!st.started) return;      // a walk that has not begun must never overwrite the saved one
    try {
      localStorage.setItem(KEY, JSON.stringify({ s: st.s, dir: st.dir, dusk: st.dusk, hour: st.hour, withAvatar: st.withAvatar,
        seasonKind: st.seasonKind, muted: st.muted, sky: st.sky, dlg: SW.dialogue ? SW.dialogue.saveState() : null, at: Date.now() }));
    } catch (e) { /* private mode or blocked storage: the walk still works */ }
  }
  // a save is data, never trusted: every field is coerced to a known type and range
  function load() {
    try {
      var v = JSON.parse(readSave() || "null");
      if (!v || typeof v !== "object" || Array.isArray(v) || num(v.s) === null) return null;
      return {
        s: clamp(num(v.s), S_MIN, S_MAX), dir: v.dir === -1 ? -1 : 1,
        dusk: num(v.dusk) === null ? 0 : clamp(num(v.dusk), 0, 1), hour: validHour(v.hour),
        withAvatar: v.withAvatar !== false,
        seasonKind: typeof v.seasonKind === "string" && own(SW.season.KINDS, v.seasonKind) ? v.seasonKind : null,
        muted: v.muted === true, sky: v.sky === "dusk" ? "dusk" : "real",
        dlg: v.dlg && typeof v.dlg === "object" && !Array.isArray(v.dlg) ? v.dlg : null
      };
    } catch (e) { return null; }
  }

  // ---------- debug / test hooks (used by gates; harmless for her) ----------
  if (qS !== null) st.s = clamp(qS, S_MIN, S_MAX);
  if (own(q, "dusk") && num(q.dusk) !== null) st.dusk = clamp(num(q.dusk), 0, 1);
  if (own(q, "hour") && validHour(q.hour) !== null) st.hour = validHour(q.hour);
  // the sky palette: a URL choice beats the saved one; the saved one applies even on a ?s= or ?fresh visit
  var savedAtBoot = load();
  if (savedAtBoot) st.sky = savedAtBoot.sky;
  if (q.sky === "dusk" || q.sky === "real") st.sky = q.sky;
  if (own(q, "dir") && num(q.dir) !== null) st.dir = num(q.dir) < 0 ? -1 : 1;
  if (q.lean) { st.gaze = st.gazeGoal = 1; st.yaw = LEAN_YAW; }   // gates and shots: start turned to the lake
  if (own(q, "gaze") && num(q.gaze) !== null) { st.gaze = st.gazeGoal = clamp(num(q.gaze), -1, 1); st.yaw = WALK_YAW + st.gaze * (LEAN_YAW - WALK_YAW); }
  if (q.season && own(SW.season.KINDS, q.season)) { st.seasonKind = q.season; season = SW.season.pick(q.season); }

  function setSeason(kind) {
    st.seasonKind = kind && own(SW.season.KINDS, kind) ? kind : null;
    season = st.seasonKind ? SW.season.pick(st.seasonKind) : SW.season.today();
  }

  // ---------- lamps: lit from 19:00 to 6:00; in auto mode they switch on in sequence near her ----------
  function updateLamps(dt, hour) {
    var night = lampsLit(hour), manual = st.hour !== null;
    for (var i = 0; i < W.lamps.length; i++) {
      if (night) {
        if (!st.lampLit[i]) {
          var ds = Math.abs(W.lamps[i] - st.s);
          if (manual || hour < 6 || ds < 60 || hour >= 19 + Math.min(0.36, ds / 1333)) st.lampLit[i] = 1;
        }
      } else st.lampLit[i] = 0;
      var target = st.lampLit[i] ? 1 : 0;
      st.lampOn[i] += (target - st.lampOn[i]) * Math.min(1, dt * 1.2);
      if (st.lampOn[i] < 0.002) st.lampOn[i] = 0;
    }
  }
  function setLampsNow(hour) {
    var on = lampsLit(hour) ? 1 : 0;
    for (var i = 0; i < W.lamps.length; i++) { st.lampLit[i] = on; st.lampOn[i] = on; }
  }

  // ---------- place names (only real ones) ----------
  var placeEl = $("place"), placeNow = "", placeTimer = 0;
  function placeName(s) {
    if (s < 130) return "Boat Club";
    if (s > W.L - 180) return "Regulator End";
    for (var i = 0; i < W.stairs.length; i++) if (Math.abs(s - W.stairs[i]) < 18) return "Steps down to the jogging trail";
    return "";
  }

  function wake() { if (SW.audio) SW.audio.resume(); }

  // ---------- input: two roles, chosen by where a finger lands ----------
  //   bottom thumb zone: a horizontal JOYSTICK. Where the thumb lands is the centre; dragging right walks toward
  //     screen right, left toward screen left (she turns to face the way you drag); the further from the centre,
  //     the faster; inside the dead zone she stands; letting go stops. Vertical movement does nothing.
  //   anywhere above it: LOOK. A horizontal drag sets the gaze between the path (0) and the lake (1).
  //   each pointerId keeps its own role, so one finger can walk while another looks. A second finger that rests
  //   in the same zone takes over when the first lifts.
  var roles = {};            // pointerId -> { kind, n, ox, oy, x, y, g0, far }
  var canvasDown = {};       // pointerIds whose press began on the scene (so they may re-acquire a role on move)
  var seq = 0;
  var keys = { l: false, r: false, up: false, dn: false, shift: false };   // the keyboard path: arrows or A/D walk, up/down look, Shift brisk
  function keyDir() { return keys.r === keys.l ? 0 : keys.r ? 1 : -1; }
  var debugHold = false;     // SW.debug.setHold: the gates' brisk walk without a finger
  var suppress = { until: 0, target: null, any: false, pid: -1 };
  var thumbKey = SW.edition.key("sukhna-walk-thumb-v1"), thumbOld = SW.edition.legacy("sukhna-walk-thumb-v1"), walkedOnce = false;
  try { walkedOnce = localStorage.getItem(thumbKey) === "1" || (!!thumbOld && localStorage.getItem(thumbOld) === "1"); } catch (e) { /* storage blocked: the ring shows each visit */ }
  var restEl = $("rest"), ringEl = $("tring"), dotEl = $("tdot");
  var safeProbe = document.createElement("div");
  safeProbe.style.cssText = "position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(safeProbe);
  function safeBottom() { return safeProbe.offsetHeight || 0; }
  function zoneBottomY() { return window.innerHeight - safeBottom() - STRIP_RESERVE; }
  // the walk band: the lower 28 percent, but never thinner than BAND_MIN (a landscape phone gets the lower half)
  function zoneTopY() { return Math.min(window.innerHeight * ZONE_TOP, zoneBottomY() - BAND_MIN); }
  function zoneOf(y) {
    if (y > zoneBottomY()) return "none";          // the home indicator, the gap and the jump strip rows start nothing
    return y >= zoneTopY() ? "walk" : "look";
  }
  var turnEl = $("turn"), turnB = -1;
  // Turn around sits just above the walk band, so it can never overlap the resting pill or the thumb
  function placeTurn() {
    var b = Math.round(window.innerHeight - zoneTopY() + 8);
    if (b !== turnB) { turnB = b; turnEl.style.bottom = b + "px"; }
  }
  function placeRest() {
    restEl.style.left = "50%";
    restEl.style.top = Math.round((zoneTopY() + zoneBottomY()) / 2) + "px";
    placeTurn();
  }
  function showRest() {
    var on = st.started && !walkedOnce && !walker();
    restEl.style.display = on ? "block" : "none";
    if (on) placeRest();
  }
  function markWalked() {
    if (walkedOnce) return;
    walkedOnce = true;
    try { localStorage.setItem(thumbKey, "1"); } catch (err) { /* private mode */ }
    showRest();
  }
  function easeS(t) { return t * t * (3 - 2 * t); }
  // joystick fill 0..1: nothing inside the dead zone, then easing up to full at CAP px
  function frac(dx) { var m = Math.abs(dx); return m < DEAD ? 0 : easeS(Math.min(1, (m - DEAD) / (CAP - DEAD))); }
  function paceSpeed(r) {
    var dx = r.x - r.ox;
    return Math.abs(dx) < DEAD ? 0 : STROLL + (SPEED - STROLL) * frac(dx);
  }
  function first(kind) {
    var best = null;
    for (var k in roles) if (roles[k].kind === kind && (!best || roles[k].n < best.n)) best = roles[k];
    return best;
  }
  function walker() { return first("walk"); }
  function looker() { return first("look"); }
  function syncHolding() { st.holding = !!walker() || debugHold || keyDir() !== 0; }
  function drawThumb() {
    var w = walker();
    if (!w) { ringEl.style.display = "none"; dotEl.style.display = "none"; showRest(); return; }
    var dx = clamp(w.x - w.ox, -CAP, CAP), f = frac(dx);
    restEl.style.display = "none";
    ringEl.style.display = dotEl.style.display = "block";
    ringEl.style.left = w.ox + "px"; ringEl.style.top = w.oy + "px";
    dotEl.style.left = (w.ox + dx) + "px"; dotEl.style.top = w.oy + "px";
    ringEl.style.background = "rgba(255,207,138," + (0.04 + 0.3 * f).toFixed(3) + ")";
    ringEl.style.borderColor = "rgba(255,207,138," + (0.34 + 0.5 * f).toFixed(3) + ")";
    ringEl.dataset.pace = f.toFixed(2);
  }
  function snapGaze(g) { return Math.abs(g) < 0.15 ? 0 : g > 0.85 ? 1 : g; }
  function lookTo(r) {
    var g = r.g0 - (r.x - r.ox) * st.dir / LOOK_PX;   // toward the lake side of the screen raises the gaze
    st.gazeGoal = clamp(g, -1, 1);
  }
  function acquire(id, kind, x, y) {
    // a thumb that lands near a screen edge gets its centre pulled in, so the stick can still reach full pace and the ring stays on screen
    var ox = kind === "walk" ? clamp(x, EDGE, Math.max(EDGE, window.innerWidth - EDGE)) : x;
    var r = roles[id] = { kind: kind, n: ++seq, ox: ox, oy: y, x: x, y: y, g0: st.gazeGoal, far: false };
    syncHolding(); drawThumb();
    return r;
  }
  function endRole(id) {
    var r = roles[id]; if (!r) return null;
    delete roles[id];
    if (r.kind === "look") {
      st.gazeGoal = snapGaze(st.gazeGoal);
      var nl = looker(); if (nl) { nl.ox = nl.x; nl.oy = nl.y; nl.g0 = st.gazeGoal; }
    }
    syncHolding(); drawThumb();
    return r;
  }
  function releaseAll() {
    for (var id in roles) endRole(id);
    debugHold = false; syncHolding(); drawThumb();
  }
  // face the way the thumb is dragged (the loop calls this when the drag crosses to the other side)
  // The speed eases off (flipHold, in the loop) rather than snapping to zero, and the gaze eases back with the lean.
  // A finger that is looking is re-anchored, or its look would swing to the other sign.
  function faceWay(d) {
    st.dir = d; st.stillFor = 0; st.flipHold = FLIP_HOLD;
    var l = looker();
    if (l) { l.ox = l.x; l.oy = l.y; l.g0 = st.gazeGoal; } else st.gazeGoal = 0;
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (!st.started || roles[e.pointerId]) return;
    e.preventDefault();
    var z = zoneOf(e.clientY);
    if (z === "none") return;
    wake();
    canvasDown[e.pointerId] = 1;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or older WebKit */ }
    acquire(e.pointerId, z, e.clientX, e.clientY);
  }, { passive: false });
  window.addEventListener("pointermove", function (e) {
    var r = roles[e.pointerId];
    if (!r) {
      // a finger that lost its role (a fade, a switch of apps, a blur) and is still down takes one up again where it is now
      if (!canvasDown[e.pointerId] || e.target !== canvas || !st.started || sheetOpen()) return;
      if (e.pointerType === "mouse" && !(e.buttons & 1)) return;
      var z = zoneOf(e.clientY); if (z === "none") return;
      r = acquire(e.pointerId, z, e.clientX, e.clientY);
    }
    r.x = e.clientX; r.y = e.clientY;
    if (Math.abs(r.x - r.ox) > MOVE_CLICK || Math.abs(r.y - r.oy) > MOVE_CLICK) r.far = true;
    if (r.kind === "look") lookTo(r); else drawThumb();
  }, { passive: true });
  window.addEventListener("pointerup", function (e) {
    delete canvasDown[e.pointerId];
    var r = endRole(e.pointerId);
    // the press that closed the sheet: its own click follows within a moment; that click is swallowed and nothing after it
    if (suppress.any && suppress.pid === e.pointerId) {
      if (!suppress.up) { suppress.up = true; suppress.until = performance.now() + 150; }
      return;
    }
    // the click that ends a drag is swallowed at its own target only; every other click is a real one
    if (r && r.far) suppress = { until: performance.now() + 400, target: e.target, any: false, pid: -1 };
  }, { passive: true });
  // a cancelled, lost or left pointer ends its role too, so she never gets stuck walking
  ["pointerleave", "lostpointercapture"].forEach(function (ev) {
    canvas.addEventListener(ev, function (e) { endRole(e.pointerId); }, { passive: true });
  });
  window.addEventListener("pointercancel", function (e) {
    delete canvasDown[e.pointerId]; endRole(e.pointerId);
    if (suppress.any && suppress.pid === e.pointerId) suppress = { until: 0, target: null, any: false, pid: -1 };   // no click will follow a cancelled press
  }, { passive: true });
  document.addEventListener("touchend", function (e) { if (!e.touches || e.touches.length === 0) { canvasDown = {}; releaseAll(); } }, { passive: true });
  document.addEventListener("touchcancel", function () { canvasDown = {}; releaseAll(); }, { passive: true });
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  function clearKeys() { keys.l = keys.r = keys.up = keys.dn = keys.shift = false; syncHolding(); }
  window.addEventListener("blur", function () { releaseAll(); clearKeys(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { releaseAll(); clearKeys(); if (strip.cancel) strip.cancel(); save(); if (SW.audio) SW.audio.suspend(); }
    else if (st.started) wake();
  });
  // a press outside the open More sheet closes it and does nothing else; the click that follows it is swallowed too,
  // and only that one: the swallow ends a moment after that press is lifted, so the next real tap always lands.
  // The top bar (Sound, More) is not "outside": those buttons act, and close the sheet themselves.
  window.addEventListener("pointerdown", function (e) {
    wake();
    if (suppress.any) suppress = { until: 0, target: null, any: false, pid: -1 };   // a new press ends any swallow left over
    if (!sheetOpen() || sheet.contains(e.target) || $("tools").contains(e.target)) return;
    closeSheet();
    e.preventDefault(); e.stopPropagation();
    suppress = { until: performance.now() + 10000, target: null, any: true, pid: e.pointerId, up: false };
  }, true);
  // ---------- keyboard: arrows or A/D walk while held (Shift is brisk), up/down look, T turns around ----------
  // Keys are never taken while focus is in the sheet or on a card, and never with Ctrl, Meta or Alt held.
  function keyFree(e) {
    if (!st.started || e.ctrlKey || e.metaKey || e.altKey || sheetOpen()) return false;
    var t = e.target;
    return !(t && t.closest && t.closest("#sheet, #card, #start, #needlink, #loadfail"));
  }
  function keyName(e) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") return "l";
    if (k === "ArrowRight" || k === "d" || k === "D") return "r";
    if (k === "ArrowUp") return "up";
    if (k === "ArrowDown") return "dn";
    if (k === "t" || k === "T") return "t";
    return null;
  }
  window.addEventListener("keydown", function (e) {
    wake();
    if (e.key === "Escape" && sheetOpen()) { closeSheet(); return; }
    var n = keyName(e);
    if (!n || !keyFree(e)) return;
    e.preventDefault();
    keys.shift = e.shiftKey;
    if (n === "t") { if (!e.repeat && !st.jumping) turnAround(); return; }
    keys[n] = true; syncHolding();
  });
  window.addEventListener("keyup", function (e) {
    var n = keyName(e);
    keys.shift = e.shiftKey;
    if (!n || n === "t") return;
    keys[n] = false;
    if ((n === "up" || n === "dn") && !looker()) st.gazeGoal = snapGaze(st.gazeGoal);
    syncHolding();
  });
  window.addEventListener("click", function (e) {
    var now = performance.now();
    if (now < suppress.until && (suppress.any ? !sheet.contains(e.target) : e.target === suppress.target)) {
      suppress = { until: 0, target: null, any: false, pid: -1 }; e.preventDefault(); e.stopPropagation(); return;
    }
    wake();
  }, true);
  window.addEventListener("pagehide", function () { if (strip.cancel) strip.cancel(); save(); });
  var wasLandscape = window.innerWidth > window.innerHeight;
  window.addEventListener("resize", function () {
    // turning the phone moves every zone under a finger that is down: let go of all of them
    var land = window.innerWidth > window.innerHeight;
    if (land !== wasLandscape) { wasLandscape = land; canvasDown = {}; releaseAll(); clearKeys(); if (strip.cancel) strip.cancel(); }
    R.resize(dprCap); showRest(); placeTurn(); if (strip.ready) { strip.layout(); strip.update(); }
  });

  // ---------- quality: drop resolution if frames are slow ----------
  var dprCap = 1.5, ftSum = 0, ftN = 0, qualityChecked = false;

  // ---------- main loop ----------
  var last = 0, pairR = false;
  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.016;
    last = ts;
    if (document.hidden) return;
    st.t += dt;
    st.frames++;

    if (!qualityChecked && st.started) {
      ftSum += dt; ftN++;
      if (ftN === 90) {
        qualityChecked = true;
        if (ftSum / ftN > 1 / 40 && dprCap > 1) { dprCap = 1; R.resize(dprCap); }
      }
    }

    var wk = walker(), kd = wk ? 0 : keyDir();
    st.flipHold = Math.max(0, st.flipHold - dt);
    if (st.started && !st.jumping) {
      // the way she faces follows the thumb (or the arrow key); a flip waits out FLIP_HOLD, so a wiggle cannot flip her every frame
      var want = kd, ddx = wk ? wk.x - wk.ox : 0;
      if (wk && Math.abs(ddx) >= DEAD) want = ddx > 0 ? 1 : -1;
      if (want && want !== st.dir && st.flipHold <= 0) faceWay(want);
      // arrow up/down move the gaze while held
      if (!looker() && (keys.up !== keys.dn)) st.gazeGoal = clamp(st.gazeGoal + (keys.up ? 1 : -1) * dt * 1.1, -1, 1);
    }
    var walking = st.started && st.holding && !st.jumping;
    var targetSpeed = walking ? (wk ? paceSpeed(wk) : kd ? (keys.shift ? SPEED : KEY_PACE) : SPEED) : 0;
    if (st.flipHold > 0) { st.speed *= Math.exp(-dt * 16); targetSpeed = 0; }   // eased to a stop, never a hard zero
    else st.speed += (targetSpeed - st.speed) * Math.min(1, dt * (targetSpeed > st.speed ? 2.2 : 3.5));
    if (st.speed < 0.02 && targetSpeed < 0.02) st.speed = 0;
    var ns = st.s + st.dir * st.speed * dt;
    var atEnd = false;
    if (ns > S_MAX) { ns = S_MAX; atEnd = true; }
    if (ns < S_MIN) { ns = S_MIN; atEnd = true; }
    var moved = Math.abs(ns - st.s);
    st.s = ns;
    if (atEnd) st.speed = 0;
    if (st.started) { st.walked += moved; if (!walkedOnce && st.walked >= HINT_METRES) markWalked(); }
    if (st.hour !== null) st.dusk = duskForHour(st.hour);
    else {
      // dusk advances only with walking, eased: slow in golden hour, quicker in the blue hour
      var rate = 1 / DUSK_DIST * (st.dusk < 0.25 ? 0.8 : st.dusk < 0.7 ? 1.25 : 1.0);
      st.dusk = Math.min(1, st.dusk + moved * rate);
    }
    var hour = hourNow();

    if (st.speed > 0.15) st.stillFor = 0; else st.stillFor += dt;
    // gaze follows her look drag (quickly while the finger is down, gently to its snap after); nothing else turns her
    st.gaze += (st.gazeGoal - st.gaze) * Math.min(1, dt * (looker() ? 14 : 7));
    if (Math.abs(st.gazeGoal - st.gaze) < 0.002) st.gaze = st.gazeGoal;
    st.yaw = WALK_YAW + st.gaze * (LEAN_YAW - WALK_YAW);

    updateLamps(dt, hour);

    var heading = W.heading(st.s);
    var fwd = st.dir > 0 ? heading : (heading + 180) % 360;
    // water is on the left going out (dir +1) and on the right coming back
    var view = st.dir > 0 ? fwd - st.yaw : fwd + st.yaw;

    // turn-around button near the ends (also while a card is open)
    var nearEnd = st.started && ((st.dir > 0 && st.s > S_MAX - 40) || (st.dir < 0 && st.s < S_MIN + 40));
    if (nearEnd) placeTurn();
    turnEl.style.display = nearEnd && st.speed < 0.5 ? "block" : "none";

    var pn = st.started ? placeName(st.s) : "";
    if (pn !== placeNow) {
      placeNow = pn;
      clearTimeout(placeTimer);
      placeEl.classList.remove("on");
      if (pn) placeTimer = setTimeout(function () { placeEl.textContent = placeNow; if (placeNow) placeEl.classList.add("on"); }, 400);
    }

    var frameState = {
      s: st.s, dir: st.dir, view: view, dusk: st.dusk, hour: hour, t: st.t, season: season, lampOn: st.lampOn,
      lateral: 0.4, speed: st.speed, stillFor: st.stillFor, yaw: st.yaw, gaze: st.gaze, withAvatar: st.withAvatar, started: st.started, sky: st.sky
    };
    if (strip.ready) strip.update();
    if (SW.people) SW.people.update(dt, frameState);
    var pav = SW.people && SW.people.avatar && SW.people.avatar.screen;
    if (pav && isFinite(pav.x) && (pav.x > window.innerWidth / 2) !== pairR) { pairR = !pairR; document.body.classList.toggle("pairR", pairR); }   // which side the pair stands: a short landscape card docks to the other
    if (SW.dialogue && st.started && !st.jumping) SW.dialogue.update(dt, frameState);
    R.frame(frameState);
    if (SW.audio && st.started) SW.audio.update({
      walking: st.speed > 0.3, speed: st.speed / SPEED, dusk: st.dusk, s: st.s, L: W.L,
      hour: hour, crowd: SW.people ? SW.people.crowdNear(st.s) : 0, season: season.kind, migrants: !!season.migrants
    });
    if (st.frames % 120 === 0 && st.started) save();
  }

  // ---------- jump strip: the dam as one flattened curve, a stone at each real landmark ----------
  var STONES = [
    { key: "boatclub", s: Math.max(S_MIN + 4, W.pierS - 16), name: "Boat Club",
      icon: "M2 9h12l-2 4H4z M8 9V3l3 4" },
    { key: "vendors", s: 230, name: "The vendors",
      icon: "M2 5h12l-1 4H3z M4 9v4 M12 9v4" },
    { key: "steps", s: W.stairs[0], name: "Steps down to the jogging trail",
      icon: "M2 13h4v-3h4V7h4V4" },
    { key: "middle", s: Math.round(W.L / 2), name: "Middle of the dam",
      icon: "M8 2v3 M5 6h6l-1 4H6z M8 10v4 M6 14h4" },
    { key: "regulator", s: Math.round(W.L - 60), name: "Regulator End",
      icon: "M3 3v10 M8 3v10 M13 3v10 M3 7h10 M3 10h10" }
  ];
  // where the dusk would be had she walked there from the Boat Club at the natural rate
  function naturalDusk(dist) {
    var d = 0, m;
    for (m = 0; m < dist; m++) d = Math.min(1, d + 1 / DUSK_DIST * (d < 0.25 ? 0.8 : d < 0.7 ? 1.25 : 1.0));
    return d;
  }
  var strip = (function () {
    var el = $("jumps"), me = null, VBW = 1000, VBH = 48, PAD = 3, MIN_GAP = 34, DOT_CLEAR = 17;
    var api = { ready: false }, stoneEls = [], padPx = 12, spanPx = 300;
    function xPct(s) { return PAD + (100 - 2 * PAD) * s / W.L; }
    // the curve sideways: arc length along, the bow (distance from the straight start-to-end line) up and down
    function bow() {
      var p0 = W.pos(0), p1 = W.pos(W.L), dx = p1[0] - p0[0], dy = p1[1] - p0[1], c = Math.hypot(dx, dy) || 1, mx = 1, out = [], s, p, b;
      for (s = 0; s <= W.L + 0.01; s += 8) {
        p = W.pos(s); b = ((p[0] - p0[0]) * -dy + (p[1] - p0[1]) * dx) / c;
        out.push(b); if (Math.abs(b) > mx) mx = Math.abs(b);
      }
      return { b: out, k: 10 / mx };
    }
    var B = null;
    function yAt(s) {
      var f = Math.max(0, Math.min(B.b.length - 1.001, s / 8)), i = Math.floor(f), t = f - i;
      return VBH / 2 - (B.b[i] + (B.b[i + 1] - B.b[i]) * t) * B.k;
    }
    function xPx(s) { return padPx + spanPx * s / W.L; }
    function sOfX(x) { return clamp((x - padPx) / spanPx * W.L, 0, W.L); }
    // display positions: the true spots, nudged apart (order kept) so no two stones ever overlap on a small phone;
    // the selection logic, the stones and the dot all use these
    api.layout = function () {
      var w = el.clientWidth || window.innerWidth, i, xs = [];
      padPx = w * PAD / 100; spanPx = w - 2 * padPx;
      for (i = 0; i < STONES.length; i++) xs.push(xPx(STONES[i].s));
      for (i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1] + MIN_GAP) xs[i] = xs[i - 1] + MIN_GAP;
      if (xs[xs.length - 1] > w - padPx) {
        xs[xs.length - 1] = w - padPx;
        for (i = xs.length - 2; i >= 0; i--) if (xs[i] > xs[i + 1] - MIN_GAP) xs[i] = xs[i + 1] - MIN_GAP;
      }
      for (i = 0; i < STONES.length; i++) {
        STONES[i]._x = xs[i];
        if (stoneEls[i]) { stoneEls[i].style.left = xs[i] + "px"; stoneEls[i].style.top = yAt(sOfX(xs[i])) + "px"; }
      }
    };
    api.build = function () {
      if (api.ready) { el.style.display = "block"; return; }
      B = bow();
      var d = "", s;
      for (s = 0; s <= W.L + 0.01; s += 8) d += (d ? "L" : "M") + (VBW * xPct(s) / 100).toFixed(1) + " " + yAt(s).toFixed(1);
      // parsed as HTML, so the svg needs no namespace URL
      el.innerHTML = '<svg viewBox="0 0 ' + VBW + " " + VBH + '" preserveAspectRatio="none"><path d="' + d +
        '" fill="none" stroke="rgba(246,239,228,0.38)" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
      el.style.display = "block";
      STONES.forEach(function (o) {
        var b = document.createElement("button");
        b.className = "stone"; b.dataset.key = o.key; b.dataset.s = String(o.s); b.setAttribute("aria-label", o.name);
        b.innerHTML = '<i></i><svg viewBox="0 0 16 16"><path d="' + o.icon + '"/></svg>';
        // pointer input goes through the strip; this click is for a keyboard or a screen reader
        b.addEventListener("click", function (e) { e.stopPropagation(); wake(); jumpTo(o); });
        b._stone = o;
        el.appendChild(b); stoneEls.push(b);
      });
      me = document.createElement("div"); me.className = "me"; el.appendChild(me);
      api.layout();
      api.ready = true; api.update();
      wire();
    };
    // ---- the strip as one thumb target: press selects the nearest stone, slide moves it, release jumps ----
    // A release jumps only if the press began on the strip, the stone's name has been on screen for HOLD_MIN ms, and the
    // finger did not travel a whole strip width sideways. A press that is dragged sideways at once (over 30 px in the
    // first 150 ms) is a walk, not a jump: it is handed to the joystick.
    var press = null, CANCEL_UP = 30, WALK_PX = 30, WALK_MS = 150, TAP_PX = 12;   // { id, sel, t0, shownAt, x0, y0, lx, travel }
    function nearest(clientX) {
      var r = el.getBoundingClientRect(), best = null, bd = 1e9;
      STONES.forEach(function (o) {
        var d = Math.abs(r.left + o._x - clientX);
        if (d < bd) { bd = d; best = o; }
      });
      return best;
    }
    function show(o) {
      var bs = el.querySelectorAll(".stone");
      for (var i = 0; i < bs.length; i++) bs[i].classList.toggle("sel", !!o && bs[i]._stone === o);
      if (o) {
        clearTimeout(placeTimer);
        placeEl.textContent = o.name; placeEl.classList.add("on");
      }
    }
    function cancel() {
      if (!press) return;
      press = null; show(null);
      clearTimeout(placeTimer); placeEl.classList.remove("on"); placeNow = "";
    }
    api.cancel = cancel;
    function wire() {
      el.addEventListener("pointerdown", function (e) {
        if (!st.started || st.jumping) return;
        if (press) cancel();   // a press that never ended (the page was hidden, a finger lost) must not leave the strip dead
        e.preventDefault(); e.stopPropagation();
        wake();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or older WebKit */ }
        var now = performance.now();
        press = { id: e.pointerId, sel: nearest(e.clientX), t0: now, shownAt: now, x0: e.clientX, y0: e.clientY, lx: e.clientX, travel: 0 };
        show(press.sel);
      }, { passive: false });
      el.addEventListener("pointermove", function (e) {
        if (!press || e.pointerId !== press.id) return;
        var now = performance.now();
        press.travel += Math.abs(e.clientX - press.lx); press.lx = e.clientX;
        if (now - press.t0 <= WALK_MS && Math.abs(e.clientX - press.x0) > WALK_PX) {
          var id = press.id, x0 = press.x0, y0 = press.y0;
          cancel();
          var wr = acquire(id, "walk", x0, y0);   // the stick centre is where the thumb landed
          wr.x = e.clientX; wr.y = e.clientY; wr.far = true; drawThumb();
          return;
        }
        if (e.clientY < el.getBoundingClientRect().top - CANCEL_UP) { cancel(); return; }
        var o = nearest(e.clientX);
        if (o !== press.sel) { press.sel = o; press.shownAt = now; show(o); }
      }, { passive: true });
      el.addEventListener("pointerup", function (e) {
        if (!press || e.pointerId !== press.id) return;
        var o = press.sel, off = e.clientY < el.getBoundingClientRect().top - CANCEL_UP;
        var shown = performance.now() - press.shownAt, wide = press.travel >= (el.clientWidth || window.innerWidth);
        // a plain tap (the finger barely moved) jumps at once, however short; only a slide along the strip has to
        // rest on its stone for HOLD_MIN, so a stone passed over on the way is never the one jumped to
        var tap = press.travel < TAP_PX;
        if (off || wide || (!tap && shown < HOLD_MIN)) { cancel(); return; }
        press = null; show(null);
        jumpTo(o);
      }, { passive: true });
      el.addEventListener("pointercancel", function (e) { if (press && e.pointerId === press.id) cancel(); }, { passive: true });
      el.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
      el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
      window.addEventListener("blur", cancel);
    }
    // the position dot rides the curve at her place, stepping aside (never over a stone) when she stands at one
    api.update = function () {
      // at a stone the dot rides straight above it (never beside it, so it is never ambiguous between two close stones,
      // and never past the end of the strip); elsewhere it rides the curve
      var x = xPx(st.s), best = null, bd = 1e9, y;
      STONES.forEach(function (o) { var d = Math.abs(x - o._x); if (d < bd) { bd = d; best = o; } });
      if (best && bd < DOT_CLEAR) { x = best._x; y = yAt(sOfX(x)) - DOT_CLEAR - 1; }
      else y = yAt(sOfX(x));
      me.style.left = x + "px"; me.style.top = y + "px";
    };
    return api;
  })();

  var fadeEl = $("fade"), jumpT1 = 0, jumpT2 = 0, restartT1 = 0, restartT2 = 0;
  function jumpTo(o) {
    if (!st.started || st.jumping) return;
    st.jumping = true;
    st.speed = 0;                      // fingers that are down stay down: she walks on again when the fade is over
    fadeEl.style.opacity = "1";
    var tJump = performance.now();
    // the move happens only once the screen is really dark: a tap during another fade (a time change) starts the dip
    // part way, so a fixed 320 ms is not enough; wait for the fade itself (at most 700 ms, then go anyway)
    function whenDark() {
      var op = parseFloat(getComputedStyle(fadeEl).opacity);
      if (op < 0.99 && performance.now() - tJump < 700) { jumpT1 = setTimeout(whenDark, 30); return; }
      moveNow();
    }
    jumpT1 = setTimeout(whenDark, 320);
    function moveNow() {
      st.s = clamp(o.s, S_MIN, S_MAX);
      // onward is away from the start; at the two ends it is the way back
      if (o.key === "regulator") st.dir = -1; else if (o.key === "boatclub") st.dir = 1;
      st.gaze = st.gazeGoal = 0; st.yaw = WALK_YAW; st.stillFor = 0;
      // the light belongs to the place: in "with the walk" mode it is the natural dusk there (it may go back); a chosen hour stays
      if (st.hour === null) st.dusk = naturalDusk(st.s);
      setLampsNow(hourNow());
      if (SW.people && SW.people.place) SW.people.place(st.s, st.dir);
      if (SW.dialogue && SW.dialogue.afterJump) SW.dialogue.afterJump();
      placeNow = placeName(st.s); clearTimeout(placeTimer);
      placeEl.textContent = o.name; placeEl.classList.add("on");
      placeTimer = setTimeout(function () { placeEl.classList.remove("on"); }, 3600);
      save();
      fadeEl.style.opacity = "0";
      jumpT2 = setTimeout(function () { st.jumping = false; }, 380);
    }
  }

  // ---------- start ----------
  function start(withAvatar) {
    var saved = load();
    if (saved && qS === null && !q.fresh) {
      st.s = saved.s; st.dir = saved.dir; st.dusk = saved.dusk;
      if (!own(q, "hour") || validHour(q.hour) === null) st.hour = saved.hour;
      if (saved.seasonKind) setSeason(saved.seasonKind);
      st.muted = saved.muted;
      if (SW.dialogue && saved.dlg) SW.dialogue.loadState(saved.dlg);
      setLampsNow(hourNow());       // lamps already lit stay lit
    }
    st.withAvatar = withAvatar;
    st.started = true;
    $("start").style.display = "none";
    // the controls behind the start screen could not be reached until now (they are inert in the page)
    ["top", "jumps", "turn", "card", "sheet"].forEach(function (id) { $(id).removeAttribute("inert"); });
    if (SW.audio) { SW.audio.init(); SW.audio.setMuted(st.muted); }
    soundLabel();
    strip.build(); showRest();
    if (SW.dialogue) SW.dialogue.start({ withAvatar: withAvatar, resumed: !!saved, hour: hourNow() });
    save();
  }
  $("goWith").addEventListener("click", function () { wake(); start(true); });
  $("goAlone").addEventListener("click", function () { wake(); start(false); });

  // the sound button is a toggle with one fixed name, "Sound"; aria-pressed says whether it is on, and the icon shows it
  function soundLabel() {
    var b = $("bSound");
    b.setAttribute("aria-label", "Sound");
    b.setAttribute("aria-pressed", st.muted ? "false" : "true");
    b.classList.toggle("off", st.muted);
  }
  $("bSound").addEventListener("click", function () {
    wake();
    if (sheetOpen()) closeSheet();    // a top-bar button acts and closes the sheet
    st.muted = !st.muted; if (SW.audio) SW.audio.setMuted(st.muted); soundLabel(); save();
  });
  // An explicit turn wins over a stick that is still held the old way (the stick is re-centred where the thumb is),
  // and the gaze eases back with the lean instead of snapping.
  function turnAround() {
    st.dir = -st.dir; st.stillFor = 0; st.gazeGoal = 0; st.flipHold = FLIP_HOLD;
    var w = walker(); if (w) { w.ox = w.x; w.oy = w.y; drawThumb(); }
    var l = looker(); if (l) { l.ox = l.x; l.oy = l.y; l.g0 = st.gazeGoal; }
    save();
  }
  turnEl.addEventListener("click", function () { wake(); turnAround(); });
  // start again: fade out, put everything back (the time of day she chose stays), fade in. It cancels a jump in flight.
  function restart() {
    clearTimeout(jumpT1); clearTimeout(jumpT2); clearTimeout(restartT1); clearTimeout(restartT2); clearTimeout(timeT1); clearTimeout(timeT2);
    timePending = null;
    if (strip.cancel) strip.cancel();
    st.jumping = true; st.speed = 0;
    fadeEl.style.opacity = "1";
    if (SW.dialogue) SW.dialogue.reset();
    restartT1 = setTimeout(function () {
      st.s = 14; st.dir = 1; st.stillFor = 0; st.gaze = st.gazeGoal = 0; st.yaw = WALK_YAW; st.speed = 0;
      st.dusk = st.hour === null ? 0 : duskForHour(st.hour);
      setLampsNow(hourNow());
      if (SW.people && SW.people.place) SW.people.place(st.s, st.dir);
      save();
      fadeEl.style.opacity = "0";
      restartT2 = setTimeout(function () { st.jumping = false; }, 380);
    }, 320);
  }
  if (SW.dialogue) {
    SW.dialogue.on("turn", turnAround);
    SW.dialogue.on("headback", function () { if (st.dir > 0) turnAround(); });   // "let's head back": toward the Boat Club, whichever way she faces now
    SW.dialogue.on("restart", restart); SW.dialogue.on("save", save);
  }

  // ---------- settings sheet ----------
  var sheet = $("sheet");
  function sheetOpen() { return sheet.style.display === "block"; }
  function sel(row, val) {
    Array.prototype.forEach.call($(row).children, function (b) {
      var on = b.dataset.v === val;
      b.classList.toggle("sel", on); b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  var TIMES = [["auto", "With the walk"], ["6", "Daybreak"], ["9", "Morning"], ["14", "Afternoon"], ["17.5", "Golden hour"], ["19", "Dusk"], ["21", "Night"]];
  // a time choice: "auto" follows the walk; an hour fixes the light (dusk then stops advancing and follows the hour).
  // The change dips through the black fade like a jump; the light and the crowd are switched under it.
  var timeT1 = 0, timeT2 = 0, timePending = null;
  function timeVal() { return st.hour === null ? "auto" : String(st.hour); }
  function applyTime(v) {
    if (v === "auto") { if (st.hour !== null) { st.hour = null; st.dusk = naturalDusk(st.s); } }
    else { var h = validHour(v); if (h === null) return; st.hour = h; st.dusk = duskForHour(h); }
    setLampsNow(hourNow());
    if (SW.pixPeople && SW.pixPeople.resync) SW.pixPeople.resync();
    if (SW.dialogue && SW.dialogue.setHour) SW.dialogue.setHour(hourNow());
    save();
  }
  function setTime(v) {
    if (v !== "auto" && validHour(v) === null) return;
    if (v === (timePending !== null ? timePending : timeVal())) return;
    clearTimeout(timeT1); clearTimeout(timeT2);
    if (st.jumping) { timePending = null; applyTime(v); return; }   // a fade is already running: the light changes under it
    timePending = v;
    fadeEl.style.opacity = "1";
    var tTime = performance.now();
    function whenDark() {   // as for a jump: change the light and the crowd only once the screen is really dark
      if (parseFloat(getComputedStyle(fadeEl).opacity) < 0.99 && performance.now() - tTime < 700) { timeT1 = setTimeout(whenDark, 30); return; }
      timePending = null;
      applyTime(v);
      if (!st.jumping) fadeEl.style.opacity = "0";   // a jump or a restart that began meanwhile owns the fade
    }
    timeT1 = setTimeout(whenDark, 320);
  }
  function makeRow(row, opts, onPick) {
    var r = $(row); r.innerHTML = "";
    opts.forEach(function (o) {
      var b = document.createElement("button"); b.textContent = o[1]; b.dataset.v = o[0];
      b.addEventListener("click", function () { wake(); onPick(o[0]); sel(row, o[0]); });
      r.appendChild(b);
    });
  }
  function buildSheet() {
    makeRow("rowWho", [["with", "AI Simar"], ["alone", "Just me"]], function (v) {
      st.withAvatar = v === "with"; if (SW.dialogue) SW.dialogue.setAvatar(st.withAvatar); save();
    });
    makeRow("rowTalk", [["often", "Often"], ["quiet", "Quietly"]], function (v) {
      if (SW.dialogue) SW.dialogue.setQuiet(v === "quiet"); save();
    });
    makeRow("rowTime", TIMES, setTime);
    makeRow("rowSeason", [["", "Today"], ["winter", "Winter"], ["spring", "Spring"], ["summer", "Summer"], ["monsoon", "Monsoon"]], function (v) { setSeason(v || null); save(); });
    makeRow("rowSky", [["real", "Real"], ["dusk", "Pink dusk"]], function (v) { st.sky = v; save(); });
    var sk = $("rowSky");
    if (ART !== "pixel") { sk.hidden = true; sk.previousElementSibling.hidden = true; }   // the first-person art has no sky palette
  }
  buildSheet();
  function sure(on) { $("rowSure").hidden = !on; $("rowRestart").hidden = !!on; }
  function openSheet() {
    releaseAll(); clearKeys(); if (strip.cancel) strip.cancel();   // a finger that was walking stops walking under the sheet
    sheet.style.display = "block"; sheet.scrollTop = 0;
    document.body.classList.add("sheeting");
    $("bMore").setAttribute("aria-expanded", "true");
    sel("rowWho", st.withAvatar ? "with" : "alone");
    sel("rowTalk", SW.dialogue && SW.dialogue.isQuiet() ? "quiet" : "often");
    sel("rowTime", timeVal()); sel("rowSeason", st.seasonKind || ""); sel("rowSky", st.sky);
    sure(false);
    try { sheet.focus({ preventScroll: true }); } catch (e) { /* old browser: focus stays put */ }
  }
  function closeSheet() {
    var a = document.activeElement, inside = a && sheet.contains(a);
    sheet.style.display = "none"; document.body.classList.remove("sheeting"); sure(false);
    $("bMore").setAttribute("aria-expanded", "false");
    // focus goes back to More (unless it already sits on another control, as after a tap on Sound)
    if (inside || !a || a === document.body) { try { $("bMore").focus({ preventScroll: true }); } catch (e) { /* old browser */ } }
  }
  // the sheet is a dialog: Tab stays inside it
  sheet.addEventListener("keydown", function (e) {
    if (e.key !== "Tab") return;
    var f = Array.prototype.filter.call(sheet.querySelectorAll("button"), function (b) { return !b.disabled && b.offsetParent !== null; });
    if (!f.length) return;
    var a = document.activeElement, first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (a === first || a === sheet)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  });
  $("bMore").addEventListener("click", function () { wake(); if (sheetOpen()) closeSheet(); else openSheet(); });
  $("bClose").addEventListener("click", function () { wake(); closeSheet(); });
  $("bTurn2").addEventListener("click", function () { wake(); turnAround(); closeSheet(); });
  // the button that was pressed is hidden by the swap, so focus moves to one that stays visible (it would drop out of the dialog)
  $("bRestart").addEventListener("click", function () { wake(); sure(true); $("bNo").focus(); });
  $("bNo").addEventListener("click", function () { wake(); sure(false); $("bRestart").focus(); });
  $("bYes").addEventListener("click", function () { wake(); closeSheet(); restart(); });

  R.init(canvas);
  requestAnimationFrame(loop);
  if (q.autostart) SW.whenReady(function () { start(q.autostart !== "alone"); });

  // read-only view for gates and debugging
  SW.debug = {
    state: st, get season() { return season; }, turnAround: turnAround,
    setHold: function (v) { debugHold = !!v; syncHolding(); }, save: save, stones: STONES,
    zone: { of: zoneOf, top: zoneTopY, bottom: zoneBottomY }
  };
})();
