// Stargazing. At night (19:30 to 5:00) near the Regulator End a button lets her look up: the view tilts up off
// the dam to the stars over the Shivaliks (drawn by sideview.js from SW.stargazeK). The button turns into the way
// back; walking, a tap on the scene, or leaving the spot also brings her back. AI Simar's card about it is the
// "stars" topic in lines.js; its "I do" reply calls the "stars" act. The button words come from SW.lines.STARS
// (the approved script); with no STARS (the generic edition) this file does nothing. Nothing here is saved.
(function () {
  "use strict";
  var NEAR = 260, EASE_S = 1.2;
  var on = false, k = 0, last = 0, sAt = 0, btn = null;
  SW.stargazeK = 0;

  function st() { return SW.debug && SW.debug.state; }
  function hour() { var S = SW.dialogue && SW.dialogue._state; return S && typeof S.hour === "number" ? S.hour : 17.5; }
  function night() { var h = hour(); return h >= 19.5 || h < 5; }
  function nearEnd() { var s = st(), L = SW.world && SW.world.L; return !!s && typeof L === "number" && s.s >= L - NEAR; }
  function can() { var s = st(); return !!s && s.started && night() && nearEnd(); }

  function enter() { if (!can()) return; on = true; var s = st(); sAt = s.s; paint(); }
  function leave() { if (!on) return; on = false; paint(); }
  function paint() {
    var N = SW.lines.STARS;
    btn.textContent = on ? N.down : N.up;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function tick(t) {
    var dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
    var s = st();
    if (on && (!can() || (s && Math.abs(s.s - sAt) > 0.5))) leave();   // she walked on, the night ended, or she left the spot
    k = on ? Math.min(1, k + dt / EASE_S) : Math.max(0, k - dt / EASE_S);   // a steady tilt, EASE_S each way
    SW.stargazeK = k;
    btn.classList.toggle("on", can() || on);
    requestAnimationFrame(tick);
  }
  function init() {
    var N = SW.lines && SW.lines.STARS;
    if (!N || typeof N.up !== "string") return;   // the generic edition: no stargazing
    btn = document.createElement("button");
    btn.id = "bLook"; btn.className = "ui";
    btn.addEventListener("click", function (e) { e.stopPropagation(); if (on) leave(); else enter(); });
    document.body.appendChild(btn);
    paint();
    if (SW.dialogue && SW.dialogue.on) SW.dialogue.on("stars", enter);
    // a tap on the scene while looking up brings her back
    var c = document.querySelector("canvas");
    if (c) c.addEventListener("pointerdown", function () { if (on) leave(); }, { passive: true });
    SW.stars = { enter: enter, leave: leave, isOn: function () { return on; }, available: can };
    requestAnimationFrame(tick);
  }
  if (SW.whenReady) SW.whenReady(init); else init();
})();
