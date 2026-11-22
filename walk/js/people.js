// Life on the dam: trees, people, vendors, boats, the two ends, and AI Simar.
// Everything is placed in world metres and handed to the renderer as depth-sorted drawables.
(function () {
  "use strict";
  var W = SW.world, R = SW.render;
  var hash = R.hash, sm = R.smoothstep;

  // ---------- drawing helpers ----------
  function lit(base, f, s, lat) { return R.shade(base, f, R.lightAt(s, lat)); }
  function C(base, f, s, lat, a) { return R.css(lit(base, f, s, lat), a); }

  // A person seen from behind or front: legs, body, arms, head. sp = foot point on screen.
  function person(ctx, sp, o) {
    var k = sp.k, h = o.h * k;
    if (h < 2.5) return;
    var x = sp.x, y = sp.y;
    var body = C(o.cloth, sp.f, o.s, o.lat), legs = C(o.lower, sp.f, o.s, o.lat), skin = C(o.skin, sp.f, o.s, o.lat);
    if (h < 7) { // far away: a soft capsule is enough
      ctx.fillStyle = body;
      ctx.fillRect(x - h * 0.12, y - h, h * 0.24, h);
      return;
    }
    var sw = o.moving ? Math.sin(o.phase) * 0.3 : 0;
    var hipY = y - h * 0.49, shY = y - h * 0.81;
    var bw = h * (o.wide || 0.115); // half shoulder width
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // legs, with a little knee bend as they swing
    ctx.strokeStyle = legs; ctx.lineWidth = Math.max(1, h * 0.085);
    ctx.beginPath();
    ctx.moveTo(x - h * 0.045, hipY); ctx.lineTo(x - h * 0.045 + sw * h * 0.1, y - h * 0.25); ctx.lineTo(x - h * 0.045 + sw * h * 0.2, y - h * 0.02);
    ctx.moveTo(x + h * 0.045, hipY); ctx.lineTo(x + h * 0.045 - sw * h * 0.1, y - h * 0.25); ctx.lineTo(x + h * 0.045 - sw * h * 0.2, y - h * 0.02);
    ctx.stroke();
    // body: rounded shoulders, a kurta or long coat hangs lower
    var hem = o.long ? y - h * 0.3 : hipY + h * 0.03;
    var flare = o.long ? 1.08 : 0.92;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x - bw * 0.55, shY - h * 0.015);
    ctx.quadraticCurveTo(x - bw * 1.02, shY - h * 0.005, x - bw * 1.0, shY + h * 0.07);
    ctx.lineTo(x - bw * flare, hem);
    ctx.lineTo(x + bw * flare, hem);
    ctx.lineTo(x + bw * 1.0, shY + h * 0.07);
    ctx.quadraticCurveTo(x + bw * 1.02, shY - h * 0.005, x + bw * 0.55, shY - h * 0.015);
    ctx.closePath(); ctx.fill();
    // arms swing opposite the legs
    ctx.strokeStyle = body; ctx.lineWidth = Math.max(1, h * 0.07);
    ctx.beginPath();
    ctx.moveTo(x - bw * 0.92, shY + h * 0.05); ctx.lineTo(x - bw * 1.05 - sw * h * 0.07, hipY + h * 0.01);
    ctx.moveTo(x + bw * 0.92, shY + h * 0.05); ctx.lineTo(x + bw * 1.05 + sw * h * 0.07, hipY + h * 0.01);
    ctx.stroke();
    // neck, head, hair
    ctx.fillStyle = skin;
    ctx.fillRect(x - h * 0.025, shY - h * 0.05, h * 0.05, h * 0.06);
    ctx.beginPath(); ctx.ellipse(x, shY - h * 0.095, h * 0.06, h * 0.072, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = C(o.hair, sp.f, o.s, o.lat);
    ctx.beginPath(); ctx.ellipse(x, shY - h * 0.11, h * 0.062, h * 0.062, 0, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
    if (o.back) { ctx.beginPath(); ctx.ellipse(x, shY - h * 0.09, h * 0.06, h * 0.065, 0, 0, 6.283); ctx.fill(); }
    if (o.shawl) { // a shawl over the shoulders, falling a little at the back
      ctx.fillStyle = C(o.shawl, sp.f, o.s, o.lat);
      ctx.beginPath();
      ctx.moveTo(x - bw * 1.05, shY + h * 0.06);
      ctx.quadraticCurveTo(x, shY - h * 0.04, x + bw * 1.05, shY + h * 0.06);
      ctx.lineTo(x + bw * 0.7, shY + h * 0.16);
      ctx.quadraticCurveTo(x, shY + h * 0.2, x - bw * 0.7, shY + h * 0.16);
      ctx.closePath(); ctx.fill();
    }
    if (o.stick) {
      ctx.strokeStyle = C([90, 70, 50], sp.f, o.s, o.lat); ctx.lineWidth = Math.max(1, h * 0.025);
      ctx.beginPath(); ctx.moveTo(x + bw * 1.1, hipY); ctx.lineTo(x + bw * 1.4, y); ctx.stroke();
    }
  }

  // ---------- palettes (muted evening clothes; winter adds shawls and jackets) ----------
  var CLOTH = [[150, 60, 70], [70, 90, 140], [200, 190, 170], [90, 120, 90], [120, 80, 130], [190, 140, 80], [60, 60, 70], [230, 225, 215], [160, 90, 60]];
  var SKIN = [[150, 105, 80], [130, 90, 65], [170, 125, 95], [115, 80, 60]];
  var HAIR = [[30, 25, 25], [40, 32, 28], [90, 90, 90], [200, 200, 200]];

  // ---------- population ----------
  var people = [];
  var TYPES = ["walk", "walk", "walk", "walk", "brisk", "brisk", "elder", "elder", "couple", "couple", "family", "jog"];
  for (var i = 0; i < 90; i++) {
    var ty = TYPES[Math.floor(hash(i + 1) * TYPES.length)];
    var spd = { walk: 1.2, brisk: 1.7, elder: 0.9, couple: 1.0, family: 1.0, jog: 2.8 }[ty] * (0.85 + hash(i + 2) * 0.3);
    var lat = -3.6 + hash(i + 3) * 6.2;
    if (Math.abs(lat - 0.4) < 0.9) lat += lat > 0.4 ? 1.0 : -1.0; // leave her line clear
    people.push({
      i: i, type: ty, s: hash(i + 4) * W.L, lat: lat, v: spd, dir: hash(i + 5) < 0.5 ? 1 : -1,
      r: hash(i + 6), phase: hash(i + 7) * 6.28, on: true,
      cloth: CLOTH[Math.floor(hash(i + 8) * CLOTH.length)], cloth2: CLOTH[Math.floor(hash(i + 9) * CLOTH.length)],
      skin: SKIN[Math.floor(hash(i + 10) * SKIN.length)], hair: HAIR[ty === "elder" ? 2 + Math.floor(hash(i + 11) * 2) : Math.floor(hash(i + 11) * 2)],
      h: 1.55 + hash(i + 12) * 0.25, long: hash(i + 13) < 0.45
    });
  }
  function density(s, dusk, crowd) {
    var place = s < 350 ? 1 : s < 900 ? 0.75 : s < 1800 ? 0.55 : 0.45;
    if (s > W.L - 200) place = 0.6; // people walk all the way to the spillway
    var evening = 1 - 0.65 * sm(0.45, 1, dusk); // most head home for dinner
    return place * evening * crowd;
  }

  // ---------- trees along the land side (jacaranda, amaltas and others) ----------
  var trees = [];
  for (var ts = 30, ti = 0; ts < W.L - 20; ti++) {
    trees.push({ s: ts, lat: -5.3 - hash(ti + 400) * 0.6, h: 6 + hash(ti + 401) * 3, r: 2.4 + hash(ti + 402) * 1.6, seed: ti });
    ts += 13 + hash(ti + 403) * 12;
  }

  // ---------- vendors and fixtures near the boat club and along the way ----------
  var fixtures = [
    { kind: "chai", s: 26, lat: -3.9 },
    { kind: "bhutta", s: 62, lat: -3.8 },
    { kind: "balloons", s: 96, lat: -2.6 },
    { kind: "chuski", s: 148, lat: -3.9 },
    { kind: "toys", s: 210, lat: -3.6 },
    { kind: "bhutta", s: W.stairs[1] + 12, lat: -3.8 },
    { kind: "dog", s: 470, lat: -4.1 },
    { kind: "dog", s: 1640, lat: -4.0 }
  ];

  // ---------- boats near the boat club jetty ----------
  var pier = W.points.boatPier;
  var boats = [];
  var JETTY_S = W.pierS, JETTY_FROM = 7, JETTY_TO = 34;
  for (var b = 0; b < 9; b++) {
    var moored = b < 5;
    // moored boats tie up along both sides of the jetty; the rest drift on the water
    var mp = W.at(JETTY_S + (b % 2 ? 3.2 : -3.2), 12 + Math.floor(b / 2) * 6);
    var fp = W.at(JETTY_S + 40 + hash(b + 600) * 220, 45 + hash(b + 602) * 160);
    boats.push({
      kind: b === 6 ? "shikara" : "pedal", moored: moored,
      x: moored ? mp[0] : fp[0],
      y: moored ? mp[1] : fp[1],
      a: hash(b + 603) * 6.28, col: [[200, 70, 60], [230, 190, 70], [70, 120, 190], [240, 240, 230], [90, 170, 120]][b % 5], seed: b
    });
  }
  var sculls = [{ x: 300, y: -350, vx: 3.2, vy: 1.0 }, { x: 700, y: -500, vx: -2.6, vy: 0.6 }];

  var crowdLevel = 1, crowdHere = 0;

  // ---------- AI Simar ----------
  var av = { s: 0, lat: -0.8, phase: 0, show: 0, label: "AI Simar" };

  function update(dt, fs) {
    var S = fs.s;
    crowdLevel = fs.season.crowd || 1;
    var d = density(S, fs.dusk, crowdLevel);
    var near = 0;
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      p.s += p.v * p.dir * dt;
      if (p.s > W.L - 4) { p.s = W.L - 4; p.dir = -1; }
      if (p.s < 4) { p.s = 4; p.dir = 1; }
      p.phase += dt * p.v * 3.6;
      // only change who is "out" when she cannot see them change
      var dist = Math.abs(p.s - S);
      if (dist > 90) p.on = p.r < density(p.s, fs.dusk, crowdLevel);
      if (p.on && dist < 40) near++;
    }
    crowdHere = Math.min(1, near / 8);
    for (var bi = 0; bi < boats.length; bi++) {
      var bt = boats[bi];
      if (bt.moored) continue;
      bt.a += dt * 0.05 * (hash(bi) - 0.5);
      // boating closes at dusk: drifting boats head back toward the jetty
      var home = sm(0.2, 0.5, fs.dusk);
      bt.x += (Math.sin(bt.a) * 0.4 * (1 - home) + (pier[0] + 30 - bt.x) * 0.02 * home) * dt;
      bt.y += (Math.cos(bt.a) * 0.4 * (1 - home) + (pier[1] + 10 - bt.y) * 0.02 * home) * dt;
    }
    for (var sc = 0; sc < sculls.length; sc++) {
      var u = sculls[sc];
      u.x += u.vx * dt; u.y += u.vy * dt;
      if (!W.inWater(u.x, u.y) || !W.inWater(u.x + u.vx * 15, u.y + u.vy * 15)) { u.vx = -u.vx; u.vy = -u.vy; }
    }
    // AI Simar walks a little ahead on the water side (so he is in her view while
    // she walks); when she stops he goes to the rail just beside her.
    var lean = sm(30, 80, fs.yaw);
    var wantS = S + fs.dir * (6.0 - 5.2 * lean); // leaning: 0.8 m along, about 17 deg off centre, inside the 37 deg half view
    var wantLat = (1 - lean) * 1.6 + lean * 2.7;
    av.s += (wantS - av.s) * Math.min(1, dt * 4);
    av.lat += (wantLat - av.lat) * Math.min(1, dt * 2.5);
    av.phase += dt * fs.speed * 1.25;
    var target = fs.withAvatar && fs.started ? 1 : 0;
    av.show += (target - av.show) * Math.min(1, dt * 1.5);
    queue(fs);
  }

  function queue(fs) {
    var S = fs.s, dusk = fs.dusk, ctx = R.ctx, season = fs.season;
    var winter = season.kind === "winter";

    // trees
    var bloom = season.bloom === "jacaranda" ? [150, 120, 200] : season.bloom === "amaltas" ? [230, 200, 80] : null;
    for (var ti = 0; ti < trees.length; ti++) {
      var t = trees[ti];
      if (Math.abs(t.s - S) > 420) continue;
      (function (t) {
        var p = W.at(t.s, t.lat);
        var sp = R.spot(p[0], p[1], 0);
        if (!sp || sp.x < -sp.k * 6 || sp.x > R.W + sp.k * 6) return;
        R.addDrawable({ f: sp.f, draw: function () {
          var k = sp.k, x = sp.x, y = sp.y;
          ctx.fillStyle = C([60, 48, 40], sp.f, t.s, t.lat);
          ctx.fillRect(x - 0.13 * k, y - t.h * 0.55 * k, 0.26 * k, t.h * 0.55 * k);
          var g = [44, 70, 44];
          for (var c = 0; c < 5; c++) {
            var cx = x + (hash(t.seed * 7 + c) - 0.5) * t.r * 1.2 * k;
            var cy = y - (t.h * 0.62 + hash(t.seed * 5 + c) * t.h * 0.35) * k;
            var rr = t.r * (0.55 + hash(t.seed * 3 + c) * 0.35) * k;
            var col = bloom && hash(t.seed * 11 + c) < 0.5 ? R.mix(g, bloom, 0.75) : R.mix(g, [30, 50, 36], hash(t.seed + c));
            ctx.fillStyle = C(col, sp.f, t.s, -3);
            ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.283); ctx.fill();
          }
        } });
      })(t);
    }

    // people
    for (var i = 0; i < people.length; i++) {
      var p = people[i];
      if (!p.on || Math.abs(p.s - S) > 260) continue;
      (function (p) {
        var lat = p.type === "jog" ? p.lat * 0.5 - 1 : p.lat;
        var w = W.at(p.s, lat);
        var sp = R.spot(w[0], w[1], 0);
        if (!sp || sp.x < -40 || sp.x > R.W + 40) return;
        R.addDrawable({ f: sp.f, draw: function () {
          var base = { s: p.s, lat: lat, h: p.h, cloth: p.cloth, lower: [50, 50, 60], skin: p.skin, hair: p.hair,
            moving: true, phase: p.phase, long: p.long, shawl: winter ? p.cloth2 : null, stick: p.type === "elder" };
          if (p.type === "couple") {
            var k = sp.k;
            person(ctx, { x: sp.x - 0.3 * k, y: sp.y, k: k, f: sp.f }, base);
            person(ctx, { x: sp.x + 0.3 * k, y: sp.y, k: k, f: sp.f }, Object.assign({}, base, { cloth: p.cloth2, h: p.h + 0.12, long: !p.long, phase: p.phase + 0.4 }));
          } else if (p.type === "family") {
            person(ctx, sp, base);
            person(ctx, { x: sp.x + 0.45 * sp.k, y: sp.y, k: sp.k, f: sp.f }, Object.assign({}, base, { h: 1.05, cloth: p.cloth2, long: false, phase: p.phase * 1.4, shawl: null }));
          } else {
            person(ctx, sp, Object.assign(base, { wide: p.type === "jog" ? 0.1 : 0.115 }));
          }
        } });
      })(p);
    }

    // vendors and fixtures
    for (var fi = 0; fi < fixtures.length; fi++) {
      var fx = fixtures[fi];
      if (Math.abs(fx.s - S) > 300) continue;
      (function (fx) {
        var w = W.at(fx.s, fx.lat);
        var sp = R.spot(w[0], w[1], 0);
        if (!sp || sp.x < -80 || sp.x > R.W + 80) return;
        R.addDrawable({ f: sp.f, draw: function () { drawFixture(ctx, fx, sp, fs); } });
      })(fx);
    }

    // boats and sculls (on the water)
    var wz = R.WATER_Z;
    for (var bi = 0; bi < boats.length; bi++) {
      (function (bt) {
        var sp = R.spot(bt.x, bt.y, wz);
        if (!sp || sp.f > 900 || sp.x < -60 || sp.x > R.W + 60) return;
        R.addDrawable({ f: sp.f, draw: function () { drawBoat(ctx, bt, sp, fs); } });
      })(boats[bi]);
    }
    var scullA = 1 - sm(0.15, 0.4, dusk);
    if (scullA > 0.02) {
      for (var sc = 0; sc < sculls.length; sc++) {
        (function (u) {
          var a = R.spot(u.x, u.y, wz), b = R.spot(u.x + u.vx * 2.6, u.y + u.vy * 2.6, wz);
          if (!a || !b) return;
          R.addDrawable({ f: a.f, draw: function () {
            ctx.strokeStyle = R.css(R.shade([210, 205, 190], a.f, 0), scullA);
            ctx.lineWidth = Math.max(0.8, 0.12 * a.k);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, kk = a.k;
            ctx.fillStyle = R.css(R.shade([60, 60, 70], a.f, 0), scullA);
            ctx.fillRect(mx - 0.2 * kk, my - 0.9 * kk, 0.4 * kk, 0.9 * kk);
            var sw = Math.sin(fs.t * 2.2 + u.x) * 0.9 * kk;
            ctx.beginPath(); ctx.moveTo(mx - 1.6 * kk, my + sw * 0.2); ctx.lineTo(mx + 1.6 * kk, my - sw * 0.2); ctx.stroke();
          } });
        })(sculls[sc]);
      }
    }

    // the boat-club jetty
    if (Math.abs(S - JETTY_S) < 400) jetty(ctx, fs);
    // the two ends: the entry gate with its chain, and the Regulator End gates
    if (S < 160) endGate(ctx, 0.5);
    if (S > W.L - 450) regulator(ctx, fs);

    // AI Simar
    if (av.show > 0.02) {
      var aw = W.at(av.s, av.lat);
      var asp = R.spot(aw[0], aw[1], 0);
      if (asp) {
        R.addDrawable({ f: asp.f, draw: function () {
          ctx.globalAlpha = av.show;
          person(ctx, asp, { s: av.s, lat: av.lat, h: 1.78, cloth: winter ? [44, 58, 92] : [228, 224, 214], lower: [40, 42, 52],
            skin: [140, 100, 76], hair: [24, 20, 20], moving: fs.speed > 0.2, phase: av.phase, long: !winter, shawl: winter ? [120, 110, 100] : null, wide: 0.125, back: true });
          // a faint warm outline so he reads as a guide, not a passer-by
          var top = asp.y - 1.95 * asp.k;
          var fsz = Math.max(10, Math.min(13, asp.k * 0.16));
          ctx.font = "600 " + fsz + "px -apple-system, BlinkMacSystemFont, sans-serif";
          var tw = ctx.measureText(av.label).width;
          ctx.fillStyle = "rgba(18,22,40,0.72)";
          var bx = asp.x - tw / 2 - 7, by = top - fsz - 8;
          roundRect(ctx, bx, by, tw + 14, fsz + 8, (fsz + 8) / 2); ctx.fill();
          ctx.strokeStyle = "rgba(255,214,150,0.5)"; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = "#ffcf8a";
          ctx.fillText(av.label, asp.x - tw / 2, by + fsz + 1.5);
          ctx.globalAlpha = 1;
        } });
        av.screen = { x: asp.x, y: asp.y, k: asp.k };
      }
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    ctx.lineTo(x + w, y + h - r); ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5); ctx.closePath();
  }

  function drawFixture(ctx, fx, sp, fs) {
    var k = sp.k, x = sp.x, y = sp.y, f = sp.f, t = fs.t;
    if (fx.kind === "dog") { // a dog asleep on the stones
      ctx.fillStyle = C([150, 120, 80], f, fx.s, fx.lat);
      ctx.beginPath(); ctx.ellipse(x, y - 0.16 * k, 0.45 * k, 0.16 * k, 0, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 0.4 * k, y - 0.2 * k, 0.12 * k, 0, 6.283); ctx.fill();
      return;
    }
    if (fx.kind === "balloons") {
      person(ctx, sp, { s: fx.s, lat: fx.lat, h: 1.62, cloth: [120, 100, 80], lower: [60, 55, 50], skin: [130, 92, 70], hair: [30, 26, 24], moving: false, phase: 0, long: true });
      var cols = [[230, 60, 80], [250, 200, 60], [80, 160, 230], [120, 210, 120], [240, 120, 200], [250, 250, 250]];
      ctx.strokeStyle = "rgba(220,220,220,0.5)"; ctx.lineWidth = 0.6;
      for (var b = 0; b < 9; b++) {
        var bx = x + 0.25 * k + Math.sin(b * 2.1 + t * 0.6) * 0.35 * k, by = y - (2.3 + (b % 3) * 0.32) * k;
        ctx.beginPath(); ctx.moveTo(x + 0.25 * k, y - 1.1 * k); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = C(cols[b % cols.length], f, fx.s, fx.lat);
        ctx.beginPath(); ctx.ellipse(bx, by, 0.17 * k, 0.21 * k, 0, 0, 6.283); ctx.fill();
      }
      return;
    }
    // carts: a wooden cart with two wheels, a seller beside it
    var cw = 1.5 * k, ch = 0.85 * k;
    ctx.fillStyle = C([95, 70, 50], f, fx.s, fx.lat);
    ctx.fillRect(x - cw / 2, y - ch - 0.15 * k, cw, 0.2 * k);
    ctx.fillStyle = C([40, 36, 34], f, fx.s, fx.lat);
    ctx.beginPath(); ctx.arc(x - cw * 0.3, y - 0.25 * k, 0.25 * k, 0, 6.283); ctx.arc(x + cw * 0.3, y - 0.25 * k, 0.25 * k, 0, 6.283); ctx.fill();
    var topY = y - ch - 0.15 * k;
    if (fx.kind === "bhutta") { // glowing coals and a thread of smoke
      var glow = 0.7 + 0.3 * Math.sin(t * 5 + fx.s);
      var g = ctx.createRadialGradient(x, topY, 0, x, topY, 1.4 * k);
      g.addColorStop(0, "rgba(255,120,40," + (0.55 * glow).toFixed(3) + ")"); g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = g; ctx.fillRect(x - 1.4 * k, topY - 1.4 * k, 2.8 * k, 2.8 * k);
      ctx.fillStyle = "rgba(255," + (110 + 60 * glow | 0) + ",40,0.95)";
      ctx.fillRect(x - cw * 0.35, topY - 0.08 * k, cw * 0.7, 0.1 * k);
      for (var sm2 = 0; sm2 < 5; sm2++) {
        var u = ((t * 0.25 + sm2 / 5) % 1);
        ctx.fillStyle = "rgba(200,200,205," + (0.18 * (1 - u)).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(x + Math.sin(u * 6 + sm2) * 0.3 * k, topY - u * 2.2 * k, (0.15 + u * 0.4) * k, 0, 6.283); ctx.fill();
      }
    } else if (fx.kind === "chuski") { // rows of coloured syrup bottles and a block of ice
      var sc = [[220, 40, 60], [250, 160, 40], [90, 200, 90], [80, 120, 230], [240, 80, 160]];
      for (var bb = 0; bb < 5; bb++) {
        ctx.fillStyle = C(sc[bb], f, fx.s, fx.lat);
        ctx.fillRect(x - cw * 0.4 + bb * cw * 0.17, topY - 0.32 * k, cw * 0.1, 0.3 * k);
      }
      ctx.fillStyle = C([225, 235, 240], f, fx.s, fx.lat);
      ctx.fillRect(x + cw * 0.25, topY - 0.22 * k, cw * 0.2, 0.2 * k);
    } else if (fx.kind === "chai") { // a kettle on a small flame and stacked clay cups
      ctx.fillStyle = C([150, 90, 60], f, fx.s, fx.lat);
      for (var cu = 0; cu < 4; cu++) ctx.fillRect(x - cw * 0.4 + cu * 0.13 * k, topY - 0.14 * k, 0.1 * k, 0.12 * k);
      ctx.fillStyle = C([120, 120, 125], f, fx.s, fx.lat);
      ctx.beginPath(); ctx.arc(x + cw * 0.22, topY - 0.16 * k, 0.16 * k, 0, 6.283); ctx.fill();
      ctx.fillStyle = "rgba(90,150,255,0.8)"; ctx.fillRect(x + cw * 0.14, topY - 0.02 * k, 0.16 * k, 0.03 * k);
    } else if (fx.kind === "toys") { // small spinning light toys
      for (var ty = 0; ty < 4; ty++) {
        var hue = [[255, 80, 80], [80, 255, 120], [90, 140, 255], [255, 220, 80]][(ty + Math.floor(t * 2)) % 4];
        ctx.fillStyle = R.css(hue, 0.85);
        ctx.beginPath(); ctx.arc(x - cw * 0.3 + ty * cw * 0.2, topY - 0.15 * k, 0.07 * k, 0, 6.283); ctx.fill();
      }
    }
    // a small lantern on the cart once it is dark
    if (fs.dusk > 0.3 && fx.kind !== "toys") {
      var la = R.smoothstep(0.3, 0.5, fs.dusk);
      var lg = ctx.createRadialGradient(x - cw * 0.45, topY - 0.6 * k, 0, x - cw * 0.45, topY - 0.6 * k, 0.9 * k);
      lg.addColorStop(0, "rgba(255,230,170," + (0.6 * la).toFixed(3) + ")"); lg.addColorStop(1, "rgba(255,230,170,0)");
      ctx.fillStyle = lg; ctx.fillRect(x - cw * 0.45 - 0.9 * k, topY - 1.5 * k, 1.8 * k, 1.8 * k);
    }
    // the seller standing behind the cart
    person(ctx, { x: x + cw * 0.15, y: y - 0.05 * k, k: k * 0.98, f: f }, { s: fx.s, lat: fx.lat, h: 1.65, cloth: [200, 195, 180], lower: [70, 65, 60], skin: [125, 88, 66], hair: [28, 24, 22], moving: false, phase: 0, long: true });
  }

  function drawBoat(ctx, bt, sp, fs) {
    var k = sp.k, x = sp.x, y = sp.y + Math.sin(fs.t * 1.3 + bt.seed) * 0.05 * k;
    var col = R.shade(bt.col, sp.f, 0);
    if (bt.kind === "shikara") {
      ctx.fillStyle = R.css(R.shade([110, 70, 45], sp.f, 0));
      ctx.beginPath(); ctx.moveTo(x - 2.6 * k, y - 0.4 * k); ctx.quadraticCurveTo(x, y + 0.2 * k, x + 2.6 * k, y - 0.4 * k); ctx.lineTo(x + 2.2 * k, y); ctx.lineTo(x - 2.2 * k, y); ctx.fill();
      ctx.fillStyle = R.css(R.shade([170, 60, 70], sp.f, 0));
      ctx.fillRect(x - 1.1 * k, y - 1.5 * k, 2.2 * k, 0.25 * k);
      ctx.fillStyle = R.css(R.shade([120, 100, 70], sp.f, 0));
      ctx.fillRect(x - 1.0 * k, y - 1.3 * k, 0.07 * k, 1.0 * k); ctx.fillRect(x + 0.93 * k, y - 1.3 * k, 0.07 * k, 1.0 * k);
      return;
    }
    // pedal boat: a rounded hull with a small canopy
    ctx.fillStyle = R.css(col);
    ctx.beginPath(); ctx.ellipse(x, y - 0.25 * k, 1.3 * k, 0.32 * k, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = R.css(R.mix(col, [255, 255, 255], 0.25));
    ctx.fillRect(x - 0.7 * k, y - 1.15 * k, 1.4 * k, 0.16 * k);
    ctx.fillStyle = R.css(R.shade([90, 90, 90], sp.f, 0));
    ctx.fillRect(x - 0.62 * k, y - 1.0 * k, 0.05 * k, 0.7 * k); ctx.fillRect(x + 0.57 * k, y - 1.0 * k, 0.05 * k, 0.7 * k);
    // its reflection
    ctx.fillStyle = R.css(col, 0.18);
    ctx.beginPath(); ctx.ellipse(x, y + 0.1 * k, 1.2 * k, 0.2 * k, 0, 0, 6.283); ctx.fill();
  }

  // The jetty: a low deck out over the water with posts, a lamp at its end after dark.
  function jetty(ctx, fs) {
    var z = R.WATER_Z + 0.6;
    var steps = 6;
    for (var i = 0; i < steps; i++) {
      (function (i) {
        var o0 = JETTY_FROM + (JETTY_TO - JETTY_FROM) * i / steps, o1 = JETTY_FROM + (JETTY_TO - JETTY_FROM) * (i + 1) / steps;
        var a = W.at(JETTY_S - 1.4, o0), b = W.at(JETTY_S + 1.4, o0), c = W.at(JETTY_S + 1.4, o1), d = W.at(JETTY_S - 1.4, o1);
        var pa = R.spot(a[0], a[1], z), pb = R.spot(b[0], b[1], z), pc = R.spot(c[0], c[1], z), pd = R.spot(d[0], d[1], z);
        if (!pa || !pb || !pc || !pd) return;
        var f = (pa.f + pc.f) / 2;
        R.addDrawable({ f: f + 0.5, draw: function () {
          ctx.fillStyle = R.css(R.shade([120, 104, 88], f, 0));
          ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.lineTo(pc.x, pc.y); ctx.lineTo(pd.x, pd.y); ctx.closePath(); ctx.fill();
          ctx.fillStyle = R.css(R.shade([70, 62, 56], f, 0));
          [pa, pb].forEach(function (p) { ctx.fillRect(p.x - 0.06 * p.k, p.y - 0.9 * p.k, 0.12 * p.k, 0.9 * p.k); });
        } });
      })(i);
    }
    var tip = W.at(JETTY_S, JETTY_TO), ts = R.spot(tip[0], tip[1], z);
    var on = R.smoothstep(0.25, 0.45, fs.dusk);
    if (ts && on > 0.02) R.addDrawable({ f: ts.f - 0.2, draw: function () {
      var y = ts.y - 2.4 * ts.k, r = Math.max(2, Math.min(40, 1.6 * ts.k));
      var g = ctx.createRadialGradient(ts.x, y, 0, ts.x, y, r);
      g.addColorStop(0, "rgba(255,225,170," + (0.7 * on).toFixed(3) + ")"); g.addColorStop(1, "rgba(255,225,170,0)");
      ctx.fillStyle = g; ctx.fillRect(ts.x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = "rgba(60,58,56,0.9)"; ctx.fillRect(ts.x - 0.05 * ts.k, y, 0.1 * ts.k, 2.4 * ts.k);
    } });
  }

  // The entry gate at the boat-club end: two posts and an iron chain across the wide side.
  function endGate(ctx, s) {
    var a = W.at(s, -3.5), b = W.at(s, 2.5);
    var pa = R.spot(a[0], a[1], 0), pb = R.spot(b[0], b[1], 0);
    if (!pa || !pb) return;
    R.addDrawable({ f: Math.min(pa.f, pb.f), draw: function () {
      [pa, pb].forEach(function (p) {
        ctx.fillStyle = R.css(R.shade([150, 145, 135], p.f, 0));
        ctx.fillRect(p.x - 0.25 * p.k, p.y - 1.3 * p.k, 0.5 * p.k, 1.3 * p.k);
      });
      ctx.strokeStyle = R.css(R.shade([50, 50, 55], pa.f, 0)); ctx.lineWidth = Math.max(1, 0.05 * pa.k);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y - 0.8 * pa.k);
      ctx.quadraticCurveTo((pa.x + pb.x) / 2, (pa.y + pb.y) / 2 - 0.4 * pa.k, pb.x, pb.y - 0.8 * pb.k); ctx.stroke();
    } });
  }

  // The Regulator End: a concrete gate structure on the water side and the railing where the walk ends.
  function regulator(ctx, fs) {
    var s = W.L - 2;
    var fr = W.frame(s), p = W.pos(s);
    var parts = [];
    for (var g = 0; g < 5; g++) {
      var o = 5 + g * 4.2;
      parts.push([p[0] + fr.nx * o + fr.tx * 3, p[1] + fr.ny * o + fr.ty * 3]);
    }
    var lit = R.smoothstep(0.25, 0.5, fs.dusk);
    parts.forEach(function (q, gi) {
      var base = R.spot(q[0], q[1], R.WATER_Z), top = R.spot(q[0], q[1], 1.8);
      if (!base || !top) return;
      R.addDrawable({ f: base.f, draw: function () {
        var k = base.k;
        ctx.fillStyle = R.css(R.shade([168, 162, 150], base.f, 0.2 * lit));
        ctx.fillRect(base.x - 0.6 * k, top.y, 1.2 * k, base.y - top.y);
        if (gi < 4) { // the gate between this pier and the next
          ctx.fillStyle = R.css(R.shade([96, 104, 110], base.f, 0));
          ctx.fillRect(base.x + 0.6 * k, top.y + 0.5 * k, 3.0 * k, base.y - top.y - 0.6 * k);
          ctx.fillStyle = R.css(R.shade([70, 76, 80], base.f, 0));
          for (var r = 1; r < 4; r++) ctx.fillRect(base.x + 0.6 * k, top.y + 0.5 * k + r * (base.y - top.y) * 0.22, 3.0 * k, 0.06 * k);
        }
        ctx.fillStyle = R.css(R.shade([190, 184, 172], base.f, 0.3 * lit));
        ctx.fillRect(base.x - 0.8 * k, top.y - 0.25 * k, 5.0 * k, 0.3 * k);
        if (lit > 0.05 && gi === 2) { // a work light on the gate house
          var gl = ctx.createRadialGradient(base.x, top.y - 0.4 * k, 0, base.x, top.y - 0.4 * k, 3 * k);
          gl.addColorStop(0, "rgba(255,240,210," + (0.5 * lit).toFixed(3) + ")"); gl.addColorStop(1, "rgba(255,240,210,0)");
          ctx.fillStyle = gl; ctx.fillRect(base.x - 3 * k, top.y - 3.4 * k, 6 * k, 6 * k);
        }
      } });
    });
    // railing across the end of the walk
    var ra = W.at(W.L, -4.6), rb = W.at(W.L, 3.6);
    var a = R.spot(ra[0], ra[1], 0), b = R.spot(rb[0], rb[1], 0);
    if (a && b) R.addDrawable({ f: Math.min(a.f, b.f), draw: function () {
      ctx.strokeStyle = R.css(R.shade([120, 120, 118], a.f, 0)); ctx.lineWidth = Math.max(1, 0.06 * a.k);
      ctx.beginPath(); ctx.moveTo(a.x, a.y - 1.0 * a.k); ctx.lineTo(b.x, b.y - 1.0 * b.k);
      ctx.moveTo(a.x, a.y - 0.5 * a.k); ctx.lineTo(b.x, b.y - 0.5 * b.k); ctx.stroke();
      for (var i = 0; i <= 8; i++) {
        var x = a.x + (b.x - a.x) * i / 8, y = a.y + (b.y - a.y) * i / 8, kk = a.k + (b.k - a.k) * i / 8;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 1.0 * kk); ctx.stroke();
      }
    } });
  }

  SW.people = {
    update: update,
    crowdNear: function () { return crowdHere; },
    avatar: av,
    place: function (s, dir) { av.s = s + dir * 6.0; },
    count: function () { return people.filter(function (p) { return p.on; }).length; }
  };
})();
