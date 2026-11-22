// Renderer: one 2D canvas, real projection of a few world strips and sprites.
// No libraries. Everything is drawn procedurally each frame.
(function () {
  "use strict";
  var W0 = SW.world;
  var DEG = Math.PI / 180;
  var EYE = 1.6, WATER_Z = -2.6;
  var NEAR = 0.35;
  var HILL_EX = 2.4; // vertical exaggeration for the far hills (art licence, see DECISIONS)

  // ---------- small colour helpers ----------
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function add(a, b, k) { return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function css(c, alpha) {
    var r = Math.max(0, Math.min(255, c[0] | 0)), g = Math.max(0, Math.min(255, c[1] | 0)), b = Math.max(0, Math.min(255, c[2] | 0));
    return alpha === undefined ? "rgb(" + r + "," + g + "," + b + ")" : "rgba(" + r + "," + g + "," + b + "," + alpha.toFixed(3) + ")";
  }
  function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function ramp(stops, t) {
    // stops: [[t, [r,g,b]], ...] ascending
    if (t <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i];
        return mix(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
      }
    }
    return stops[stops.length - 1][1];
  }
  function smoothstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
  // deterministic pseudo random
  function hash(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  // ---------- palettes by dusk (0 = just after sunset, 1 = night) ----------
  var SKY_TOP = [[0, hex("#6f8fbf")], [0.3, hex("#4a6299")], [0.55, hex("#2b3a6b")], [0.8, hex("#141c3c")], [1, hex("#0a0f24")]];
  var SKY_HOR = [[0, hex("#f4c48c")], [0.3, hex("#e39f7a")], [0.55, hex("#a97f8e")], [0.8, hex("#3d4466")], [1, hex("#1b2240")]];
  var SUN_GLOW = [[0, hex("#ffb066")], [0.35, hex("#f08a5a")], [0.6, hex("#9a5f6e")], [1, hex("#1b2240")]];
  var AMBIENT = [[0, hex("#c9b8b0")], [0.4, hex("#8a8aa6")], [0.7, hex("#4a5274")], [1, hex("#262c48")]];
  var LAMP = hex("#ffcf8a");

  // ---------- state shared across a frame ----------
  var cv, ctx, W, H, DPR, F, HOR;
  var cam = { x: 0, y: 0, V: 0, vx: 0, vy: 1, rx: 1, ry: 0 };
  var dusk = 0, season = null, tnow = 0, amb = [0, 0, 0], fogC = [0, 0, 0], fogDist = 600;
  var stars = [];
  for (var si = 0; si < 160; si++) stars.push({ az: hash(si) * 360, el: 2 + Math.pow(hash(si + 500), 0.7) * 70, m: 0.3 + hash(si + 900) * 0.7, p: hash(si + 1300) * 6.28 });

  function init(canvas) {
    cv = canvas; ctx = cv.getContext("2d", { alpha: false });
    resize(1.5);
  }
  function resize(dprCap) {
    DPR = Math.min(window.devicePixelRatio || 1, dprCap || 1.5);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // horizontal FOV about 74 deg in portrait, wider feel in landscape
    var fov = (W < H ? 74 : 64) * DEG;
    F = (W / 2) / Math.tan(fov / 2);
    HOR = Math.round(H * (W < H ? 0.53 : 0.52));
  }

  // ---------- projection ----------
  function toCam(x, y, z) {
    var dx = x - cam.x, dy = y - cam.y;
    return [dx * cam.rx + dy * cam.ry, dx * cam.vx + dy * cam.vy, z];
  }
  function proj(c) { return [W / 2 + c[0] / c[1] * F, HOR - (c[2] - EYE) / c[1] * F]; }
  // azimuth (deg) -> screen x (may be off screen)
  function azX(az) {
    var d = angDiff(az, cam.V) * DEG;
    if (Math.abs(d) >= 89 * DEG) return d > 0 ? 1e5 : -1e5;
    return W / 2 + Math.tan(d) * F;
  }
  function xAz(x) { return cam.V + Math.atan((x - W / 2) / F) / DEG; }
  function elY(elDeg) { return HOR - Math.tan(elDeg * DEG) * F; }

  // Clip a camera-space polygon against the near plane, project, fill.
  function polyCam(pts, fill) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      var ain = a[1] >= NEAR, bin = b[1] >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        var t = (NEAR - a[1]) / (b[1] - a[1]);
        out.push([a[0] + (b[0] - a[0]) * t, NEAR, a[2] + (b[2] - a[2]) * t]);
      }
    }
    if (out.length < 3) return;
    ctx.beginPath();
    for (var k = 0; k < out.length; k++) {
      var p = proj(out[k]);
      if (k === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // fog + ambient shading of a material colour at camera depth f, with lamp light l (0..1)
  function shade(base, f, l) {
    var c = [base[0] * amb[0] / 255, base[1] * amb[1] / 255, base[2] * amb[2] / 255];
    if (l > 0) c = add(c, [base[0] * LAMP[0] / 255, base[1] * LAMP[1] / 255, base[2] * LAMP[2] / 255], l * 0.95);
    var fog = 1 - Math.exp(-Math.max(0, f) / fogDist);
    return mix(c, fogC, fog);
  }

  // Lamp light at path distance s, 0..1. lampOn: per-lamp brightness array.
  var lampOn = [];
  function lightAt(s, lateral) {
    var L = W0.lamps, sum = 0;
    var i0 = Math.max(0, Math.floor((s - 10) / 24) - 1);
    for (var i = i0; i < Math.min(L.length, i0 + 4); i++) {
      if (!lampOn[i]) continue;
      var ds = s - L[i];
      var dl = (lateral === undefined ? 1.5 : lateral) - 3.2;
      var d2 = ds * ds + dl * dl * 1.6 + 5;
      sum += lampOn[i] * 5 / d2;
    }
    return Math.min(0.85, sum);
  }

  // ---------- sky ----------
  function drawSky() {
    var top = ramp(SKY_TOP, dusk), hor = ramp(SKY_HOR, dusk);
    if (season.haze > 0) hor = mix(hor, mix(hor, [190, 190, 200], 0.5), season.haze * (1 - dusk) * 0.6);
    var g = ctx.createLinearGradient(0, 0, 0, HOR);
    g.addColorStop(0, css(top));
    g.addColorStop(0.65, css(mix(top, hor, 0.45)));
    g.addColorStop(1, css(hor));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, HOR + 2);

    // sunset glow, placed at the real sun azimuth (below horizon)
    var glowA = Math.pow(1 - dusk, 1.4) * 0.9;
    if (glowA > 0.01) {
      var sx = azX(season.sunAz);
      var dd = Math.abs(angDiff(season.sunAz, cam.V));
      var vis = smoothstep(150, 40, dd);
      if (vis > 0) {
        var gc = ramp(SUN_GLOW, dusk);
        var cx = Math.max(-W * 1.5, Math.min(W * 2.5, sx));
        var rg = ctx.createRadialGradient(cx, HOR, 0, cx, HOR, W * 1.3);
        rg.addColorStop(0, css(gc, glowA * vis));
        rg.addColorStop(0.5, css(gc, glowA * vis * 0.35));
        rg.addColorStop(1, css(gc, 0));
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, HOR + 2);
      }
      // pink band opposite the sun (the anti-twilight arch), early dusk only
      var anti = (season.sunAz + 180) % 360;
      var pa = smoothstep(0.45, 0.05, dusk) * smoothstep(120, 30, Math.abs(angDiff(anti, cam.V)));
      if (pa > 0.01) {
        var bg = ctx.createLinearGradient(0, HOR - H * 0.22, 0, HOR);
        bg.addColorStop(0, "rgba(232,160,170,0)");
        bg.addColorStop(0.6, "rgba(232,160,170," + (0.28 * pa).toFixed(3) + ")");
        bg.addColorStop(1, "rgba(160,150,190," + (0.18 * pa).toFixed(3) + ")");
        ctx.fillStyle = bg; ctx.fillRect(0, HOR - H * 0.22, W, H * 0.22 + 2);
      }
    }

    // stars
    var sa = smoothstep(0.55, 0.95, dusk) * (1 - season.haze * 0.6);
    if (sa > 0.01) {
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i];
        var x = azX(st.az);
        if (x < -2 || x > W + 2) continue;
        var y = elY(st.el);
        if (y > HOR - 6) continue;
        var tw = 0.75 + 0.25 * Math.sin(tnow * 1.7 + st.p);
        ctx.fillStyle = "rgba(235,238,255," + (sa * st.m * tw).toFixed(3) + ")";
        var r = st.m > 0.85 ? 1.3 : 0.8;
        ctx.fillRect(x, y, r, r);
      }
    }
  }

  // The full moon: rises roughly opposite the sun as it gets dark.
  function moonEl() { return -3 + smoothstep(0.15, 1, dusk) * 16; }
  function drawMoon() {
    var el = moonEl();
    if (el < -1) return;
    var x = azX(season.moonAz), y = elY(el);
    if (x < -60 || x > W + 60) return;
    var r = Math.max(5, F * 0.0045 * 2.2);
    var a = smoothstep(-1, 3, el);
    var halo = ctx.createRadialGradient(x, y, r, x, y, r * 7);
    halo.addColorStop(0, "rgba(255,236,200," + (0.35 * a) + ")");
    halo.addColorStop(1, "rgba(255,236,200,0)");
    ctx.fillStyle = halo; ctx.fillRect(x - r * 7, y - r * 7, r * 14, r * 14);
    var low = smoothstep(8, 0, el); // low moon is warmer
    ctx.fillStyle = css(mix([250, 246, 230], [255, 196, 140], low), a);
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
  }

  // ---------- hills (Shivaliks, Kasauli side, Morni side) ----------
  function ridge(az, seed, a0, a1, base, amp) {
    // az in degrees, span a0..a1 possibly wrapping through north
    var span = (a1 - a0 + 360) % 360;
    var u = ((az - a0 + 360) % 360);
    if (u > span) return -1;
    var t = u / span;
    var taper = smoothstep(0, 0.12, t) * smoothstep(1, 0.88, t);
    var v = base + amp * (0.55 * Math.sin(az * 0.21 + seed) + 0.3 * Math.sin(az * 0.53 + seed * 2.1) +
      0.15 * Math.sin(az * 1.37 + seed * 3.7) + 0.08 * Math.sin(az * 3.1 + seed));
    return Math.max(0, v) * taper;
  }
  function drawHills() {
    var layers = [
      // far Himalayan foothills (Kasauli and beyond), paler
      { seed: 1.3, a0: 300, a1: 75, base: 2.3, amp: 0.9, col: 0.55 },
      // Morni hills to the east
      { seed: 4.1, a0: 40, a1: 125, base: 1.3, amp: 0.6, col: 0.4 },
      // near Shivalik foothills, darker
      { seed: 2.7, a0: 290, a1: 110, base: 1.0, amp: 0.55, col: 0.2 }
    ];
    var hor = ramp(SKY_HOR, dusk), top = ramp(SKY_TOP, dusk);
    for (var li = 0; li < layers.length; li++) {
      var Ly = layers[li];
      // colour: far layers sit closer to the horizon sky colour (aerial perspective)
      var night = [16, 20, 36];
      var day = mix([70, 82, 120], hor, Ly.col);
      var c = mix(day, mix(night, hor, Ly.col * 0.5), smoothstep(0.2, 0.95, dusk));
      c = mix(c, mix(hor, [200, 200, 210], 0.3), season.haze * 0.55 * (li === 0 ? 1 : 0.6));
      ctx.beginPath();
      ctx.moveTo(0, HOR + 1);
      var any = false;
      for (var x = 0; x <= W + 4; x += 4) {
        var e = ridge(xAz(x), Ly.seed, Ly.a0, Ly.a1, Ly.base, Ly.amp);
        if (e > 0) any = true;
        ctx.lineTo(x, elY(Math.max(0, e) * HILL_EX));
      }
      ctx.lineTo(W, HOR + 1);
      ctx.closePath();
      if (!any) continue;
      ctx.fillStyle = css(c);
      ctx.fill();
      // last light on the far ridge (alpenglow) just after sunset
      if (li === 0) {
        var ag = smoothstep(0.35, 0, dusk) * (1 - season.haze * 0.5);
        if (ag > 0.01) {
          ctx.save(); ctx.clip();
          var gg = ctx.createLinearGradient(0, elY(Ly.base * HILL_EX * 1.6), 0, HOR);
          gg.addColorStop(0, "rgba(255,170,130," + (0.45 * ag).toFixed(3) + ")");
          gg.addColorStop(1, "rgba(255,170,130,0)");
          ctx.fillStyle = gg; ctx.fillRect(0, 0, W, HOR);
          ctx.restore();
        }
      }
    }
    // a few lights at the foot of the hills after dark (Panchkula side and the slopes)
    var la = smoothstep(0.45, 0.85, dusk);
    if (la > 0.01) {
      for (var i = 0; i < 46; i++) {
        var az = 20 + hash(i + 40) * 70;
        var x2 = azX(az);
        if (x2 < 0 || x2 > W) continue;
        var e2 = ridge(az, 2.7, 290, 110, 1.0, 0.55) * HILL_EX * hash(i + 77) * 0.6;
        var y2 = elY(e2) + 1;
        var tw = 0.6 + 0.4 * Math.sin(tnow * (1 + hash(i) * 2) + i);
        ctx.fillStyle = "rgba(255,214,150," + (la * tw * (0.35 + 0.5 * hash(i + 3))).toFixed(3) + ")";
        ctx.fillRect(x2, y2, 1.4, 1.4);
      }
    }
  }

  // ---------- water and land, cast per screen column ----------
  var COLW = 4;
  var DISTS = [];
  for (var dk = 2; dk < 4000; dk *= (dk < 80 ? 1.06 : 1.11)) DISTS.push(dk);
  var colCache = null, colKey = "";
  function castColumns() {
    var key = Math.round(cam.x * 2) + "," + Math.round(cam.y * 2) + "," + Math.round(cam.V * 4) + "," + W + "," + H;
    if (key === colKey && colCache) return colCache;
    var cols = [];
    for (var x = 0; x < W + COLW; x += COLW) {
      var az = xAz(x + COLW / 2) * DEG;
      var dx = Math.sin(az), dy = Math.cos(az);
      // depth along the view axis grows with 1/cos(angle off axis)
      var cosOff = Math.cos(az - cam.V * DEG);
      var runs = [], cur = null;
      for (var i = 0; i < DISTS.length; i++) {
        var d = DISTS[i];
        var w = W0.inWater(cam.x + dx * d, cam.y + dy * d);
        if (w && !cur) cur = { a: d * cosOff, b: d * cosOff };
        else if (w && cur) cur.b = d * cosOff;
        else if (!w && cur) { runs.push(cur); cur = null; }
      }
      if (cur) { cur.b = 1e6; runs.push(cur); }
      cols.push({ x: x, runs: runs, az: az / DEG });
    }
    colCache = cols; colKey = key;
    return cols;
  }
  function yGround(f) { return HOR + (EYE - WATER_Z) / f * F; }

  function drawWaterLand() {
    var cols = castColumns();
    var hor = ramp(SKY_HOR, dusk), top = ramp(SKY_TOP, dusk);
    // land base: the whole lower half is dark ground first
    var landC = shade([52, 62, 50], 400, 0);
    ctx.fillStyle = css(landC);
    ctx.fillRect(0, HOR, W, H - HOR);
    // water reflects the sky: bright near the horizon, darker close in
    var g = ctx.createLinearGradient(0, HOR, 0, H);
    var wFar = mix(hor, top, 0.15), wNear = mul(mix(top, [20, 30, 50], 0.4), 0.75);
    if (season.muddy) { wFar = mix(wFar, [150, 125, 90], 0.35); wNear = mix(wNear, [80, 64, 44], 0.4); }
    g.addColorStop(0, css(wFar));
    g.addColorStop(0.25, css(mix(wFar, wNear, 0.5)));
    g.addColorStop(1, css(wNear));
    ctx.fillStyle = g;
    var shoreC = shade([46, 58, 44], 900, 0);
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      for (var r = 0; r < c.runs.length; r++) {
        var run = c.runs[r];
        var y0 = run.b >= 1e6 ? HOR : yGround(run.b), y1 = Math.min(H, yGround(Math.max(run.a, 0.5)));
        if (y1 > y0) ctx.fillRect(c.x, y0, COLW, y1 - y0);
      }
    }
    // far-shore treeline: where a water run ends before the horizon, trees rise
    for (var i2 = 0; i2 < cols.length; i2++) {
      var c2 = cols[i2];
      for (var r2 = 0; r2 < c2.runs.length; r2++) {
        var run2 = c2.runs[r2];
        if (run2.b >= 1e6 || run2.b < 250) continue; // near land patches are just land
        var yb = yGround(run2.b);
        var th = Math.min(H * 0.05, Math.max(1, (11 + 7 * hash(Math.floor(c2.az * 3))) / run2.b * F));
        var fogT = 1 - Math.exp(-run2.b / fogDist);
        ctx.fillStyle = css(mix(shade([40, 54, 40], 0, 0), fogC, Math.min(0.85, fogT + 0.15)));
        ctx.fillRect(c2.x, yb - th, COLW, th + 1);
        // lights on the far shore after dark (houses, the club, street lamps)
        var nl = smoothstep(0.35, 0.75, dusk);
        var hk = Math.floor(c2.az * 2.5);
        if (nl > 0.01 && hash(hk + 911) < 0.22) {
          var tw = 0.75 + 0.25 * Math.sin(tnow * 0.7 + hk);
          ctx.fillStyle = "rgba(255,210,140," + (nl * tw * (0.45 + 0.4 * hash(hk + 3))).toFixed(3) + ")";
          ctx.fillRect(c2.x + 1, yb - th * (0.2 + 0.5 * hash(hk + 5)), 1.6, 1.6);
          // its smear in the water
          ctx.fillStyle = "rgba(255,200,130," + (nl * 0.18).toFixed(3) + ")";
          ctx.fillRect(c2.x + 1, yb + 1, 1.6, Math.min(14, 2400 / run2.b));
        }
      }
    }
    // ripples: faint horizontal strokes that drift, only over water
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = css(mix(hor, [255, 255, 255], 0.2));
    for (var k = 0; k < 70; k++) {
      var f = 8 + Math.pow(hash(k + 3), 2) * 500;
      var yk = yGround(f);
      if (yk >= H) continue;
      var xk = ((hash(k + 11) * W * 1.5 + tnow * (6 + 10 * hash(k))) % (W * 1.5)) - W * 0.25;
      var col = cols[Math.max(0, Math.min(cols.length - 1, Math.floor(xk / COLW)))];
      var wet = col && col.runs.some(function (rr) { return f >= rr.a && f <= rr.b; });
      if (!wet) continue;
      var len = Math.max(3, 60 / f * F * 0.08);
      ctx.fillRect(xk, yk, len, Math.max(0.6, 1.2 / f * F * 0.02));
    }
    ctx.globalAlpha = 1;
    drawGlitter(cols);
    // winter evening mist lying low over the water and the far shore
    if (season.haze > 0.3) {
      var ma = (season.haze - 0.3) * 1.2 * (0.6 + 0.4 * smoothstep(0, 0.6, dusk));
      var mc = mix(ramp(SKY_HOR, dusk), [175, 178, 190], 0.35);
      var mg = ctx.createLinearGradient(0, HOR - H * 0.05, 0, HOR + H * 0.06);
      mg.addColorStop(0, css(mc, 0));
      mg.addColorStop(0.45, css(mc, ma * 0.55));
      mg.addColorStop(1, css(mc, 0));
      ctx.fillStyle = mg; ctx.fillRect(0, HOR - H * 0.05, W, H * 0.11);
    }
  }

  function columnWetAt(cols, x, f) {
    var col = cols[Math.max(0, Math.min(cols.length - 1, Math.floor(x / COLW)))];
    if (!col) return false;
    for (var i = 0; i < col.runs.length; i++) if (f >= col.runs[i].a && f <= col.runs[i].b) return true;
    return false;
  }

  // moon path and lamp reflections on the water
  function drawGlitter(cols) {
    var el = moonEl();
    if (el > -0.5) {
      var x = azX(season.moonAz);
      if (x > -20 && x < W + 20) {
        var a = smoothstep(-0.5, 4, el) * (season.muddy ? 0.5 : 0.85);
        for (var k = 0; k < 60; k++) {
          var f = 12 + Math.pow(hash(k + 70), 1.6) * 1500;
          if (!columnWetAt(cols, x, f)) continue;
          var y = yGround(f);
          var spread = (6 + 900 / f) * (0.4 + hash(k + 5));
          var jit = Math.sin(tnow * (1.2 + hash(k) * 2) + k) * spread * 0.6;
          ctx.fillStyle = "rgba(255,238,205," + (a * (0.25 + 0.6 * hash(k + 9))).toFixed(3) + ")";
          ctx.fillRect(x + jit - spread / 2, y, spread, Math.max(0.7, 2.2 / Math.sqrt(f)));
        }
      }
    }
    // lamp reflections: mirror each lit lamp head in the water plane
    for (var i = 0; i < W0.lamps.length; i++) {
      if (!lampOn[i]) continue;
      var p = W0.at(W0.lamps[i], 3.2);
      var c = toCam(p[0], p[1], 0);
      if (c[1] < 8 || c[1] > 700) continue;
      var sx = W / 2 + c[0] / c[1] * F;
      if (sx < -10 || sx > W + 10) continue;
      var yTop = HOR - (WATER_Z - EYE) / c[1] * F;
      var yMir = HOR - ((WATER_Z * 2 - 3.4) - EYE) / c[1] * F;
      var wv = Math.max(1.5, 0.5 / c[1] * F);
      for (var m = 0; m < 7; m++) {
        var tt = m / 7;
        var yy = yTop + (yMir - yTop) * (0.15 + tt * 1.4);
        if (!columnWetAt(cols, sx, c[1] + 2 + tt * 6)) continue;
        var jx = Math.sin(tnow * 2.3 + i * 1.7 + m * 2.1) * wv * 0.7;
        ctx.fillStyle = "rgba(255,205,130," + (lampOn[i] * 0.5 * (1 - tt * 0.7)).toFixed(3) + ")";
        ctx.fillRect(sx + jx - wv * (1 - tt * 0.4), yy, wv * 2 * (1 - tt * 0.4), Math.max(0.8, wv * 0.35));
      }
    }
  }

  // ---------- the dam: strips drawn back to front with sprites ----------
  // Lateral profile (metres, + toward water). z is height above the promenade.
  var M = {
    trail: hex("#7a5a44"), grass: hex("#47603a"), hedge: hex("#2f4a2c"), hedgeTop: hex("#3d5c34"),
    walk: hex("#a39c90"), walkEdge: hex("#8d867b"), parapet: hex("#b8b0a2"), parapetTop: hex("#cfc7b8"), face: hex("#857d70")
  };

  function segmentDrawable(s0, s1) {
    var f0 = W0.frame(s0), f1 = W0.frame(s1);
    var p0 = W0.pos(s0), p1 = W0.pos(s1);
    function P(sIdx, o, z) {
      var p = sIdx ? p1 : p0, fr = sIdx ? f1 : f0;
      return toCam(p[0] + fr.nx * o, p[1] + fr.ny * o, z);
    }
    var sm = (s0 + s1) / 2;
    var lw = -1, ll = -1;
    function lights() { if (lw < 0) { lw = lightAt(sm, 2.2); ll = lightAt(sm, -2.5); } }
    var out = [];
    // Each strip is its own drawable, sorted by the depth of its own centre, so
    // neighbouring segments layer correctly when she looks across the water.
    function strip(o, z, bias, fn) {
      var pm = W0.at(sm, o);
      var c = toCam(pm[0], pm[1], z);
      out.push({ f: c[1] + bias, draw: function () { lights(); fn(Math.max(1, c[1])); } });
    }
    var hh = 1.55 + 0.25 * Math.sin(s0 * 0.7) + 0.15 * Math.sin(s0 * 2.3);
    // jogging trail below, behind the hedge
    strip(-9, -1.4, 0, function (d) {
      polyCam([P(0, -10.5, -1.4), P(1, -10.5, -1.4), P(1, -7.6, -1.4), P(0, -7.6, -1.4)], css(shade(M.trail, d, ll * 0.15)));
    });
    // hedge: top then face
    strip(-6.7, hh, 0, function (d) {
      polyCam([P(0, -7.4, hh), P(1, -7.4, hh), P(1, -6.0, hh), P(0, -6.0, hh)], css(shade(M.hedgeTop, d, ll * 0.4)));
      polyCam([P(0, -6.0, 0), P(1, -6.0, 0), P(1, -6.0, hh), P(0, -6.0, hh)], css(shade(M.hedge, d, ll * 0.55)));
    });
    // ground: grass verge and the promenade in two halves (lamp side brighter)
    strip(-1, 0, 50, function (d) {
      polyCam([P(0, -6.0, 0.01), P(1, -6.0, 0.01), P(1, -4.6, 0.01), P(0, -4.6, 0.01)], css(shade(M.grass, d, ll * 0.6)));
      polyCam([P(0, -4.6, 0), P(1, -4.6, 0), P(1, -0.6, 0), P(0, -0.6, 0)], css(shade(M.walk, d, ll)));
      polyCam([P(0, -0.6, 0), P(1, -0.6, 0), P(1, 3.4, 0), P(0, 3.4, 0)], css(shade(M.walk, d, lw)));
      // paving joints every 6 m, only close by
      if (d < 28 && Math.floor(s1 / 6) !== Math.floor(s0 / 6)) {
        var js = Math.floor(s1 / 6) * 6, fj = W0.frame(js), pj = W0.pos(js);
        var a = toCam(pj[0] - fj.nx * 4.6, pj[1] - fj.ny * 4.6, 0), b = toCam(pj[0] + fj.nx * 3.4, pj[1] + fj.ny * 3.4, 0);
        polyCam([a, b, [b[0], b[1] + 0.04, 0.001], [a[0], a[1] + 0.04, 0.001]], css(mix(shade(M.walk, d, (lw + ll) / 2), shade(M.walkEdge, d, (lw + ll) / 2), 0.6)));
      }
    });
    // dam face toward the water and the wet line at the bottom
    strip(6.5, -1, 30, function (d) {
      polyCam([P(0, 3.8, 0.55), P(1, 3.8, 0.55), P(1, 9.5, WATER_Z - 0.2), P(0, 9.5, WATER_Z - 0.2)], css(shade(M.face, d, lw * 0.3)));
      polyCam([P(0, 9.0, WATER_Z), P(1, 9.0, WATER_Z), P(1, 10.5, WATER_Z - 0.3), P(0, 10.5, WATER_Z - 0.3)], css(shade([60, 64, 66], d, 0)));
    });
    // parapet: inner face, then top
    strip(3.6, 0.3, 0, function (d) {
      polyCam([P(0, 3.4, 0), P(1, 3.4, 0), P(1, 3.4, 0.55), P(0, 3.4, 0.55)], css(shade(M.parapet, d, lw * 0.8)));
      polyCam([P(0, 3.4, 0.55), P(1, 3.4, 0.55), P(1, 3.8, 0.55), P(0, 3.8, 0.55)], css(shade(M.parapetTop, d, lw)));
    });
    return out;
  }

  // sprite helpers: world point -> screen + scale (px per metre)
  function spot(x, y, z) {
    var c = toCam(x, y, z);
    if (c[1] < NEAR + 0.3) return null;
    var p = proj(c);
    return { x: p[0], y: p[1], k: F / c[1], f: c[1] };
  }

  function lampDrawable(i) {
    var s = W0.lamps[i];
    var p = W0.at(s, 3.2);
    var base = spot(p[0], p[1], 0);
    if (!base || base.x < -60 || base.x > W + 60 || base.f > 900) return null;
    return {
      f: base.f - 0.1,
      draw: function () {
        var k = base.k, on = lampOn[i] || 0;
        var postH = 3.1;
        var top = base.y - postH * k;
        ctx.fillStyle = css(shade([60, 62, 66], base.f, 0));
        var pw = Math.max(1, 0.09 * k);
        ctx.fillRect(base.x - pw / 2, top, pw, postH * k);
        var r = Math.max(1.2, Math.min(9, 0.15 * k));
        if (on > 0.01) {
          var gR = Math.min(r * 9, 70);
          var gl = ctx.createRadialGradient(base.x, top, 0, base.x, top, gR);
          gl.addColorStop(0, "rgba(255,214,150," + (0.55 * on).toFixed(3) + ")");
          gl.addColorStop(1, "rgba(255,214,150,0)");
          ctx.fillStyle = gl; ctx.fillRect(base.x - gR, top - gR, gR * 2, gR * 2);
        }
        ctx.fillStyle = on > 0.01 ? css(mix([120, 118, 110], [255, 236, 190], on)) : css(shade([150, 150, 150], base.f, 0));
        ctx.beginPath(); ctx.arc(base.x, top, r, 0, 6.283); ctx.fill();
      }
    };
  }

  var extraDrawables = [];
  function addDrawable(d) { if (d) extraDrawables.push(d); }

  // ---------- frame ----------
  function frame(state) {
    tnow = state.t;
    dusk = state.dusk;
    season = state.season;
    lampOn = state.lampOn;
    var p = W0.at(state.s, state.lateral || 0);
    cam.x = p[0]; cam.y = p[1];
    cam.V = (state.view + 360) % 360;
    var v = cam.V * DEG;
    cam.vx = Math.sin(v); cam.vy = Math.cos(v);
    cam.rx = Math.cos(v); cam.ry = -Math.sin(v);
    amb = ramp(AMBIENT, dusk);
    fogC = mix(ramp(SKY_HOR, dusk), [150, 150, 160], season.haze * 0.4);
    fogDist = 1400 - season.haze * 1000;

    var skip = SW.dbgSkip || {};
    drawSky();
    drawMoon();
    if (!skip.hills) drawHills();
    if (!skip.water) drawWaterLand();
    if (skip.dam) return;

    // collect dam strips and sprites, then paint back to front
    var list = [];
    var S = state.s;
    // segments: finer close to the camera
    var marks = [];
    var back = 140, ahead = 520;
    for (var d = -back; d <= ahead;) {
      marks.push(S + d);
      var ad = Math.abs(d);
      d += ad < 30 ? 2 : ad < 120 ? 4 : ad < 300 ? 8 : 16;
    }
    // the walk direction matters for which side is "ahead"
    if (state.dir < 0) marks = marks.map(function (m) { return 2 * S - m; }).reverse();
    marks = marks.filter(function (m) { return m >= 0 && m <= W0.L; });
    marks.sort(function (a, b) { return a - b; });
    for (var i = 0; i < marks.length - 1; i++) Array.prototype.push.apply(list, segmentDrawable(marks[i], marks[i + 1]));
    for (var li = 0; li < W0.lamps.length; li++) {
      if (Math.abs(W0.lamps[li] - S) > 600) continue;
      var ld = lampDrawable(li);
      if (ld) list.push(ld);
    }
    for (var e = 0; e < extraDrawables.length; e++) list.push(extraDrawables[e]);
    extraDrawables = [];
    list.sort(function (a, b) { return b.f - a.f; });
    for (var q = 0; q < list.length; q++) {
      if (list[q].f < -2) continue;
      list[q].draw();
    }
    // soft vignette for a painted look
    var vg = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(5,6,15," + (0.25 + dusk * 0.2).toFixed(3) + ")");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  SW.render = {
    init: init, resize: resize, frame: frame, spot: spot, addDrawable: addDrawable,
    shade: shade, css: css, mix: mix, hex: hex, lightAt: lightAt, hash: hash, smoothstep: smoothstep,
    get ctx() { return ctx; }, get W() { return W; }, get H() { return H; }, get F() { return F; },
    get DPR() { return DPR; }, toCam: toCam, azX: azX, WATER_Z: WATER_Z
  };
})();
