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

  var SPEED = 5.0;          // metres per second at a brisk walk (the far end of the pace drag)
  var STROLL = 1.2;         // metres per second at the slowest walk
  var DUSK_DIST = 2300;     // metres of walking from golden hour to night
  var WALK_YAW = 26;      // look this far toward the water while looking along the path (gaze 0)
  var LEAN_YAW = 90;        // face the water square on (gaze 1)
  var S_MIN = 6, S_MAX = W.L - 8;
  var ZONE_TOP = 0.72;      // the bottom 28 percent of the screen is the thumb zone
  var STRIP_RESERVE = 58;   // px kept free at the very bottom for the jump strip (plus the safe area)
  var DEAD = 8, CAP = 70, BACKSPAN = 40;   // pace drag: dead zone, full-pace distance, slow-to-stop distance (px)
  var LOOK_PX = 200;        // a look drag of this many px sweeps the whole gaze range
  var MOVE_CLICK = 10;      // a gesture that moved further than this never fires a click

  var q = {};
  location.search.replace(/^\?/, "").split("&").forEach(function (kv) {
    if (!kv) return; var p = kv.split("="); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
  });

  var st = {
    s: 14, dir: 1, dusk: 0, speed: 0, yaw: WALK_YAW, gaze: 0, gazeGoal: 0, holding: false, stillFor: 0, jumping: false,
    t: 0, started: false, withAvatar: true, seasonKind: null, muted: false, sky: "real", frames: 0,
    lampOn: new Float32Array(W.lamps.length), lampLit: new Uint8Array(W.lamps.length)
  };
  var season = SW.season.today();

  // ---------- save / restore (Messenger reloads the page when it comes back) ----------
  var KEY = "sukhna-walk-v1";
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ s: st.s, dir: st.dir, dusk: st.dusk, withAvatar: st.withAvatar,
        seasonKind: st.seasonKind, muted: st.muted, sky: st.sky, dlg: SW.dialogue ? SW.dialogue.saveState() : null, at: Date.now() }));
    } catch (e) { /* private mode or blocked storage: the walk still works */ }
  }
  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && typeof v.s === "number" ? v : null; }
    catch (e) { return null; }
  }

  // ---------- debug / test hooks (used by gates; harmless for her) ----------
  if (q.s) st.s = Math.max(S_MIN, Math.min(S_MAX, +q.s));
  if (q.dusk) st.dusk = Math.max(0, Math.min(1, +q.dusk));
  // the sky palette: a URL choice beats the saved one; the saved one applies even on a ?s= or ?fresh visit
  var savedAtBoot = load();
  if (savedAtBoot && (savedAtBoot.sky === "dusk" || savedAtBoot.sky === "real")) st.sky = savedAtBoot.sky;
  if (q.sky === "dusk" || q.sky === "real") st.sky = q.sky;
  if (q.dir) st.dir = +q.dir < 0 ? -1 : 1;
  if (q.lean) { st.gaze = st.gazeGoal = 1; st.yaw = LEAN_YAW; }   // gates and shots: start turned to the lake
  if (q.gaze) { st.gaze = st.gazeGoal = Math.max(-1, Math.min(1, +q.gaze)); st.yaw = WALK_YAW + st.gaze * (LEAN_YAW - WALK_YAW); }
  if (q.season && SW.season.KINDS[q.season]) { st.seasonKind = q.season; season = SW.season.pick(q.season); }

  function setSeason(kind) {
    st.seasonKind = kind;
    season = kind ? SW.season.pick(kind) : SW.season.today();
  }

  // ---------- lamps: switch on in sequence near her once it is dark enough ----------
  function updateLamps(dt) {
    var threshold = 0.18;
    for (var i = 0; i < W.lamps.length; i++) {
      if (!st.lampLit[i] && st.dusk > threshold) {
        // lamps light from her position outward, a few seconds apart
        var ds = Math.abs(W.lamps[i] - st.s);
        var need = threshold + Math.min(0.12, ds / 4000);
        if (st.dusk >= need || ds < 60) st.lampLit[i] = 1;
      }
      var target = st.lampLit[i] ? 1 : 0;
      st.lampOn[i] += (target - st.lampOn[i]) * Math.min(1, dt * 1.2);
      if (st.lampOn[i] < 0.002) st.lampOn[i] = 0;
    }
  }

  // ---------- place names (only real ones) ----------
  var placeEl = $("place"), placeNow = "", placeTimer = 0;
  function placeName(s) {
    if (s < 130) return "Boat Club";
    if (s > W.L - 180) return "Regulator End";
    for (var i = 0; i < W.stairs.length; i++) if (Math.abs(s - W.stairs[i]) < 18) return "Steps down to the jogging trail";
    return "";
  }

  // ---------- input: two roles, chosen by where a finger lands ----------
  //   bottom thumb zone: PACE. The touch point is an origin; dragging further toward the way she faces
  //     walks faster, dragging back slows to a stop, letting go stops.
  //   anywhere above it: LOOK. A horizontal drag sets the gaze between the path (0) and the lake (1).
  //   each pointerId keeps its own role, so one finger can walk while another looks.
  var roles = {};            // pointerId -> { kind, ox, oy, x, y, g0, far }
  var debugHold = false;     // SW.debug.setHold: the gates' brisk walk without a finger
  var suppressClickUntil = 0;
  var thumbKey = "sukhna-walk-thumb-v1", walkedOnce = false;
  try { walkedOnce = localStorage.getItem(thumbKey) === "1"; } catch (e) { /* storage blocked: the ring shows each visit */ }
  var restEl = $("rest"), ringEl = $("tring"), dotEl = $("tdot");
  var safeProbe = document.createElement("div");
  safeProbe.style.cssText = "position:fixed;left:0;bottom:0;width:0;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(safeProbe);
  function safeBottom() { return safeProbe.offsetHeight || 0; }
  function zoneBottomY() { return window.innerHeight - safeBottom() - STRIP_RESERVE; }
  function zoneOf(y) {
    if (y > zoneBottomY()) return "none";          // the home indicator and the jump strip rows start nothing
    return y >= window.innerHeight * ZONE_TOP ? "walk" : "look";
  }
  function placeRest() {
    restEl.style.left = "50%";
    restEl.style.top = Math.round((window.innerHeight * ZONE_TOP + zoneBottomY()) / 2) + "px";
  }
  function showRest() { restEl.style.display = st.started && !walkedOnce ? "block" : "none"; if (st.started && !walkedOnce) placeRest(); }
  function easeS(t) { return t * t * (3 - 2 * t); }
  // walking speed for a pace drag: a touch (or a drag inside the dead zone) strolls, further toward the
  // way she faces eases up to SPEED at CAP px, dragging back eases down to a stop
  function paceSpeed(r) {
    var f = (r.x - r.ox) * st.dir;                 // facing out (dir +1) is rightward on screen
    if (f <= -DEAD) return STROLL * (1 - easeS(Math.min(1, (-f - DEAD) / BACKSPAN)));
    if (f <= DEAD) return STROLL;
    return STROLL + (SPEED - STROLL) * easeS(Math.min(1, (f - DEAD) / (CAP - DEAD)));
  }
  function walker() { for (var k in roles) if (roles[k].kind === "walk") return roles[k]; return null; }
  function looker() { for (var k in roles) if (roles[k].kind === "look") return roles[k]; return null; }
  function syncHolding() { st.holding = !!walker() || debugHold; }
  function drawThumb() {
    var w = walker();
    if (!w) { ringEl.style.display = "none"; dotEl.style.display = "none"; return; }
    var dx = Math.max(-CAP, Math.min(CAP, w.x - w.ox));
    ringEl.style.display = dotEl.style.display = "block";
    ringEl.style.left = w.ox + "px"; ringEl.style.top = w.oy + "px";
    dotEl.style.left = (w.ox + dx) + "px"; dotEl.style.top = w.oy + "px";
  }
  function snapGaze(g) { return Math.abs(g) < 0.15 ? 0 : g > 0.85 ? 1 : g; }
  function lookTo(r) {
    var g = r.g0 - (r.x - r.ox) * st.dir / LOOK_PX;   // toward the lake side of the screen raises the gaze
    st.gazeGoal = Math.max(-1, Math.min(1, g));
  }
  function endRole(id, fromUp) {
    var r = roles[id]; if (!r) return;
    delete roles[id];
    if (r.far && fromUp) suppressClickUntil = performance.now() + 400;
    if (r.kind === "look") st.gazeGoal = snapGaze(st.gazeGoal);
    syncHolding(); drawThumb();
  }
  function releaseAll() {
    for (var id in roles) endRole(id, false);
    debugHold = false; syncHolding(); drawThumb();
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (!st.started || st.jumping || roles[e.pointerId]) return;
    e.preventDefault();
    var z = zoneOf(e.clientY);
    if (z === "none") return;
    if (z === "walk" ? walker() : looker()) return;   // one finger per role
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or older WebKit */ }
    var r = roles[e.pointerId] = { kind: z, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, g0: st.gazeGoal, far: false };
    if (SW.audio) SW.audio.resume();
    if (z === "walk") {
      if (!walkedOnce) {
        walkedOnce = true; restEl.style.display = "none";
        try { localStorage.setItem(thumbKey, "1"); } catch (err2) { /* private mode */ }
      }
      syncHolding(); drawThumb();
    }
  }, { passive: false });
  window.addEventListener("pointermove", function (e) {
    var r = roles[e.pointerId]; if (!r) return;
    r.x = e.clientX; r.y = e.clientY;
    if (Math.abs(r.x - r.ox) > MOVE_CLICK || Math.abs(r.y - r.oy) > MOVE_CLICK) r.far = true;
    if (r.kind === "look") lookTo(r); else drawThumb();
  }, { passive: true });
  window.addEventListener("pointerup", function (e) { endRole(e.pointerId, true); }, { passive: true });
  // a cancelled, lost or left pointer ends its role too, so she never gets stuck walking
  ["pointercancel", "pointerleave", "lostpointercapture"].forEach(function (ev) {
    canvas.addEventListener(ev, function (e) { endRole(e.pointerId, false); }, { passive: true });
  });
  window.addEventListener("pointercancel", function (e) { endRole(e.pointerId, false); }, { passive: true });
  document.addEventListener("touchend", function (e) { if (!e.touches || e.touches.length === 0) releaseAll(); }, { passive: true });
  document.addEventListener("touchcancel", function () { releaseAll(); }, { passive: true });
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  window.addEventListener("blur", function () { releaseAll(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { releaseAll(); save(); if (SW.audio) SW.audio.suspend(); }
    else if (st.started && SW.audio) SW.audio.resume();
  });
  // a drag that moved is not a tap: no click may follow it
  window.addEventListener("click", function (e) {
    if (performance.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  window.addEventListener("pagehide", save);
  window.addEventListener("resize", function () { R.resize(dprCap); showRest(); });

  // ---------- quality: drop resolution if frames are slow ----------
  var dprCap = 1.5, ftSum = 0, ftN = 0, qualityChecked = false;

  // ---------- main loop ----------
  var last = 0;
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

    var dialogBusy = SW.dialogue && SW.dialogue.isOpen && SW.dialogue.isOpen();
    var walking = st.started && st.holding && !st.jumping;
    var wk = walker();
    var targetSpeed = walking ? (wk ? paceSpeed(wk) : SPEED) : 0;
    st.speed += (targetSpeed - st.speed) * Math.min(1, dt * (targetSpeed > st.speed ? 2.2 : 3.5));
    if (st.speed < 0.02 && targetSpeed < 0.02) st.speed = 0;
    var ns = st.s + st.dir * st.speed * dt;
    var atEnd = false;
    if (ns > S_MAX) { ns = S_MAX; atEnd = true; }
    if (ns < S_MIN) { ns = S_MIN; atEnd = true; }
    var moved = Math.abs(ns - st.s);
    st.s = ns;
    if (atEnd) st.speed = 0;
    // dusk advances only with walking, eased: slow in golden hour, quicker in the blue hour
    var rate = 1 / DUSK_DIST * (st.dusk < 0.25 ? 0.8 : st.dusk < 0.7 ? 1.25 : 1.0);
    st.dusk = Math.min(1, st.dusk + moved * rate);

    if (st.speed > 0.15) st.stillFor = 0; else st.stillFor += dt;
    // gaze follows her look drag (quickly while the finger is down, gently to its snap after); nothing else turns her
    st.gaze += (st.gazeGoal - st.gaze) * Math.min(1, dt * (looker() ? 14 : 7));
    if (Math.abs(st.gazeGoal - st.gaze) < 0.002) st.gaze = st.gazeGoal;
    st.yaw = WALK_YAW + st.gaze * (LEAN_YAW - WALK_YAW);

    updateLamps(dt);

    var heading = W.heading(st.s);
    var fwd = st.dir > 0 ? heading : (heading + 180) % 360;
    // water is on the left going out (dir +1) and on the right coming back
    var view = st.dir > 0 ? fwd - st.yaw : fwd + st.yaw;

    // turn-around button near the ends
    var nearEnd = st.started && ((st.dir > 0 && st.s > S_MAX - 40) || (st.dir < 0 && st.s < S_MIN + 40));
    $("turn").style.display = nearEnd && st.speed < 0.5 && !dialogBusy ? "block" : "none";

    var pn = st.started ? placeName(st.s) : "";
    if (pn !== placeNow) {
      placeNow = pn;
      clearTimeout(placeTimer);
      placeEl.classList.remove("on");
      if (pn) placeTimer = setTimeout(function () { placeEl.textContent = placeNow; if (placeNow) placeEl.classList.add("on"); }, 400);
    }

    var frameState = {
      s: st.s, dir: st.dir, view: view, dusk: st.dusk, t: st.t, season: season, lampOn: st.lampOn,
      lateral: 0.4, speed: st.speed, stillFor: st.stillFor, yaw: st.yaw, gaze: st.gaze, withAvatar: st.withAvatar, started: st.started, sky: st.sky
    };
    if (strip.ready) strip.update();
    if (SW.people) SW.people.update(dt, frameState);
    if (SW.dialogue && st.started) SW.dialogue.update(dt, frameState);
    R.frame(frameState);
    if (SW.audio && st.started) SW.audio.update({
      walking: st.speed > 0.3, speed: st.speed / SPEED, dusk: st.dusk, s: st.s, L: W.L,
      crowd: SW.people ? SW.people.crowdNear(st.s) : 0, season: season.kind, migrants: !!season.migrants
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
  // where the dusk would be had she walked there from the Boat Club at the natural rate (never used to go back)
  function naturalDusk(dist) {
    var d = 0, m;
    for (m = 0; m < dist; m++) d = Math.min(1, d + 1 / DUSK_DIST * (d < 0.25 ? 0.8 : d < 0.7 ? 1.25 : 1.0));
    return d;
  }
  var strip = (function () {
    var el = $("jumps"), me = null, ys = null, VBW = 1000, VBH = 48, PAD = 3;
    var api = { ready: false };
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
    api.build = function () {
      if (api.ready) { el.style.display = "block"; return; }
      B = bow();
      var d = "", s;
      for (s = 0; s <= W.L + 0.01; s += 8) d += (d ? "L" : "M") + (VBW * xPct(s) / 100).toFixed(1) + " " + yAt(s).toFixed(1);
      // parsed as HTML, so the svg needs no namespace URL
      el.innerHTML = '<svg viewBox="0 0 ' + VBW + " " + VBH + '" preserveAspectRatio="none"><path d="' + d +
        '" fill="none" stroke="rgba(246,239,228,0.38)" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
      STONES.forEach(function (o) {
        var b = document.createElement("button");
        b.className = "stone"; b.dataset.key = o.key; b.dataset.s = String(o.s); b.setAttribute("aria-label", o.name);
        b.style.left = xPct(o.s) + "%"; b.style.top = yAt(o.s) + "px";
        b.innerHTML = '<i></i><svg viewBox="0 0 16 16"><path d="' + o.icon + '"/></svg>';
        // pointer input goes through the strip; this click is for a keyboard or a screen reader
        b.addEventListener("click", function (e) { e.stopPropagation(); jumpTo(o); });
        b._stone = o;
        el.appendChild(b);
      });
      me = document.createElement("div"); me.className = "me"; el.appendChild(me);
      el.style.display = "block"; api.ready = true; api.update();
      wire();
    };
    // ---- the strip as one thumb target: press selects the nearest stone, slide moves it, release jumps ----
    var press = null, CANCEL_UP = 30;   // { id, sel, cancelled }
    function nearest(clientX) {
      var r = el.getBoundingClientRect(), best = null, bd = 1e9;
      STONES.forEach(function (o) {
        var d = Math.abs(r.left + r.width * xPct(o.s) / 100 - clientX);
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
        if (!st.started || st.jumping || press) return;
        e.preventDefault(); e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or older WebKit */ }
        press = { id: e.pointerId, sel: nearest(e.clientX) };
        show(press.sel);
      }, { passive: false });
      el.addEventListener("pointermove", function (e) {
        if (!press || e.pointerId !== press.id) return;
        if (e.clientY < el.getBoundingClientRect().top - CANCEL_UP) { cancel(); return; }
        var o = nearest(e.clientX);
        if (o !== press.sel) { press.sel = o; show(o); }
      }, { passive: true });
      el.addEventListener("pointerup", function (e) {
        if (!press || e.pointerId !== press.id) return;
        var o = press.sel, off = e.clientY < el.getBoundingClientRect().top - CANCEL_UP;
        if (off) { cancel(); return; }
        press = null; show(null);
        jumpTo(o);
      }, { passive: true });
      el.addEventListener("pointercancel", function (e) { if (press && e.pointerId === press.id) cancel(); }, { passive: true });
      el.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
      el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
      window.addEventListener("blur", cancel);
    }
    api.update = function () { me.style.left = xPct(st.s) + "%"; me.style.top = yAt(st.s) + "px"; };
    return api;
  })();

  var fadeEl = $("fade");
  function jumpTo(o) {
    if (!st.started || st.jumping) return;
    st.jumping = true;
    releaseAll(); st.speed = 0;
    fadeEl.style.opacity = "1";
    setTimeout(function () {
      st.s = Math.max(S_MIN, Math.min(S_MAX, o.s));
      // onward is away from the start; at the two ends it is the way back
      if (o.key === "regulator") st.dir = -1; else if (o.key === "boatclub") st.dir = 1;
      st.gaze = st.gazeGoal = 0; st.yaw = WALK_YAW; st.stillFor = 0;
      st.dusk = Math.max(st.dusk, naturalDusk(st.s));     // the light never runs backward
      if (st.dusk > 0.2) for (var i = 0; i < W.lamps.length; i++) { st.lampLit[i] = 1; st.lampOn[i] = 1; }
      if (SW.people && SW.people.place) SW.people.place(st.s, st.dir);
      if (SW.dialogue && SW.dialogue.afterJump) SW.dialogue.afterJump();
      placeNow = placeName(st.s); clearTimeout(placeTimer);
      placeEl.textContent = o.name; placeEl.classList.add("on");
      placeTimer = setTimeout(function () { placeEl.classList.remove("on"); }, 3600);
      save();
      fadeEl.style.opacity = "0";
      setTimeout(function () { st.jumping = false; }, 380);
    }, 320);
  }

  // ---------- start ----------
  function start(withAvatar) {
    var saved = load();
    if (saved && !q.s && !q.fresh) {
      st.s = Math.max(S_MIN, Math.min(S_MAX, saved.s)); st.dir = saved.dir === -1 ? -1 : 1;
      st.dusk = Math.max(0, Math.min(1, saved.dusk || 0));
      if (saved.seasonKind) setSeason(saved.seasonKind);
      st.muted = !!saved.muted;
      if (SW.dialogue && saved.dlg) SW.dialogue.loadState(saved.dlg);
      // lamps already lit stay lit
      for (var i = 0; i < W.lamps.length; i++) if (st.dusk > 0.2) { st.lampLit[i] = 1; st.lampOn[i] = 1; }
    }
    st.withAvatar = withAvatar;
    st.started = true;
    $("start").style.display = "none";
    if (SW.audio) { SW.audio.init(); SW.audio.setMuted(st.muted); }
    soundLabel();
    strip.build(); showRest();
    if (SW.dialogue) SW.dialogue.start({ withAvatar: withAvatar, resumed: !!saved });
    save();
  }
  $("goWith").addEventListener("click", function () { start(true); });
  $("goAlone").addEventListener("click", function () { start(false); });

  function soundLabel() { $("bSound").textContent = st.muted ? "Sound off" : "Sound on"; }
  $("bSound").addEventListener("click", function () {
    st.muted = !st.muted; if (SW.audio) SW.audio.setMuted(st.muted); soundLabel(); save();
  });
  function turnAround() { st.dir = -st.dir; st.stillFor = 0; st.gaze = st.gazeGoal = 0; st.yaw = WALK_YAW; save(); }
  $("turn").addEventListener("click", turnAround);
  function restart() {
    st.s = 14; st.dir = 1; st.dusk = 0; st.stillFor = 0; st.gaze = st.gazeGoal = 0;
    for (var i = 0; i < W.lamps.length; i++) { st.lampLit[i] = 0; st.lampOn[i] = 0; }
    if (SW.dialogue) SW.dialogue.reset();
    save();
  }
  if (SW.dialogue) { SW.dialogue.on("turn", turnAround); SW.dialogue.on("restart", restart); }

  // settings sheet
  var sheet = $("sheet");
  function sel(row, val) {
    Array.prototype.forEach.call($(row).children, function (b) { b.classList.toggle("sel", b.dataset.v === val); });
  }
  function buildSheet() {
    var who = $("rowWho"); who.innerHTML = "";
    [["with", "AI Simar"], ["alone", "Just me"]].forEach(function (o) {
      var b = document.createElement("button"); b.textContent = o[1]; b.dataset.v = o[0];
      b.addEventListener("click", function () {
        st.withAvatar = o[0] === "with"; if (SW.dialogue) SW.dialogue.setAvatar(st.withAvatar); sel("rowWho", o[0]); save();
      });
      who.appendChild(b);
    });
    var rs = $("rowSeason"); rs.innerHTML = "";
    [["", "Today"], ["winter", "Winter"], ["spring", "Spring"], ["summer", "Summer"], ["monsoon", "Monsoon"]].forEach(function (o) {
      var b = document.createElement("button"); b.textContent = o[1]; b.dataset.v = o[0];
      b.addEventListener("click", function () { setSeason(o[0] || null); sel("rowSeason", o[0]); save(); });
      rs.appendChild(b);
    });
    var sk = $("rowSky"); sk.innerHTML = "";
    if (ART !== "pixel") { sk.hidden = true; sk.previousElementSibling.hidden = true; }   // the first-person art has no sky palette
    [["real", "Real"], ["dusk", "Pink dusk"]].forEach(function (o) {
      var b = document.createElement("button"); b.textContent = o[1]; b.dataset.v = o[0];
      b.addEventListener("click", function () { st.sky = o[0]; sel("rowSky", o[0]); save(); });
      sk.appendChild(b);
    });
  }
  buildSheet();
  $("bMore").addEventListener("click", function () {
    var open = sheet.style.display === "block";
    sheet.style.display = open ? "none" : "block";
    sel("rowWho", st.withAvatar ? "with" : "alone"); sel("rowSeason", st.seasonKind || ""); sel("rowSky", st.sky);
  });
  $("bClose").addEventListener("click", function () { sheet.style.display = "none"; });
  $("bTurn2").addEventListener("click", function () { turnAround(); sheet.style.display = "none"; });
  $("bRestart").addEventListener("click", function () { restart(); sheet.style.display = "none"; });

  R.init(canvas);
  requestAnimationFrame(loop);
  if (q.autostart) SW.whenReady(function () { start(q.autostart !== "alone"); });

  // read-only view for gates and debugging
  SW.debug = {
    state: st, get season() { return season; }, turnAround: turnAround,
    setHold: function (v) { debugHold = !!v; syncHolding(); }, save: save, stones: STONES
  };
})();
