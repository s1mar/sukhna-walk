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

  var SPEED = 5.0;          // metres per second while walking
  var DUSK_DIST = 2300;     // metres of walking from golden hour to night
  var WALK_YAW = 26;      // look this far toward the water while walking
  var LEAN_YAW = 90;        // face the water when stopped
  var LEAN_AFTER = 0.9;     // seconds still before turning to the water
  var S_MIN = 6, S_MAX = W.L - 8;

  var q = {};
  location.search.replace(/^\?/, "").split("&").forEach(function (kv) {
    if (!kv) return; var p = kv.split("="); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || "");
  });

  var st = {
    s: 14, dir: 1, dusk: 0, speed: 0, yaw: WALK_YAW, holding: false, stillFor: 0,
    t: 0, started: false, withAvatar: true, seasonKind: null, muted: false, frames: 0,
    lampOn: new Float32Array(W.lamps.length), lampLit: new Uint8Array(W.lamps.length)
  };
  var season = SW.season.today();

  // ---------- save / restore (Messenger reloads the page when it comes back) ----------
  var KEY = "sukhna-walk-v1";
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ s: st.s, dir: st.dir, dusk: st.dusk, withAvatar: st.withAvatar,
        seasonKind: st.seasonKind, muted: st.muted, dlg: SW.dialogue ? SW.dialogue.saveState() : null, at: Date.now() }));
    } catch (e) { /* private mode or blocked storage: the walk still works */ }
  }
  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && typeof v.s === "number" ? v : null; }
    catch (e) { return null; }
  }

  // ---------- debug / test hooks (used by gates; harmless for her) ----------
  if (q.s) st.s = Math.max(S_MIN, Math.min(S_MAX, +q.s));
  if (q.dusk) st.dusk = Math.max(0, Math.min(1, +q.dusk));
  if (q.dir) st.dir = +q.dir < 0 ? -1 : 1;
  if (q.lean) st.yaw = LEAN_YAW;
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
  var placeEl = $("place"), placeNow = "";
  function placeName() {
    if (st.s < 130) return "Boat Club";
    if (st.s > W.L - 180) return "Regulator End";
    for (var i = 0; i < W.stairs.length; i++) if (Math.abs(st.s - W.stairs[i]) < 18) return "Steps down to the jogging trail";
    return "";
  }

  // ---------- input: hold anywhere on the scene to walk ----------
  var activePointers = {};
  function anyHeld() { for (var k in activePointers) return true; return false; }
  canvas.addEventListener("pointerdown", function (e) {
    if (!st.started) return;
    e.preventDefault();
    activePointers[e.pointerId] = 1;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* older WebKit */ }
    st.holding = true;
    if (SW.audio) SW.audio.resume();
    hideHint();
  }, { passive: false });
  function release(e) {
    if (e && e.pointerId !== undefined) delete activePointers[e.pointerId]; else activePointers = {};
    st.holding = anyHeld();
  }
  ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach(function (ev) {
    canvas.addEventListener(ev, release, { passive: true });
  });
  // an up or cancel anywhere (even off the canvas) ends the walk, so she never gets stuck walking
  ["pointerup", "pointercancel"].forEach(function (ev) { window.addEventListener(ev, release, { passive: true }); });
  document.addEventListener("touchend", function (e) { if (!e.touches || e.touches.length === 0) release(); }, { passive: true });
  document.addEventListener("touchcancel", function () { release(); }, { passive: true });
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  window.addEventListener("blur", function () { release(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { release(); save(); if (SW.audio) SW.audio.suspend(); }
    else if (st.started && SW.audio) SW.audio.resume();
  });
  window.addEventListener("pagehide", save);
  window.addEventListener("resize", function () { R.resize(dprCap); });

  var hintShown = true;
  function hideHint() { if (hintShown) { $("hint").style.opacity = "0"; hintShown = false; } }

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
    var walking = st.started && st.holding;
    var targetSpeed = walking ? SPEED : 0;
    st.speed += (targetSpeed - st.speed) * Math.min(1, dt * (walking ? 2.2 : 3.5));
    if (st.speed < 0.02 && !walking) st.speed = 0;
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
    var yawTarget = st.stillFor > LEAN_AFTER ? LEAN_YAW : WALK_YAW;
    st.yaw += (yawTarget - st.yaw) * Math.min(1, dt * (yawTarget === LEAN_YAW ? 1.4 : 2.6));

    updateLamps(dt);

    var heading = W.heading(st.s);
    var fwd = st.dir > 0 ? heading : (heading + 180) % 360;
    // water is on the left going out (dir +1) and on the right coming back
    var view = st.dir > 0 ? fwd - st.yaw : fwd + st.yaw;

    // turn-around button near the ends
    var nearEnd = st.started && ((st.dir > 0 && st.s > S_MAX - 40) || (st.dir < 0 && st.s < S_MIN + 40));
    $("turn").style.display = nearEnd && st.speed < 0.5 && !dialogBusy ? "block" : "none";

    var pn = st.started ? placeName() : "";
    if (pn !== placeNow) {
      placeNow = pn;
      placeEl.classList.remove("on");
      if (pn) setTimeout(function () { placeEl.textContent = placeNow; if (placeNow) placeEl.classList.add("on"); }, 400);
    }

    var frameState = {
      s: st.s, dir: st.dir, view: view, dusk: st.dusk, t: st.t, season: season, lampOn: st.lampOn,
      lateral: 0.4, speed: st.speed, stillFor: st.stillFor, yaw: st.yaw, withAvatar: st.withAvatar, started: st.started
    };
    if (SW.people) SW.people.update(dt, frameState);
    if (SW.dialogue && st.started) SW.dialogue.update(dt, frameState);
    R.frame(frameState);
    if (SW.audio && st.started) SW.audio.update({
      walking: st.speed > 0.3, speed: st.speed / SPEED, dusk: st.dusk, s: st.s, L: W.L,
      crowd: SW.people ? SW.people.crowdNear(st.s) : 0, season: season.kind, migrants: !!season.migrants
    });
    if (st.frames % 120 === 0 && st.started) save();
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
    if (SW.dialogue) SW.dialogue.start({ withAvatar: withAvatar, resumed: !!saved });
    save();
  }
  $("goWith").addEventListener("click", function () { start(true); });
  $("goAlone").addEventListener("click", function () { start(false); });

  function soundLabel() { $("bSound").textContent = st.muted ? "Sound off" : "Sound on"; }
  $("bSound").addEventListener("click", function () {
    st.muted = !st.muted; if (SW.audio) SW.audio.setMuted(st.muted); soundLabel(); save();
  });
  function turnAround() { st.dir = -st.dir; st.stillFor = 0; st.yaw = WALK_YAW; save(); }
  $("turn").addEventListener("click", turnAround);
  function restart() {
    st.s = 14; st.dir = 1; st.dusk = 0; st.stillFor = 0;
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
  }
  buildSheet();
  $("bMore").addEventListener("click", function () {
    var open = sheet.style.display === "block";
    sheet.style.display = open ? "none" : "block";
    sel("rowWho", st.withAvatar ? "with" : "alone"); sel("rowSeason", st.seasonKind || "");
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
    setHold: function (v) { st.holding = !!v; }, save: save
  };
})();
