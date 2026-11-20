/* Sukhna Walk: the pixel art side view (the default art). One low-res buffer, every pixel
   rasterised by hand, no images, no libraries. Design space is 390 rows tall; OY shifts it to the
   real buffer height. Exposes SW.pix (renderer) and SW.pixPeople (crowd, vendors, her companion). */
(function () {
'use strict';
var SW = window.SW, WD = SW.world;
var PPM = 7;              /* buffer px per metre along the walk */
var DH = 390;             /* design height in rows */
var HZ = 202;             /* horizon and water line, design rows */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function ss(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function mod(a, n) { return ((a % n) + n) % n; }

/* ---------- buffer ---------- */
var cv = null, ctx = null, lo = null, loCtx = null, img = null, buf = null, bg = null;
var W = 180, H = 390, OY = 0, OYB = 0, SCALE = 2, BX = 0, BY = 0, CSSK = 1;
var GA = 1; /* global alpha for the sprite being drawn (used to fade the companion) */
function px(x, y, c, a) {
  x = Math.round(x); y = Math.round(y) + OY;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  var i = (y * W + x) * 4, k = a === undefined ? GA : a * GA;
  if (k >= 1) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255; }
  else if (k > 0) { buf[i] += (c[0] - buf[i]) * k; buf[i + 1] += (c[1] - buf[i + 1]) * k; buf[i + 2] += (c[2] - buf[i + 2]) * k; buf[i + 3] = 255; }
}
function rect(x, y, w, h, c, a) {
  x = Math.round(x); y = Math.round(y);
  if ((a === undefined || a >= 1) && GA >= 1) {
    var x0 = Math.max(0, x), x1 = Math.min(W, x + w), y0 = Math.max(0, y + OY), y1 = Math.min(H, y + OY + h);
    for (var j = y0; j < y1; j++) for (var i = x0, k = (j * W + x0) * 4; i < x1; i++, k += 4) { buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; buf[k + 3] = 255; }
    return;
  }
  for (var jj = 0; jj < h; jj++) for (var ii = 0; ii < w; ii++) px(x + ii, y + jj, c, a);
}
function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
var BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(function (v) { return (v + 0.5) / 16; });
function B(x, y) { return BAY[((y & 3) << 2) | (x & 3)]; }
function addpx(x, y, c, q) {
  y += OY;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  var i = (y * W + x) * 4;
  buf[i] = Math.min(255, buf[i] + c[0] * q); buf[i + 1] = Math.min(255, buf[i + 1] + c[1] * q); buf[i + 2] = Math.min(255, buf[i + 2] + c[2] * q);
}
/* additive dithered glow, 4 levels */
function glow(cx, cy, r, c, s, ry, lv) {
  lv = lv || 4;
  cx = Math.round(cx); cy = Math.round(cy); ry = ry || r;
  if (s <= 0.01) return;
  for (var y = cy - Math.ceil(ry); y <= cy + Math.ceil(ry); y++) {
    for (var x = cx - r; x <= cx + r; x++) {
      var dx = (x - cx) / r, dy = (y - cy) / ry, d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      var f = (1 - d) * (1 - d) * s;
      var q = Math.floor(f * lv + B(x & 255, (y + OY) & 255)) / lv;
      if (q > 0) addpx(x, y, c, q);
    }
  }
}
function hh(n) { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }
function h2(a, b) { return hh(Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)); }

/* ---------- palette: key colours at dusk 0, 0.5, 1 ---------- */
var K = {
  skyTop: [[74, 104, 164], [46, 44, 104], [8, 12, 36]],
  skyMid: [[236, 150, 110], [156, 78, 116], [18, 28, 66]],
  skyHor: [[255, 208, 122], [240, 132, 100], [40, 58, 102]],
  ridge1: [[178, 130, 152], [96, 66, 116], [36, 48, 92]],
  ridge2: [[142, 98, 130], [68, 48, 98], [26, 36, 74]],
  ridge3: [[104, 70, 106], [46, 36, 76], [13, 20, 44]],
  haze: [[252, 196, 140], [226, 124, 112], [54, 72, 116]],
  shore: [[66, 50, 84], [34, 28, 58], [8, 12, 28]],
  shoreTop: [[160, 108, 104], [80, 52, 82], [22, 30, 58]],
  wTop: [[244, 176, 112], [186, 100, 112], [34, 50, 94]],
  wBot: [[78, 78, 130], [34, 38, 86], [8, 14, 38]],
  wLight: [[255, 228, 164], [250, 172, 132], [130, 158, 214]],
  capc: [[236, 206, 170], [180, 138, 136], [78, 86, 122]],
  wallc: [[172, 132, 114], [112, 82, 98], [36, 42, 76]],
  walk: [[200, 168, 144], [118, 94, 106], [38, 42, 72]],
  walkJ: [[172, 140, 122], [94, 74, 90], [28, 32, 58]],
  ground: [[58, 50, 68], [30, 26, 50], [14, 17, 38]],
  hedge: [[44, 64, 56], [24, 36, 46], [7, 15, 26]],
  hedgeTop: [[110, 100, 84], [60, 56, 70], [16, 26, 44]],
  bldg: [[228, 200, 174], [154, 116, 134], [42, 50, 84]],
  conc: [[214, 188, 168], [142, 112, 130], [48, 56, 90]],
  steel: [[96, 90, 104], [58, 50, 78], [18, 24, 48]],
  wood: [[152, 110, 82], [98, 72, 86], [32, 32, 58]],
  cloudT: [[170, 120, 150], [100, 62, 122], [26, 36, 74]],
  cloudB: [[255, 196, 136], [240, 126, 112], [46, 64, 108]]
};

/* ---------- pixel fonts ---------- */
function G(top) { var r = ['', '', '', '', '', '', '', '', '']; for (var i = 1; i < arguments.length; i++) r[top + i - 1] = arguments[i]; return r; }
var F5 = {
  a: G(2, '.##.', '...#', '.###', '#..#', '.###'),
  b: G(0, '#...', '#...', '###.', '#..#', '#..#', '#..#', '###.'),
  c: G(2, '.##.', '#..#', '#...', '#..#', '.##.'),
  e: G(2, '.##.', '#..#', '####', '#...', '.###'),
  g: G(2, '.###', '#..#', '#..#', '.###', '...#', '...#', '.##.'),
  h: G(0, '#...', '#...', '###.', '#..#', '#..#', '#..#', '#..#'),
  i: G(0, '#', '.', '#', '#', '#', '#', '#'),
  k: G(0, '#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'),
  l: G(0, '#', '#', '#', '#', '#', '#', '#'),
  m: G(2, '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'),
  n: G(2, '###.', '#..#', '#..#', '#..#', '#..#'),
  o: G(2, '.##.', '#..#', '#..#', '#..#', '.##.'),
  p: G(2, '###.', '#..#', '#..#', '###.', '#...', '#...', '#...'),
  r: G(2, '#.##', '##..', '#...', '#...', '#...'),
  s: G(2, '.###', '#...', '.##.', '...#', '###.'),
  t: G(1, '.#.', '###', '.#.', '.#.', '.#.', '.##'),
  v: G(2, '#..#', '#..#', '#..#', '.##.', '.##.'),
  w: G(2, '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'),
  y: G(2, '#..#', '#..#', '#..#', '.###', '...#', '...#', '.##.'),
  T: G(0, '#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'),
  K: G(0, '#..#', '#..#', '#.#.', '##..', '#.#.', '#..#', '#..#'),
  '.': G(6, '#'),
  ' ': G(0, '..')
};
function text5(s, x, y, c) {
  for (var i = 0; i < s.length; i++) {
    var g = F5[s[i]]; if (!g) { x += 3; continue; }
    var w = 0; for (var r = 0; r < 9; r++) w = Math.max(w, g[r].length);
    for (r = 0; r < 9; r++) for (var q = 0; q < g[r].length; q++) if (g[r][q] === '#') px(x + q, y + r, c);
    x += w + 1;
  }
}
function measure5(s) {
  var x = 0;
  for (var i = 0; i < s.length; i++) {
    var g = F5[s[i]]; if (!g) { x += 3; continue; }
    var w = 0; for (var r = 0; r < 9; r++) w = Math.max(w, g[r].length);
    x += w + 1;
  }
  return x - 1;
}
var F3src = {
  A: '.#.,#.#,###,#.#,#.#', B: '##.,#.#,##.,#.#,##.', C: '.##,#..,#..,#..,.##', E: '###,#..,##.,#..,###',
  H: '#.#,#.#,###,#.#,#.#', I: '###,.#.,.#.,.#.,###', L: '#..,#..,#..,#..,###', M: '#.#,###,###,#.#,#.#',
  N: '##.,#.#,#.#,#.#,#.#', O: '.#.,#.#,#.#,#.#,.#.', P: '##.,#.#,##.,#..,#..', R: '##.,#.#,##.,#.#,#.#', S: '.##,#..,.#.,..#,##.',
  T: '###,.#.,.#.,.#.,.#.', U: '#.#,#.#,#.#,#.#,###', V: '#.#,#.#,#.#,#.#,.#.', '(': '.#,#.,#.,#.,.#',
  ')': '#.,.#,.#,.#,#.', ',': '..,..,..,.#,#.', '.': '.,.,.,.,#', ' ': '.,.,.,.,.'
};
var F3 = {};
Object.keys(F3src).forEach(function (k) { F3[k] = F3src[k].split(','); });
function text3(s, x, y, c) {
  s = s.toUpperCase();
  for (var i = 0; i < s.length; i++) {
    var g = F3[s[i]]; if (!g) { x += 3; continue; }
    for (var r = 0; r < 5; r++) for (var q = 0; q < g[r].length; q++) if (g[r][q] === '#') px(x + q, y + r, c);
    x += g[0].length + 1;
  }
}
function measure3(s) {
  var x = 0; s = s.toUpperCase();
  for (var i = 0; i < s.length; i++) { var g = F3[s[i]]; x += (g ? g[0].length : 2) + 1; }
  return x - 1;
}

/* ---------- season, palette, time ---------- */
var SEA = { kind: 'autumn', haze: 0.25, muddy: false, migrants: false, coats: false, crowd: 1, bloom: null, cloud: 0 };
var FOGHUE = { winter: [176, 182, 206], summer: [240, 200, 152], monsoon: [150, 154, 176], spring: [214, 184, 200], autumn: [220, 186, 160] };
var P = {}, AMB = 1, TR = 1, TG = 1, TB = 1;
var WARM = [255, 214, 140];
var D = 0, bgKey = '', R1 = [], R2 = [], R3 = [];
var tm = 0, camX = 0, AX = 70;
var ST = null;
function steps(base, haze, n) { var a = []; for (var i = 0; i <= n; i++) a.push(mixc(base, haze, i / n)); return a; }
function applyPalette() {
  Object.keys(K).forEach(function (k) {
    var a = K[k];
    P[k] = D < 0.5 ? mixc(a[0], a[1], D * 2) : mixc(a[1], a[2], (D - 0.5) * 2);
  });
  var fog = mixc(P.haze, FOGHUE[SEA.kind] || FOGHUE.autumn, 0.35), hz = SEA.haze;
  P.skyTop = mixc(P.skyTop, fog, hz * 0.55); P.skyMid = mixc(P.skyMid, fog, hz * 0.55); P.skyHor = mixc(P.skyHor, fog, hz * 0.35);
  P.ridge1 = mixc(P.ridge1, fog, hz * 0.8); P.ridge2 = mixc(P.ridge2, fog, hz * 0.8); P.ridge3 = mixc(P.ridge3, fog, hz * 0.8);
  P.haze = mixc(P.haze, fog, hz * 0.6); P.shore = mixc(P.shore, fog, hz * 0.4);
  if (SEA.cloud > 0) { var gr = lerp(1, 0.3, ss(0.2, 1, D)); P.skyTop = mixc(P.skyTop, [104 * gr, 106 * gr, 126 * gr], SEA.cloud * 0.5); P.skyMid = mixc(P.skyMid, [128 * gr, 118 * gr, 132 * gr], SEA.cloud * 0.4); }
  if (SEA.muddy) {
    var br = lerp(1, 0.3, ss(0.2, 1, D));
    P.wTop = mixc(P.wTop, [128 * br, 98 * br, 72 * br], 0.62); P.wBot = mixc(P.wBot, [84 * br, 64 * br, 48 * br], 0.6); P.wLight = mixc(P.wLight, [210, 170, 120], 0.4);
  }
  AMB = lerp(1, 0.46, ss(0.05, 0.95, D));
  TR = 1.1 - 0.4 * D; TG = 0.9 - 0.12 * D; TB = 0.8 + 0.25 * D;
  R1 = steps(P.ridge1, P.haze, 4); R2 = steps(P.ridge2, P.haze, 4); R3 = steps(P.ridge3, P.haze, 4);
}

/* ---------- layout dependent ---------- */
var STARS = [], MOONX = 140, moonY = 200;
function layout() {
  MOONX = Math.round(W * 0.74);
  STARS = [];
  var n = Math.round(90 * W / 180);
  for (var i = 0; i < n; i++) STARS.push({ x: Math.floor(h2(i, 3) * W), y: -OY + Math.floor(h2(i, 4) * (140 + OY)), b: 0.35 + h2(i, 5) * 0.65, p: h2(i, 6) * 6.28 });
}
var CLOUDS = [
  { x: 30, y: 52, rx: 34, ry: 4 }, { x: 118, y: 40, rx: 28, ry: 3 }, { x: 90, y: 86, rx: 44, ry: 5 },
  { x: 205, y: 70, rx: 36, ry: 4 }, { x: 250, y: 110, rx: 40, ry: 4 }, { x: 40, y: 122, rx: 30, ry: 3 },
  { x: 160, y: 20, rx: 22, ry: 2 }, { x: 310, y: 36, rx: 30, ry: 3 }
];

/* ---------- precomputed worlds (period 360) ---------- */
function blobs(seed, n, rmin, rmax, hmin, hmax) {
  var arr = new Array(360).fill(0);
  for (var i = 0; i < n; i++) {
    var c = Math.floor(i * 360 / n + h2(i, seed) * 360 / n), r = rmin + h2(i, seed + 1) * (rmax - rmin), hh_ = hmin + h2(i, seed + 2) * (hmax - hmin);
    for (var dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      var v = hh_ * Math.sqrt(Math.max(0, 1 - (dx / r) * (dx / r)));
      var k = mod(c + dx, 360); if (v > arr[k]) arr[k] = v;
    }
  }
  return arr.map(function (v) { return Math.round(v); });
}
var TL = blobs(7, 56, 3, 6, 3, 8);
var HEDGE = blobs(31, 30, 5, 10, 5, 12);
var TREEPOLES = [20, 96, 205, 290];
var SHORELIGHTS = [];
for (var li = 0; li < 18; li++) SHORELIGHTS.push({ x: Math.floor(li * 20 + h2(li, 11) * 14), y: 198 + Math.floor(h2(li, 12) * 3), warm: h2(li, 13) > 0.2, p: h2(li, 14) * 6.28 });
var BIRDS = [];
for (var bi = 0; bi < 18; bi++) BIRDS.push({ x: h2(bi, 201) * 360, y: 214 + Math.floor(h2(bi, 202) * 32), v: (h2(bi, 203) - 0.5) * 1.4, p: h2(bi, 204) * 6.28 });

/* ---------- ridge functions (no sun is ever drawn: it sets behind her, WSW) ---------- */
function A(k, x) { return 2 * Math.PI * k * x / 360; }
function ridge1(wx) { return 164 - 10 * Math.sin(A(1, wx + 30)) - 7 * Math.sin(A(3, wx + 80)) - 3 * Math.sin(A(7, wx)); }
function ridge2(wx) { return 178 - 7 * Math.sin(A(2, wx + 10)) - 5 * Math.sin(A(5, wx + 120)) - 2 * Math.sin(A(11, wx)); }
function ridge3(wx) { return 190 - 4 * Math.sin(A(3, wx + 200)) - 3 * Math.sin(A(8, wx + 20)) + (h2(wx | 0, 5) > 0.7 ? -1 : 0); }

/* ---------- cached sky, water, walkway and ground (rebuilt when dusk or season moves) ---------- */
function skyColor(v) { return v < 0.6 ? mixc(P.skyTop, P.skyMid, v / 0.6) : mixc(P.skyMid, P.skyHor, (v - 0.6) / 0.4); }
function buildBg() {
  var Ls = 10, skyc = [], wcol = [], i, x, by, y, c;
  for (i = 0; i <= Ls; i++) skyc.push(skyColor(i / Ls));
  for (i = 0; i <= 8; i++) wcol.push(mixc(P.wTop, P.wBot, i / 8));
  var skyRows = HZ + OY;
  var ag = (1 - ss(0, 0.8, D)) * (1 - SEA.haze * 0.3);
  var ms = ss(0.35, 0.8, D) * (1 - 0.55 * SEA.cloud);
  moonY = lerp(218, Math.max(64, -OY + 26), ss(0.3, 0.95, D));
  var gx0 = W * 0.5, gxr = Math.max(90, W * 0.78);
  var grad = [[255, 196, 120], [244, 150, 120]];
  for (by = 0; by < H; by++) {
    y = by - OY;
    var rowCols = null;
    if (y >= 252 && y < 322) {
      var t = (y - 252) / 70;
      var warmW = mixc(P.walk, [255, 220, 170], 0.18 * (1 - D) * (1 - t)), coolW = mixc(P.walk, P.ground, 0.4);
      rowCols = []; for (i = 0; i <= 4; i++) rowCols.push(mixc(warmW, coolW, i / 3.2));
    } else if (y >= 324) {
      var tf = (y - 324) / (DH - 324);
      var gb = mixc(P.ground, [96, 82, 74], 0.5 * (1 - D));
      rowCols = []; for (i = 0; i <= 3; i++) rowCols.push(mixc(gb, [0, 0, 0], (i / 2.2) * 0.5));
    }
    for (x = 0; x < W; x++) {
      if (y < HZ) {
        var v = clamp(by / skyRows, 0, 1);
        var idx = clamp(Math.floor(v * Ls + B(x, by)), 0, Ls);
        c = skyc[idx];
        if (ag > 0.01 && y > 120) {
          var gdx = (x - gx0) / gxr, gdy = (y - 198) / 66, gd = Math.sqrt(gdx * gdx + gdy * gdy);
          if (gd < 1) {
            var gf = Math.pow(1 - gd, 1.6) * 0.9 * ag, gq = Math.floor(gf * 5 + B(x, by)) / 5;
            if (gq > 0) c = mixc(c, y > 178 ? grad[0] : grad[1], gq * 0.65);
          }
        }
        if (ms > 0.01) {
          var mdx = x - MOONX, mdy = y - moonY;
          if (mdx > -37 && mdx < 37 && mdy > -37 && mdy < 37) {
            var md = Math.sqrt(mdx * mdx + mdy * mdy);
            if (md < 36) {
              var mf = Math.pow(1 - md / 36, 2) * 0.8 * ms, mq = Math.floor(mf * 4 + B(x, by)) / 4;
              if (mq > 0) c = mixc(c, [170, 190, 240], mq * 0.55);
            }
            if (md < 7.2) {
              var mc = [244, 240, 214];
              var cr = [[-2, -2], [1, 1], [-1, 3], [3, -3], [-3, 1]];
              for (var ci = 0; ci < cr.length; ci++) if (Math.abs(mdx - cr[ci][0]) < 1.3 && Math.abs(mdy - cr[ci][1]) < 1.3) mc = [214, 208, 182];
              if (md > 5.6) mc = [226, 222, 196];
              c = mixc(c, mc, ms);
            }
          }
        }
      } else if (y < 252) {
        var wt = (y - HZ) / 50;
        c = wcol[clamp(Math.floor(Math.pow(wt, 0.75) * 8 + B(x, by)), 0, 8)];
      } else if (y < 322) {
        c = rowCols[clamp(Math.floor(((y - 252) / 70) * 3.2 + B(x, by)), 0, 4)];
      } else if (y < 324) { c = P.walkJ; }
      else { c = rowCols[clamp(Math.floor(((y - 324) / (DH - 324)) * 2.2 + B(x, by)), 0, 3)]; }
      var o = (by * W + x) * 4; bg[o] = c[0]; bg[o + 1] = c[1]; bg[o + 2] = c[2]; bg[o + 3] = 255;
    }
  }
  /* letterbox bars: the sky colour above, the ground colour below */
  if (ctx) {
    var gd2 = ctx.createLinearGradient(0, 0, 0, cv.height);
    gd2.addColorStop(0, 'rgb(' + P.skyTop.map(Math.round).join(',') + ')'); gd2.addColorStop(1, 'rgb(' + P.ground.map(Math.round).join(',') + ')');
    ctx.fillStyle = gd2; ctx.fillRect(0, 0, cv.width, cv.height);
  }
}

/* ---------- lamps and lighting ---------- */
var lamps = [];
function SX(ws, f) { return AX + (ws - ST.s) * PPM * (f === undefined ? 1 : f); }
function computeLamps() {
  lamps = [];
  var L = WD.lamps, S = ST.s, i0 = Math.max(0, Math.floor((S - 60 - 10) / 24)), i1 = Math.min(L.length - 1, Math.ceil((S + 60 - 10) / 24));
  for (var i = i0; i <= i1; i++) {
    var x = Math.round(SX(L[i]));
    if (x > -50 && x < W + 50) lamps.push({ x: x, on: ST.lampOn ? clamp(ST.lampOn[i] || 0, 0, 1) : 0, i: i });
  }
}
function lit(c, x) {
  var r = c[0] * AMB * TR, g = c[1] * AMB * TG, b = c[2] * AMB * TB;
  for (var i = 0; i < lamps.length; i++) {
    var dd = Math.abs(x - lamps[i].x - 3);
    if (dd < 34) { var k = 1 - dd / 34; k = k * k * lamps[i].on * 0.9; r += 76 * k; g += 52 * k; b += 16 * k; }
  }
  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
}

/* ---------- sky layers ---------- */
function drawStars() {
  var a = ss(0.42, 0.85, D) * (1 - 0.7 * SEA.cloud); if (a <= 0) return;
  for (var i = 0; i < STARS.length; i++) {
    var s = STARS[i];
    var dm = Math.hypot(s.x - MOONX, s.y - moonY); if (dm < 22) continue;
    var tw = 0.6 + 0.4 * Math.sin(tm * 1.7 + s.p);
    var al = a * s.b * tw * (1 - 0.5 * ss(60, 150, s.y) * (1 - D));
    px(s.x, s.y, [236, 240, 255], al);
    if (s.b > 0.92) { px(s.x - 1, s.y, [200, 215, 255], al * 0.5); px(s.x + 1, s.y, [200, 215, 255], al * 0.5); px(s.x, s.y - 1, [200, 215, 255], al * 0.5); px(s.x, s.y + 1, [200, 215, 255], al * 0.5); }
  }
}
function drawClouds() {
  var vis = (1 - ss(0.5, 0.92, D) * 0.85) * (1 + SEA.cloud * 0.3);
  var big = 1 + SEA.cloud * 0.7;
  for (var i = 0; i < CLOUDS.length; i++) {
    var c = CLOUDS[i], rx = c.rx * big, ry = c.ry * (1 + SEA.cloud * 0.4);
    var cx = mod(c.x - camX * 0.12 + tm * 0.5 + 60, 360) - 60;
    if (cx < -rx - 4 || cx > W + rx + 4) continue;
    for (var y = Math.floor(c.y - ry - 1); y <= c.y + ry + 1; y++) for (var x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      var dx = (x - cx) / rx, dy = (y - c.y) / ry, d = dx * dx + dy * dy;
      d += (h2(x + 5000, y) - 0.5) * 0.45;
      if (d > 1 || x < 0 || x >= W) continue;
      var t3 = (y - (c.y - ry)) / (2 * ry + 1);
      var lv = Math.floor(t3 * 3 + (B(x, y & 255) - 0.5) * 0.9);
      var cc = lv <= 0 ? P.cloudT : lv === 1 ? mixc(P.cloudT, P.cloudB, 0.5) : P.cloudB;
      px(x, y, cc, Math.min(1, 0.85 * vis));
    }
  }
}
function drawRidge(fn, pal, f, rim, hz) {
  for (var x = 0; x < W; x++) {
    var y = Math.round(fn(x + camX * f));
    for (var yy = y; yy < HZ; yy++) {
      var tt = (yy - y) / (HZ - y);
      var lv = Math.floor(tt * tt * hz * 4 + B(x, yy & 255));
      px(x, yy, pal[Math.min(4, lv)]);
    }
    px(x, y, rim);
  }
}
function drawHills() {
  var rim = mixc(P.haze, [255, 236, 200], 0.4);
  var rimA = lerp(0.8, 0.25, D) * (1 - SEA.haze * 0.5);
  drawRidge(ridge1, R1, 0.06, mixc(P.ridge1, rim, rimA * 0.7), 1.0);
  drawRidge(ridge2, R2, 0.1, mixc(P.ridge2, rim, rimA * 0.5), 0.95);
  drawRidge(ridge3, R3, 0.18, mixc(P.ridge3, rim, rimA * 0.3), 0.85);
  var dk = mixc(P.ridge3, [0, 0, 0], 0.35);
  for (var x = 0; x < W; x++) {
    var wx = Math.floor(x + camX * 0.18);
    for (var k = 0; k < 2; k++) {
      var yy = Math.round(ridge3(wx)) + 2 + Math.floor(h2(wx, k + 40) * 8);
      if (yy < HZ - 1 && h2(wx, k + 70) > 0.55) px(x, yy, dk);
    }
  }
  for (var y = HZ - 7; y < HZ; y++) for (x = 0; x < W; x++) {
    var m = (y - (HZ - 7)) / 7;
    var q = Math.floor(m * 3 * 0.55 + B(x, y & 255)) / 3;
    if (q > 0) px(x, y, P.haze, q * 0.5);
  }
}
/* ---------- far shore ---------- */
function drawShore() {
  var lw = ss(0.35, 0.75, D);
  var dk = mixc(P.shore, [0, 0, 0], 0.3);
  for (var x = 0; x < W; x++) {
    var wx = mod(Math.floor(x + camX * 0.35), 360), h = TL[wx];
    for (var j = 0; j <= h; j++) {
      var y = 201 - j;
      px(x, y, j >= h - 1 ? P.shoreTop : (h2(wx, y) < 0.2 ? dk : P.shore));
    }
  }
  for (var tp = 0; tp < TREEPOLES.length; tp++) {
    var sx = Math.round(mod(TREEPOLES[tp] - camX * 0.35 + 60, 360) - 60);
    rect(sx, 188, 1, 13, P.shore); rect(sx - 1, 186, 3, 2, P.shore); px(sx, 185, P.shoreTop);
  }
  for (var i = 0; i < SHORELIGHTS.length; i++) {
    var l = SHORELIGHTS[i], lx = Math.round(mod(l.x - camX * 0.35 + 60, 360) - 60);
    if (lx < 0 || lx >= W) continue;
    var on = lw * (0.8 + 0.2 * Math.sin(tm * 2.1 + l.p));
    if (on < 0.05) continue;
    var c2 = l.warm ? [255, 214, 130] : [200, 232, 255];
    px(lx, l.y, c2, on); px(lx - 1, l.y, c2, on * 0.25); px(lx + 1, l.y, c2, on * 0.25); px(lx, l.y - 1, c2, on * 0.25); px(lx, l.y + 1, c2, on * 0.25);
    for (var r = 0; r < 6; r++) {
      var sh = Math.round(Math.sin(tm * 1.6 + r * 1.3 + l.p) * (0.6 + r * 0.25));
      if ((r + Math.floor(tm * 1.5 + l.p)) % 3 !== 2) px(lx + sh, HZ + 2 + r, c2, on * (0.55 - r * 0.07));
    }
  }
  for (x = 0; x < W; x++) {
    wx = mod(Math.floor(x + camX * 0.35), 360); h = TL[wx];
    var rh = Math.min(8, Math.round(h * 0.9));
    for (j = 0; j < rh; j++) px(x + Math.round(Math.sin(tm * 1.4 + j * 1.1 + x * 0.05)), HZ + 1 + j, P.shore, 0.4 * (1 - j / rh));
  }
}
/* a far-shore pavilion, repeated once per 360 px of far shore */
function drawFarBuildings() {
  var sx = Math.round(mod(128 - camX * 0.35 + 60, 360) - 60);
  if (sx < -50 || sx > W) return;
  var lw = ss(0.3, 0.7, D);
  rect(sx, 194, 44, 7, P.bldg);
  rect(sx - 2, 193, 48, 1, mixc(P.bldg, [0, 0, 0], 0.25));
  rect(sx, 201, 44, 1, mixc(P.bldg, [0, 0, 0], 0.4));
  for (var i = 0; i < 9; i++) {
    rect(sx + 2 + i * 5, 195, 3, 4, mixc(mixc(P.bldg, [0, 0, 0], 0.55), [255, 214, 130], lw * (i % 3 === 1 ? 0.6 : 1)));
    rect(sx + 1 + i * 5, 194, 1, 6, mixc(P.bldg, [0, 0, 0], 0.18));
  }
  rect(sx + 14, 190, 8, 3, mixc(P.bldg, [0, 0, 0], 0.12));
  for (var r = 0; r < 4; r++) px(sx + 3 + r * 7, HZ + 2, [255, 214, 130], lw * 0.25);
}
/* ---------- water ---------- */
function drawWater() {
  for (var y = HZ + 1; y < 251; y++) {
    var dy = y - HZ, n = 3 + Math.floor(dy * 0.12);
    for (var k = 0; k < n; k++) {
      var b = h2(y, k), sp = (0.4 + h2(k, y) * 1.4) * (0.4 + dy / 55) * (h2(y, 99) > 0.5 ? 1 : -1);
      var x = mod(Math.floor(b * W + tm * sp * 3 - camX * 0.3), W + 8) - 4;
      var w = 2 + Math.floor(dy / 14) + Math.floor(h2(y, k + 9) * 3);
      var tw = (Math.floor(tm * 2 + h2(k, y) * 5) & 1);
      rect(x, y, w, 1, P.wLight, tw ? 0.42 : 0.2);
    }
  }
  /* the faint moon path, straight down from the moon */
  var mp = ss(0.4, 0.8, D) * ss(120, 200, 260 - moonY) * (1 - 0.5 * SEA.cloud);
  if (mp > 0.02) {
    for (y = HZ + 2; y < 251; y++) {
      dy = y - HZ;
      for (k = 0; k < 6; k++) {
        var xx = MOONX + (h2(y, k + 150) - 0.5) * (6 + dy * 0.6) + Math.sin(tm * 1.1 + y * 0.8 + k) * 1.4;
        var ww = 1 + Math.floor(h2(y, k + 160) * (2 + dy / 14));
        if (h2(y + Math.floor(tm * 2.2), k + 3) > 0.45) rect(xx, y, ww, 1, [214, 226, 255], mp * (1 - dy / 110));
      }
    }
  }
}
/* ducks and coots: winter migrants on the water */
function drawBirds() {
  if (!SEA.migrants) return;
  var dark = mixc([46, 46, 58], [0, 0, 0], 1 - AMB), wh = mixc([236, 236, 240], [90, 100, 140], 1 - AMB);
  for (var i = 0; i < BIRDS.length; i++) {
    var b = BIRDS[i], bx = Math.round(mod(b.x - camX * 0.5 + tm * b.v * 2 + 60, 360) - 60);
    if (bx < -6 || bx > W + 2) continue;
    var by = b.y + Math.round(Math.sin(tm * 1.2 + b.p) * 0.6), sz = 3 + Math.floor((b.y - 212) / 14);
    var dir = b.v >= 0 ? 1 : -1;
    rect(bx, by, sz, 2, dark); px(bx + (dir > 0 ? sz : -1), by - 1, dark); px(bx + (dir > 0 ? sz + 1 : -2), by - 1, wh, 0.9);
    px(bx + 1, by, wh, 0.6);
    rect(bx - 1, by + 2, sz + 2, 1, dark, 0.3);
    rect(bx - 2 * dir, by + 1, 1, 1, P.wLight, 0.4);
  }
}
/* the far dam across the bend: a string of lights, only seen where the lake bends */
function drawFarLights() {
  var lw = ss(0.2, 0.55, D);
  var c0 = SX(1260, 0.35), fade = 1 - clamp(Math.abs(ST.s - 1260) / 380, 0, 1);
  if (fade <= 0.02) return;
  for (var i = 0; i < 11; i++) {
    var x = Math.round(c0 - 50 + i * 9), t2 = i / 10, y = Math.round(lerp(228, 206, Math.pow(t2, 1.2)));
    if (x < -8 || x > W + 8) continue;
    rect(x - 4, y, 10, 2, P.shore, fade); px(x - 4, y, mixc(P.shore, P.shoreTop, 0.6), fade);
    px(x, y - 2, P.shore, fade); px(x, y - 3, mixc(P.shore, [255, 214, 130], lw), fade);
    glow(x, y - 3, 6, WARM, 0.8 * lw * fade, 5);
    for (var r = 0; r < 6; r++) {
      var sh = Math.round(Math.sin(tm * 1.7 + r * 1.2 + i) * (0.5 + r * 0.2));
      if (r % 2 === 0 || h2(i, r + Math.floor(tm * 2)) > 0.5) px(x + sh, y + 3 + r, WARM, lw * (0.6 - r * 0.08) * fade);
    }
  }
}
/* ---------- boats: moored at the jetty, others drifting in as dusk grows ---------- */
var JF = 0.7;
var BOATC = [[226, 66, 60], [248, 196, 56], [60, 160, 204], [92, 190, 112], [244, 242, 236], [238, 120, 90]];
function pedalBoat(x, y, col, i, wob) {
  var by = y + Math.round(Math.sin(tm * 1.3 + i * 1.7) * wob);
  var hull = lit(col, x), dk = lit(mixc(col, [0, 0, 0], 0.45), x), hi = lit(mixc(col, [255, 255, 255], 0.4), x);
  rect(x + 1, by - 3, 12, 3, hull); px(x, by - 3, hull); px(x + 13, by - 3, hull); px(x + 14, by - 2, hull);
  rect(x + 2, by - 2, 11, 1, hi); rect(x + 1, by, 12, 1, dk);
  var can = lit(i % 2 ? [250, 236, 214] : [238, 120, 90], x);
  rect(x + 2, by - 8, 10, 2, can); for (var k = 0; k < 5; k++) px(x + 2 + k * 2, by - 6, can);
  px(x + 3, by - 6, dk); px(x + 10, by - 6, dk); px(x + 3, by - 5, dk); px(x + 10, by - 5, dk);
  rect(x + 5, by - 6, 2, 2, lit([150, 100, 80], x)); rect(x + 8, by - 6, 2, 2, lit([60, 50, 70], x));
  for (k = 0; k < 4; k++) px(x - 1 + k * 5 + Math.round(Math.sin(tm * 2 + k + i)), by + 1, P.wLight, 0.4);
}
function drawFarBoats() {
  var home = ss(0.2, 0.55, D);
  var pier = WD.pierS;
  for (var i = 0; i < 6; i++) {
    var h0 = pier - 160 + i * 70 + h2(i, 311) * 40, dock = pier + 44 + i * 5;
    var bs = lerp(h0 + Math.sin(tm * 0.15 + i) * 6, dock, home);
    var x = Math.round(SX(bs, 0.55)), y = 214 + (i % 3) * 3 + Math.round(home * 8);
    if (x < -10 || x > W + 4) continue;
    var c = lit(BOATC[i % 6], x);
    rect(x, y, 7, 2, c); rect(x + 1, y - 2, 5, 1, lit([250, 236, 214], x)); px(x + 1, y + 2, P.wLight, 0.35);
  }
}
function drawJetty() {
  var jx = Math.round(SX(WD.pierS - 6, JF));
  if (jx > W + 4 || jx < -170) return;
  var wood = lit(P.wood, jx + 20), woodD = lit(mixc(P.wood, [0, 0, 0], 0.45), jx + 20);
  for (var p = 0; p < 10; p++) rect(jx + 3 + p * 14, 238, 2, 7, woodD);
  rect(jx, 236, 150, 2, wood); rect(jx, 238, 150, 1, woodD);
  for (p = 0; p < 37; p++) px(jx + 2 + p * 4, 236, woodD);
  rect(jx + 4, 227, 14, 9, lit(P.bldg, jx));
  rect(jx + 2, 225, 18, 2, lit(mixc(P.bldg, [0, 0, 0], 0.3), jx));
  var lw = ss(0.25, 0.65, D);
  rect(jx + 6, 229, 4, 4, mixc(mixc(P.bldg, [0, 0, 0], 0.55), [255, 214, 130], lw));
  rect(jx + 12, 229, 4, 6, mixc(mixc(P.bldg, [0, 0, 0], 0.6), [255, 214, 130], lw * 0.7));
  rect(jx + 26, 226, 1, 10, woodD); rect(jx + 56, 226, 1, 10, woodD);
  rect(jx + 22, 217, 39, 9, lit([248, 238, 214], jx + 30));
  rect(jx + 22, 217, 39, 1, lit([200, 120, 80], jx)); rect(jx + 22, 225, 39, 1, lit([200, 120, 80], jx));
  text3('BOAT CLUB', jx + 26, 219, lit([40, 34, 64], jx));
  glow(jx + 41, 222, 22, WARM, 0.35 * lw, 9);
  var dockN = ss(0.2, 0.55, D);
  for (var i = 0; i < 5; i++) pedalBoat(jx + 56 + i * 22 + (i % 2), 241 + (i % 3), BOATC[i], i, 1);
  /* a sixth boat comes in to the end of the jetty as the light goes */
  if (dockN > 0.6) pedalBoat(jx + 166, 242, BOATC[5], 5, 1);
}
/* ---------- the Regulator End: gates on the water, and the end of the walk ---------- */
function drawRegulator() {
  var gx = Math.round(SX(WD.L - 14, 0.95));
  if (gx > W + 6 || gx < -110) return;
  var lw = ss(0.3, 0.7, D);
  var conc = mixc(P.conc, [150, 170, 220], 0.35 * D), concD = mixc(conc, [0, 0, 0], 0.3), steel = mixc(P.steel, [120, 140, 190], 0.4 * D);
  rect(gx - 4, 244, 100, 8, concD);
  for (var i = 0; i < 4; i++) {
    var px0 = gx + i * 25;
    rect(px0, 214, 6, 32, conc); rect(px0, 214, 1, 32, mixc(conc, [255, 230, 190], 0.25 * (1 - D))); rect(px0 + 5, 214, 1, 32, concD);
    rect(px0 - 1, 211, 8, 3, concD);
    rect(px0 + 1, 205, 4, 6, conc); rect(px0, 204, 6, 1, concD);
    px(px0 + 2, 207, [255, 214, 130], lw);
    if (i < 3) {
      for (var y = 228; y < 246; y++) rect(px0 + 6, y, 19, 1, (y % 3 === 0) ? mixc(steel, [0, 0, 0], 0.35) : steel);
      rect(px0 + 6, 226, 19, 2, mixc(steel, [200, 210, 230], 0.2 * (1 - 0.5 * D)));
      for (var f = 0; f < 6; f++) { var fx = px0 + 7 + f * 3 + Math.round(Math.sin(tm * 3 + f + i)); px(fx, 246, [236, 244, 255], 0.55); px(fx + 1, 245, [236, 244, 255], 0.35); }
      for (f = 0; f < 4; f++) px(px0 + 8 + f * 5, 232, mixc(steel, [255, 214, 130], lw * 0.5));
    }
  }
  rect(gx - 2, 214, 82, 2, concD); rect(gx - 2, 216, 82, 1, mixc(concD, [0, 0, 0], 0.3));
  rect(gx - 2, 210, 82, 1, mixc(conc, [0, 0, 0], 0.2));
  for (var r = 0; r < 41; r++) px(gx - 2 + r * 2, 211, mixc(conc, [0, 0, 0], 0.3));
  for (i = 0; i < 4; i++) {
    var lx = gx + i * 25 + 3;
    glow(lx, 207, 12, [255, 230, 170], 0.7 * lw, 9);
    glow(lx, 232, 14, [255, 230, 170], 0.35 * lw, 14);
  }
  px(gx + 78, 200, [255, 70, 60], 0.5 + 0.5 * Math.sin(tm * 3)); rect(gx + 78, 201, 1, 9, concD);
}
/* ---------- promenade ---------- */
function drawWall() {
  var face = P.wallc, faceD = mixc(P.wallc, [0, 0, 0], 0.3);
  rect(0, 244, W, 2, P.capc); rect(0, 244, W, 1, mixc(P.capc, [255, 240, 210], 0.3 * (1 - D)));
  for (var y = 246; y < 252; y++) for (var x = 0; x < W; x++) {
    var wx = Math.floor(x + camX);
    var brick = (((y - 246) % 3 === 2) || (mod(wx + ((y - 246) >= 3 ? 4 : 0), 8) === 0));
    px(x, y, brick ? faceD : face);
  }
  rect(0, 251, W, 1, mixc(P.wallc, [0, 0, 0], 0.5));
  var pc = mixc(P.wallc, P.capc, 0.4);
  for (var k = Math.floor((camX - 8) / 36); k < Math.ceil((camX + W + 8) / 36); k++) {
    var sx = Math.round(k * 36 + 6 - camX);
    rect(sx - 2, 240, 5, 4, P.capc); rect(sx - 2, 240, 5, 1, mixc(P.capc, [255, 240, 210], 0.3 * (1 - D)));
    rect(sx - 1, 246, 3, 6, pc);
  }
}
function drawWalk() {
  var spac = [[252, 262, 14], [262, 276, 18], [276, 294, 24], [294, 314, 32], [314, 322, 40]];
  for (var b = 0; b < spac.length; b++) {
    var s = spac[b];
    rect(0, s[0], W, 1, P.walkJ, 0.8);
    for (var k = -2; k < Math.ceil(W / s[2]) + 3; k++) {
      var jx = Math.round(k * s[2] + (b % 2) * s[2] / 2 - mod(camX, s[2] * 2));
      for (var y = s[0]; y < s[1]; y++) px(jx, y, P.walkJ, 0.6);
    }
  }
  rect(0, 252, W, 2, mixc(P.walk, [0, 0, 0], 0.4), 0.5);
  rect(0, 321, W, 1, mixc(P.capc, P.walk, 0.4));
}
/* steps down to the jogging trail, cut into the near edge of the walk */
function drawStairs() {
  for (var i = 0; i < WD.stairs.length; i++) {
    var x = Math.round(SX(WD.stairs[i]));
    if (x < -30 || x > W + 30) continue;
    var topc = lit(mixc(P.walk, [255, 235, 200], 0.1), x), sd = lit(mixc(P.walkJ, [0, 0, 0], 0.35), x);
    for (var r = 0; r < 5; r++) {
      var y = 316 + r * 4, hw = 17 + r * 2;
      rect(x - hw, y, hw * 2, 3, r % 2 ? lit(P.walkJ, x) : topc);
      rect(x - hw, y + 3, hw * 2, 1, sd);
    }
    /* the trail below, and a rail either side */
    rect(x - 33, 342, 66, 6, lit(mixc(P.ground, P.walk, 0.3), x));
    rect(x - 33, 342, 66, 1, lit(mixc(P.ground, P.walk, 0.5), x));
    person({ x: x - 26 + mod(tm * 8 + i * 17, 52), y: 348, h: 13, dir: 1, ph: tm * 9, legs: [200, 80, 90], body: [70, 170, 150], skin: [176, 120, 90], hair: [26, 20, 28] });
    var rc = lit([96, 96, 108], x);
    for (var sgn = -1; sgn <= 1; sgn += 2) { rect(x + sgn * 17 - 1, 306, 2, 12, rc); rect(x + sgn * 17 - 1, 306, 2, 1, lit([180, 180, 190], x)); rect(x + sgn * 19, 318, 1, 18, rc); }
    text3('STEPS', x - 8, 311, lit([230, 220, 200], x));
  }
}
function stairGap(wx) { /* true where the hedge is cut for stairs (hedge moves with the walk) */
  for (var i = 0; i < WD.stairs.length; i++) { var dx = wx - WD.stairs[i] * PPM; if (dx > -36 && dx < 36) return true; }
  return false;
}
function drawLampPools() {
  for (var i = 0; i < lamps.length; i++) {
    var l = lamps[i]; if (l.on <= 0.02) continue;
    glow(l.x + 3, 280, 40, WARM, 0.3 * l.on, 14, 8);
  }
}
function drawLampPost(l) {
  var x = l.x, dark = lit([70, 56, 74], x);
  rect(x - 2, 262, 5, 3, dark); rect(x - 1, 224, 2, 38, dark);
  rect(x - 1, 224, 1, 38, lit([120, 100, 110], x));
  rect(x, 222, 5, 1, dark); rect(x + 4, 222, 1, 2, dark);
  var gc = mixc(lit([120, 110, 130], x), [255, 232, 160], l.on);
  rect(x + 2, 223, 5, 3, gc); px(x + 3, 226, gc); px(x + 5, 226, gc); rect(x + 2, 221, 5, 1, dark);
}
function drawLampGlowAndReflect(l) {
  if (l.on > 0.02) {
    glow(l.x + 4, 224, 17, WARM, 0.6 * l.on, 15);
    glow(l.x + 4, 224, 5, [255, 245, 210], 0.7 * l.on, 5);
    glow(l.x + 4, 243, 12, WARM, 0.3 * l.on, 3);
    for (var r = 0; r < 18; r++) {
      var y = 243 - r;
      var sh = Math.round(Math.sin(tm * 2.2 + r * 0.9 + l.i) * (1 + r * 0.12));
      if (h2(r + l.i * 7, Math.floor(tm * 2.5 + r)) > 0.33) {
        var w = r < 3 ? 3 : (r > 9 ? 1 : 2) + (h2(r, 3) > 0.6 ? 1 : 0);
        rect(l.x + 3 + sh - Math.floor(w / 2), y, w, 1, [255, 220, 140], l.on * (0.75 - r / 28));
      }
    }
  }
}
/* ---------- foreground: hedge, blossom, grass ---------- */
function drawForeground() {
  var bl = SEA.bloom === 'jacaranda' ? [168, 134, 214] : SEA.bloom === 'amaltas' ? [236, 206, 84] : SEA.kind === 'autumn' ? [206, 120, 64] : null;
  var hed = mixc(P.hedge, [0, 0, 0], 0), hedD = mixc(P.hedge, [0, 0, 0], 0.35);
  var blc = bl ? mixc([bl[0] * AMB * TR, bl[1] * AMB * TG, bl[2] * AMB * TB], P.hedgeTop, 0.1) : null;
  for (var x = 0; x < W; x++) {
    var wx = mod(Math.floor(x + camX), 360), h = HEDGE[wx];
    if (stairGap(Math.floor(x + camX))) { rect(x, 349, 1, 4, hed); continue; }
    for (var j = 0; j <= h; j++) {
      var yy = 340 - j;
      var c = j >= h - 1 ? P.hedgeTop : (h2(wx, yy) < 0.2 ? hedD : hed);
      if (blc && j > h - 5 && h2(wx + 900, yy) < 0.42) c = blc;
      px(x, yy, c);
    }
    rect(x, 341, 1, 10, hed);
  }
  for (var i = 0; i < 60; i++) {
    var gx = Math.round(mod(h2(i, 77) * 360 - camX * 1.25 + 60, 360) - 60);
    if (gx < 0 || gx >= W) continue;
    var gh = 10 + Math.floor(h2(i, 78) * 18), lean = h2(i, 79) > 0.5 ? 1 : -1, gy = 390 + OYB;
    for (var k = 0; k < gh; k++) px(gx + Math.round(lean * k * k / 70 + Math.sin(tm * 1.5 + i) * k / 12), gy - k, mixc(P.hedge, P.hedgeTop, 0.3 + 0.4 * (k / gh)));
    if (i % 5 === 0) px(gx + Math.round(lean * gh * gh / 70), gy - gh, bl && i % 10 === 0 ? blc : P.hedgeTop);
  }
}

/* ---------- people sprites ---------- */
function person(o) {
  var x = Math.round(o.x), y = Math.round(o.y), h = o.h, s = o.dir || 1;
  var head = Math.max(4, Math.round(h * 0.17)), leg = Math.round(h * 0.44), tor = h - head - leg, tw = Math.max(5, Math.round(h * 0.2));
  var ph = o.ph === undefined ? 0 : o.ph, sw = o.ph === undefined ? 0 : Math.round(Math.sin(ph) * h * 0.11);
  var rimA = clamp(1 - D / 0.65, 0, 1) * 0.75;
  var rim = [255, 214, 150];
  function L(c) { return lit(c, x); }
  /* the sun is behind the viewer (WSW), so figures are lit from the front and the shadow falls away from us */
  rect(x - tw, y, tw * 2, 1, [0, 0, 0], 0.22);
  if (D < 0.5) rect(x - 1, y - 1, tw + 1, 1, [20, 14, 34], 0.16 * (1 - D * 2));
  var legc = L(o.legs), body = L(o.body), skin = L(o.skin), hair = L(o.hair);
  function limb(x0, y0, x1, y1, w, c) {
    var n = Math.max(1, y1 - y0);
    for (var yy = y0; yy <= y1; yy++) rect(Math.round(x0 + (x1 - x0) * (yy - y0) / n) - Math.floor(w / 2), yy, w, 1, c);
  }
  var hipY = y - leg, topY = y - h;
  var lw = h >= 20 ? 2 : 1;
  /* back arm, back leg */
  var back = mixc(legc, [0, 0, 0], 0.3);
  limb(x, hipY, x - sw * s, y - 1, lw + (h > 22 ? 1 : 0), back);
  rect(x - sw * s - (s > 0 ? 0 : 1) + (s > 0 ? 0 : 0), y - 1, 3, 1, back);
  var armc = L(o.arm || o.body);
  if (!o.still) limb(x, topY + head + 1, x + sw * s * 0.9, topY + head + Math.round(tor * 0.85), 1, mixc(armc, [0, 0, 0], 0.3));
  /* torso */
  var tx = x - Math.floor(tw / 2);
  rect(tx, topY + head, tw, tor, body);
  if (o.long) {
    var ext = Math.round(leg * 0.55);
    for (var r = 0; r < ext; r++) { var wd = tw + Math.floor(r / 3); rect(x - Math.floor(wd / 2), topY + head + tor + r, wd, 1, body); }
    if (o.band) { rect(x - Math.floor(tw / 2) - 1, topY + head + tor + ext - 2, tw + 3, 1, L(o.band)); }
  }
  if (o.sash) { for (r = 0; r < tor; r++) px(tx + Math.min(tw - 1, r), topY + head + r, L(o.sash)); px(tx, topY + head, L(o.sash)); }
  rect(s > 0 ? tx + tw - 1 : tx, topY + head, 1, tor, mixc(body, rim, rimA));
  if (o.shawl) {
    var shc = L(o.shawl);
    rect(tx - 1, topY + head, tw + 2, 3, shc); rect(tx - 1, topY + head + 3, 2, 3, shc); rect(tx + tw - 1, topY + head + 3, 2, 2, shc);
  }
  /* front leg */
  var frontLegTop = o.long ? hipY + Math.round(leg * 0.55) : hipY;
  limb(x, frontLegTop, x + sw * s, y - 1, lw + (h > 22 ? 1 : 0), legc);
  rect(x + sw * s - (s > 0 ? 0 : 2), y - 1, 3, 1, legc);
  if (rimA > 0.05) px(x + sw * s - Math.floor(lw / 2), y - 2, mixc(legc, rim, rimA));
  /* front arm */
  if (!o.still) limb(x, topY + head + 1, x - sw * s * 0.9, topY + head + Math.round(tor * 0.85), 1, armc);
  else rect(x - s, topY + head + Math.round(tor * 0.4), 1, 3, armc);
  /* head */
  var hr = head / 2, hcx = x + s * 0.4, hcy = topY + hr;
  for (var yy = 0; yy < head; yy++) for (var xx = -Math.ceil(hr); xx <= Math.ceil(hr); xx++) {
    var dx = xx + 0.5 - (head % 2 ? 0.5 : 0), dy = yy + 0.5 - hr;
    if (dx * dx + dy * dy <= hr * hr + 0.5) {
      var pxx = Math.round(hcx + xx), isHair = (yy < head * 0.42) || (s > 0 ? xx < -hr * 0.3 : xx > hr * 0.3);
      px(pxx, topY + yy, isHair ? hair : skin);
    }
  }
  px(Math.round(hcx + s * Math.ceil(hr)), topY + Math.floor(head / 2), mixc(skin, rim, rimA * 0.6));
  if (o.pony) { for (var p = 0; p < 4; p++) px(x - s * (Math.ceil(hr) + 1 + (p > 1 ? 1 : 0)), topY + 2 + p + Math.round(Math.sin(tm * 3 + p) * (p > 2 ? 1 : 0)), hair); }
  if (o.dupatta) {
    var dc = L(o.dupatta);
    for (p = 0; p < 5; p++) { var wy = topY + head + 3 + p + Math.round(Math.sin(tm * 2.4 + p * 0.8) * 0.8); rect(x - s * (Math.floor(tw / 2) + 1 + (p > 2 ? 1 : 0)), wy, 2, 2, dc); }
    for (p = 0; p < Math.min(tor, 7); p++) px(x + s * 0, topY + head + p, dc);
  }
  if (o.jacket) { rect(tx, topY + head + tor - 1, tw, 1, mixc(body, [0, 0, 0], 0.4)); }
}
function balloons(x, y, h, i) {
  var cols = [[226, 60, 70], [246, 202, 62], [74, 150, 224], [96, 192, 124], [226, 120, 200], [250, 250, 244]];
  var hx = Math.round(x + 4), hy = Math.round(y - h * 0.5);
  for (var k = 0; k < 6; k++) {
    var sway = Math.sin(tm * 1.5 + k * 1.1 + i) * 1.5;
    var bx = hx + (k - 2.5) * 3 + sway, by = hy - 14 - k % 3 * 3 + Math.round(Math.sin(tm * 2 + k) * 1);
    var c = lit(cols[k], x), em = mixc(c, cols[k], 0.4 * D);
    for (var s = 0; s < 14; s++) px(hx + (bx - hx) * s / 14, hy - s, [210, 200, 190], 0.6);
    px(bx - 1, by - 2, em); px(bx, by - 2, em); px(bx - 2, by - 1, em); px(bx - 1, by - 1, mixc(em, [255, 255, 255], 0.5)); px(bx, by - 1, em); px(bx + 1, by - 1, em);
    px(bx - 2, by, em); px(bx - 1, by, em); px(bx, by, em); px(bx + 1, by, em); px(bx - 1, by + 1, em); px(bx, by + 1, em); px(bx, by + 2, mixc(em, [0, 0, 0], 0.3));
  }
}
function vendor(x, y, type) {
  var lw = ss(0.0, 0.5, D);
  var own = { x: x + 15, y: y, h: 21, dir: -1, still: true, legs: [52, 44, 60], body: [186, 150, 98], skin: [160, 110, 84], hair: [30, 24, 30] };
  if (SEA.coats) own.shawl = [150, 130, 110];
  person(own);
  var wood = lit([82, 112, 152], x), woodD = lit([48, 66, 98], x), top = lit([210, 176, 128], x);
  rect(x - 10, y - 14, 22, 9, wood); rect(x - 10, y - 14, 22, 1, mixc(wood, [255, 255, 255], 0.2)); rect(x - 10, y - 6, 22, 1, woodD);
  rect(x - 12, y - 16, 26, 2, top);
  rect(x - 9, y - 12, 8, 5, woodD);
  /* wheel */
  var wc = lit([30, 28, 38], x);
  for (var a = 0; a < 16; a++) px(x + 3 + Math.round(Math.cos(a / 16 * 6.28) * 4), y - 4 + Math.round(Math.sin(a / 16 * 6.28) * 4), wc);
  px(x + 3, y - 4, wc); px(x + 3 + Math.round(Math.cos(tm * 3) * 2), y - 4 + Math.round(Math.sin(tm * 3) * 2), wc);
  rect(x - 9, y - 5, 2, 5, woodD);
  if (type === 'bhutta') {
    var fl = 0.7 + 0.3 * Math.sin(tm * 9 + 1.3) * Math.sin(tm * 5);
    rect(x + 3, y - 18, 8, 2, [60, 40, 40]);
    for (var k = 0; k < 4; k++) px(x + 4 + k * 2, y - 18, [255, 120 + 40 * fl, 40], 0.6 + 0.4 * fl);
    for (k = 0; k < 3; k++) { var ph = (tm * 1.4 + k * 0.33) % 1; px(x + 5 + k * 2 + Math.round(Math.sin(tm * 3 + k) * 1), y - 19 - Math.round(ph * 9), [255, 170, 70], (1 - ph) * 0.8); }
    for (k = 0; k < 2; k++) rect(x + 5 + k * 4, y - 20, 3, 2, lit([236, 196, 80], x)); /* corn cobs */
    glow(x + 7, y - 17, 14, [255, 120, 50], 0.5 * (0.5 + 0.5 * lw), 9);
  } else if (type === 'chuski') { /* a block of ice and rows of coloured syrup bottles */
    rect(x + 2, y - 21, 9, 5, lit([196, 226, 244], x)); rect(x + 2, y - 21, 9, 1, lit([240, 250, 255], x)); px(x + 5, y - 19, lit([250, 255, 255], x));
    var sy = [[220, 60, 70], [250, 160, 50], [90, 190, 110], [150, 80, 190], [250, 220, 80]];
    for (var q = 0; q < 5; q++) { rect(x - 7 + q * 2, y - 22, 1, 6, lit(sy[q], x)); px(x - 7 + q * 2, y - 23, lit([220, 220, 230], x)); }
    glow(x + 3, y - 17, 12, [255, 200, 120], 0.3 * lw, 8);
  } else if (type === 'toys') { /* small spinning light toys on a pole */
    rect(x + 6, y - 28, 1, 12, lit([90, 80, 90], x));
    for (var tq = 0; tq < 4; tq++) {
      var ta = tm * 4 + tq * 1.57, tcx = x + 6 + Math.round(Math.cos(ta) * 4), tcy = y - 27 + (tq % 2) * 3 + Math.round(Math.sin(ta) * 1);
      var tc = [[255, 90, 120], [90, 220, 255], [255, 230, 90], [150, 255, 140]][tq];
      px(tcx, tcy, mixc(lit(tc, x), tc, 0.5 * lw)); px(tcx + 1, tcy, mixc(lit(tc, x), tc, 0.5 * lw), 0.6);
      glow(tcx, tcy, 6, tc, 0.35 * lw, 5);
    }
  } else {
    rect(x + 3, y - 23, 6, 7, lit([150, 150, 160], x)); rect(x + 9, y - 22, 2, 1, lit([150, 150, 160], x)); rect(x + 4, y - 24, 4, 1, lit([100, 100, 110], x));
    for (k = 0; k < 4; k++) { var p2 = (tm * 0.8 + k * 0.25) % 1; px(x + 5 + Math.round(Math.sin(tm * 2 + k * 2) * (1 + p2 * 2)), y - 26 - Math.round(p2 * 10), [236, 236, 244], (1 - p2) * 0.6); }
    glow(x + 6, y - 16, 12, [255, 170, 80], 0.35 * lw, 8);
  }
  /* umbrella */
  rect(x - 2, y - 40, 1, 24, lit([90, 80, 90], x));
  for (var u = -14; u <= 14; u++) {
    var hy = Math.round((u * u) / 90);
    var sc = (Math.floor((u + 14) / 4) % 2) ? [236, 226, 206] : [214, 70, 70];
    var cu = lit(sc, x);
    rect(x - 2 + u, y - 41 + hy, 1, 3 - Math.min(2, Math.floor(Math.abs(u) / 7)), cu);
  }
  px(x - 2, y - 43, lit([90, 80, 90], x)); px(x - 2, y - 42, lit([250, 220, 120], x));
  /* hanging bulb */
  rect(x + 13, y - 38, 1, 5, [60, 50, 60]);
  rect(x + 12, y - 33, 3, 2, mixc([120, 110, 100], [255, 236, 170], lw));
  glow(x + 13, y - 32, 16, WARM, 0.9 * lw, 14);
}

/* ---------- a person seen from behind (she and her companion at the rail) ---------- */
function personBack(o) {
  var x = Math.round(o.x), y = Math.round(o.y), h = o.h, s = o.dir || 1;
  var head = Math.max(4, Math.round(h * 0.17)), leg = Math.round(h * 0.44), tor = h - head - leg, tw = Math.max(6, Math.round(h * 0.23));
  var sw = o.ph === undefined ? 0 : Math.round(Math.sin(o.ph) * 1.2);
  var rimA = clamp(1 - D / 0.7, 0, 1) * 0.8, rim = [255, 222, 160];
  function L(c) { return lit(c, x); }
  var legc = L(o.legs), body = L(o.body), skin = L(o.skin), hair = L(o.hair);
  rect(x - tw, y, tw * 2, 1, [0, 0, 0], 0.22);
  var hipY = y - leg, topY = y - h, lw = h >= 20 ? 2 : 1;
  var legTop = o.long ? hipY + Math.round(leg * 0.55) : hipY;
  var back = mixc(legc, [0, 0, 0], 0.25);
  rect(x - lw, legTop, lw, y - legTop - (sw > 0 ? 1 : 0), back);
  rect(x, legTop, lw, y - legTop - (sw < 0 ? 1 : 0), legc);
  px(x - lw, y - 1 - (sw > 0 ? 1 : 0), mixc(legc, [0, 0, 0], 0.5)); px(x + lw - 1, y - 1 - (sw < 0 ? 1 : 0), mixc(legc, [0, 0, 0], 0.5));
  var tx = x - Math.floor(tw / 2);
  rect(tx, topY + head, tw, tor, body);
  rect(tx - 1, topY + head, tw + 2, 2, body);
  if (o.long) {
    var ext = Math.round(leg * 0.55);
    for (var r = 0; r < ext; r++) { var wd = tw + Math.floor(r / 3); rect(x - Math.floor(wd / 2), topY + head + tor + r, wd, 1, body); }
    if (o.band) rect(x - Math.floor(tw / 2) - 1, topY + head + tor + ext - 2, tw + 3, 1, L(o.band));
  }
  if (o.jacket) rect(tx, topY + head + tor - 1, tw, 1, mixc(body, [0, 0, 0], 0.4));
  var armc = mixc(body, [0, 0, 0], 0.18);
  rect(tx - 1, topY + head + 2, 1, Math.round(tor * 0.8), armc); rect(tx + tw, topY + head + 2, 1, Math.round(tor * 0.8), armc);
  if (o.rail) { px(tx - 2, topY + head + Math.round(tor * 0.55), armc); px(tx + tw + 1, topY + head + Math.round(tor * 0.55), armc); px(tx - 2, topY + head + Math.round(tor * 0.55) - 1, skin); px(tx + tw + 1, topY + head + Math.round(tor * 0.55) - 1, skin); }
  else { px(tx - 1, topY + head + 2 + Math.round(tor * 0.8), skin); px(tx + tw, topY + head + 2 + Math.round(tor * 0.8), skin); }
  if (o.shawl) { var sc = L(o.shawl); rect(tx - 1, topY + head, tw + 2, 4, sc); rect(tx, topY + head + 4, tw, 2, sc); px(tx - 1, topY + head + 4, sc); px(tx + tw, topY + head + 4, sc); }
  if (o.dupatta) {
    var dc = L(o.dupatta);
    rect(tx - 1, topY + head, tw + 2, 3, dc);
    for (var p = 0; p < Math.min(tor + 2, 9); p++) px(x + s * (Math.floor(tw / 2) - 0) + (p > 5 ? s : 0) + Math.round(Math.sin(tm * 2.2 + p * 0.7) * 0.6), topY + head + 3 + p, dc);
    px(x + s * (Math.floor(tw / 2) + 1), topY + head + 3, dc);
  }
  var hr = head / 2, cy = topY + hr;
  for (var yy = 0; yy < head; yy++) for (var xx = -Math.ceil(hr); xx <= Math.ceil(hr); xx++) {
    var dx = xx + 0.5 - (head % 2 ? 0.5 : 0), dy = yy + 0.5 - hr;
    if (dx * dx + dy * dy <= hr * hr + 0.5) px(x + xx, topY + yy, hair);
  }
  px(x, topY + head - 1, skin); px(x - 1, topY + head - 1, skin, 0.5);
  if (o.pony) rect(x, topY + head, 1, 6, hair);
  if (rimA > 0.05) { px(x, topY, mixc(hair, rim, rimA)); px(x - 1, topY, mixc(hair, rim, rimA * 0.6)); px(tx - 1, topY + head, mixc(body, rim, rimA * 0.7)); px(tx + tw, topY + head, mixc(body, rim, rimA * 0.7)); }
}
/* ---------- a dog ---------- */
function dog(x, y, dir, ph, col) {
  var c = lit(col, x), d = lit(mixc(col, [0, 0, 0], 0.4), x), s = dir > 0 ? 1 : -1;
  rect(x - 4, y, 9, 1, [0, 0, 0], 0.2);
  var lg = Math.round(Math.sin(ph));
  rect(x - 3 + lg, y - 3, 1, 3, d); rect(x + 3 - lg, y - 3, 1, 3, d); rect(x - 2 - lg, y - 3, 1, 3, d); rect(x + 2 + lg, y - 3, 1, 3, d);
  rect(x - 3, y - 6, 7, 3, c);
  rect(x + (s > 0 ? 4 : -6), y - 8, 3, 3, c); px(x + (s > 0 ? 7 : -7), y - 7, d);
  px(x + (s > 0 ? 4 : -4), y - 9, d);
  px(x + (s > 0 ? -4 : 4), y - 7 - Math.round(Math.sin(tm * 9) * 0.6 + 0.4), c);
}
/* ---------- fences: the entry gate with its chain, and the railing at the end of the walk ---------- */
function fence(x, yF, yN, hF, hN, dx, bars, col, chain) {
  var c = lit(col, x), cd = lit(mixc(col, [0, 0, 0], 0.4), x), i, t;
  var topF = yF - hF, topN = yN - hN;
  if (!chain) {
    for (i = 0; i <= bars; i++) { t = i / bars; var xx = x + dx * t, y0 = lerp(topF, topN, t), y1 = lerp(yF, yN, t); rect(xx, y0 + (y1 - y0) * 0.1, 1, (y1 - y0) * 0.9, cd); }
    for (i = 0; i <= 30; i++) { t = i / 30; px(x + dx * t, lerp(topF, topN, t), c); px(x + dx * t, lerp(topF, topN, t) + (lerp(yF, yN, t) - lerp(topF, topN, t)) * 0.45, c); }
  } else {
    for (i = 0; i <= 30; i++) { t = i / 30; px(x + dx * t, lerp(yF - hF * 0.62, yN - hN * 0.62, t) + Math.sin(Math.PI * t) * 8, cd); if (i % 3 === 0) px(x + dx * t, lerp(yF - hF * 0.62, yN - hN * 0.62, t) + Math.sin(Math.PI * t) * 8 + 1, c, 0.7); }
  }
  rect(x - 1, topF, 3, hF, c); rect(x - 1, topF - 1, 3, 1, lit([200, 190, 170], x));
  rect(x + dx - 1, topN, 4, hN, c); rect(x + dx - 1, topN - 1, 4, 1, lit([200, 190, 170], x));
  rect(x + dx - 1, topN, 1, hN, lit([226, 214, 190], x));
}
/* ---------- the pill that names the companion ---------- */
function pill(x, y) {
  var s = 'AI SIMAR', w = measure3(s) + 10;
  x = clamp(Math.round(x), Math.ceil(w / 2) + 1, W - Math.ceil(w / 2) - 1);
  var x0 = Math.round(x - w / 2);
  rect(x0 + 1, y, w - 2, 9, [250, 238, 214]); rect(x0, y + 1, w, 7, [250, 238, 214]);
  rect(x0 + 1, y + 8, w - 2, 1, [196, 150, 110]);
  rect(x0 + 3, y + 3, 3, 3, [60, 190, 190]); px(x0 + 4, y + 4, [220, 255, 250]);
  text3(s, x0 + 8, y + 2, [44, 34, 70]);
  rect(Math.round(x) - 1, y + 9, 3, 1, [250, 238, 214]); px(Math.round(x), y + 10, [250, 238, 214]);
}

/* ---------- people: the crowd, by place and by dusk ---------- */
var CLOTH_M = [[70, 110, 96], [96, 74, 120], [150, 140, 96], [88, 96, 70], [160, 116, 72], [120, 62, 62], [70, 70, 80], [190, 170, 130]];
var CLOTH_W = [[126, 140, 84], [60, 138, 128], [196, 70, 110], [170, 120, 60], [110, 90, 160], [226, 120, 70]];
var DUP = [[246, 196, 92], [236, 226, 206], [90, 170, 190], [226, 120, 70], [180, 90, 140]];
var SKINS = [[176, 120, 90], [192, 134, 100], [168, 114, 88], [150, 104, 80]];
var CROWD = [];
function addPerson(home) {
  var n = CROWD.length;
  var ty = ['walk', 'walk', 'walk', 'brisk', 'elder', 'couple', 'couple', 'family', 'jog'][Math.floor(h2(n, 411) * 9)];
  var v = { walk: 1.2, brisk: 1.7, elder: 0.8, couple: 1.0, family: 0.9, jog: 2.6 }[ty] * (0.85 + h2(n, 412) * 0.3);
  var amp = Math.min(40 + h2(n, 413) * 140, home - 4, WD.L - 4 - home);
  if (amp < 6) return;
  var far = h2(n, 414) < 0.6, woman = h2(n, 416) < 0.5;
  CROWD.push({
    home: home, amp: amp, v: v, w: v / amp, ph0: h2(n, 417) * 6.28, y: far ? 266 + Math.floor(h2(n, 415) * 16) : 311 + Math.floor(h2(n, 415) * 9),
    type: ty, woman: woman, r: h2(n, 410), on: true, s: home, dir: 1, pa: h2(n, 418) * 6.28,
    cm: CLOTH_M[Math.floor(h2(n, 419) * CLOTH_M.length)], cw: CLOTH_W[Math.floor(h2(n, 420) * CLOTH_W.length)], cd: DUP[Math.floor(h2(n, 421) * DUP.length)],
    skin: SKINS[Math.floor(h2(n, 422) * SKINS.length)], hair: ty === 'elder' ? [150, 150, 156] : [26, 20, 28], pony: h2(n, 423) < 0.5, wrap: h2(n, 424) < 0.6
  });
}
function addZone(a, b, gap) {
  var s = a;
  while (s < b) { addPerson(s + h2(CROWD.length, 400) * gap * 0.5); s += gap * (0.75 + h2(CROWD.length, 401) * 0.5); }
}
addZone(6, 140, 5.5); addZone(140, 350, 9); addZone(350, 900, 15); addZone(900, 1800, 23); addZone(1800, WD.L - 200, 30); addZone(WD.L - 200, WD.L - 8, 14);
var crowdHere = 0, crowdInit = false;
function evening(dusk) { return 1 - 0.65 * ss(0.45, 1, dusk); }
function laneH(y) { return Math.round(20 + (y - 268) * 0.24); }
function drawOne(p, x, y, h, dir, ph, who) {
  var winter = SEA.coats;
  if (who === 'm') {
    person({ x: x, y: y, h: h, dir: dir, ph: ph, legs: [44, 42, 60], body: winter ? mixc(p.cm, [0, 0, 0], 0.3) : p.cm, long: winter, skin: p.skin, hair: p.hair, jacket: !winter, shawl: winter && p.wrap ? [150, 140, 120] : null });
  } else {
    person({ x: x, y: y, h: h, dir: dir, ph: ph, long: true, legs: p.cw, body: winter ? mixc(p.cw, [0, 0, 0], 0.25) : p.cw, band: [250, 210, 120], dupatta: p.cd, skin: p.skin, hair: [26, 20, 28], pony: p.pony, shawl: winter ? [200, 176, 140] : null });
  }
}
function drawCrowd(p, x) {
  var y = p.y, h = laneH(y), ph = p.pa, dir = p.dir;
  if (p.type === 'couple') {
    drawOne(p, x, y, h, dir, ph, 'm'); drawOne(p, x + 8 * dir, y, Math.round(h * 0.92), dir, ph + 0.5, 'w');
  } else if (p.type === 'family') {
    drawOne(p, x, y, h, dir, ph, p.woman ? 'w' : 'm');
    person({ x: x + 9 * dir, y: y, h: Math.round(h * 0.55), dir: dir, ph: ph * 1.4, legs: [60, 70, 110], body: [244, 196, 70], skin: p.skin, hair: [28, 22, 28], shawl: SEA.coats ? [200, 90, 80] : null });
  } else if (p.type === 'jog') {
    person({ x: x, y: y, h: Math.round(h * 0.95), dir: dir, ph: ph * 2.2, legs: [200, 80, 90], body: [70, 170, 150], skin: p.skin, hair: p.hair, jacket: SEA.coats });
    px(x + (dir > 0 ? -1 : 1), y - Math.round(h * 0.95) + 2, lit([240, 240, 240], x));
  } else if (p.type === 'elder') {
    drawOne(p, x, y, Math.round(h * 0.92), dir, ph * 0.6, p.woman ? 'w' : 'm');
  } else {
    drawOne(p, x, y, h, dir, ph, p.woman ? 'w' : 'm');
  }
}

/* ---------- vendor and fixture positions in metres (the same places as the first-person walk) ---------- */
var FIX = [
  { kind: 'chai', s: 26 }, { kind: 'bhutta', s: 62 }, { kind: 'balloons', s: 96 }, { kind: 'chuski', s: 148 },
  { kind: 'toys', s: 210 }, { kind: 'bhutta', s: WD.stairs[1] + 12 }, { kind: 'dog', s: 470 }, { kind: 'dog', s: 1640 }
];

/* ---------- her and her companion ---------- */
var HER = { legs: [178, 72, 90], body: [212, 90, 104], band: [250, 210, 120], dupatta: [246, 196, 92], skin: [192, 134, 100], hair: [26, 20, 30], pony: true, long: true };
var HIM = { legs: [38, 36, 56], body: [48, 70, 112], skin: [176, 120, 90], hair: [24, 20, 26], jacket: true };
var lean = 0, herPh = 0, herY = 300, herH = 30;
var nv = { s: 0, v: 0, dir: 1, ph: 0, lean: 0, x: 0, y: 290, h: 28, init: false };
var av = { show: 0, screen: { x: 0, y: 0 }, label: 'AI Simar' };
var lastSeason = null, lastDt = 0.016;

function setSeason(se) {
  if (se === lastSeason) return;
  lastSeason = se;
  SEA = { kind: se.kind, haze: se.haze, muddy: !!se.muddy, migrants: !!se.migrants, coats: !!se.coats, crowd: se.crowd || 1, bloom: se.bloom || null, cloud: se.kind === 'monsoon' ? 0.6 : 0 };
  bgKey = '';
}
function snapPose(p, dt, moving, speedAbs) { /* settle a walker onto a standing pose when still */
  if (!moving) p.ph += (Math.round(p.ph / Math.PI) * Math.PI - p.ph) * Math.min(1, dt * 8);
}
function update(dt, st) {
  ST = st; tm = st.t; lastDt = dt;
  setSeason(st.season);
  var axT = (st.dir > 0 ? 0.36 : 0.64) * W;
  AX = crowdInit ? AX + (axT - AX) * Math.min(1, dt * 2.2) : axT;
  var moving = st.speed > 0.15;
  /* the lean: still for a moment, she steps to the parapet and looks at the water */
  var leanT = (st.stillFor > 0.9 && !moving) ? 1 : 0;
  lean += (leanT - lean) * Math.min(1, dt * 2.4);
  if (Math.abs(leanT - lean) < 0.01) lean = leanT;
  var stepping = moving || Math.abs(leanT - lean) > 0.03;
  if (stepping) herPh += dt * Math.max(st.speed, 1.4) * 2.4;
  else herPh += (Math.round(herPh / Math.PI) * Math.PI - herPh) * Math.min(1, dt * 8);
  herY = lerp(300, 258, lean); herH = Math.round(lerp(30, 26, lean));
  /* the companion: a little ahead, matching her pace with easing, stopping when she stops, at the rail on the lean */
  var gapT = lean > 0.5 ? 1.7 : 4.4, target = st.s + st.dir * gapT;
  if (!nv.init || Math.abs(target - nv.s) > 30) { nv.s = target; nv.init = true; nv.dir = st.dir; nv.v = 0; }
  var vt = clamp(st.dir * st.speed + (target - nv.s) * 1.5, -6.5, 6.5);
  nv.v += (vt - nv.v) * Math.min(1, dt * 3);
  nv.s = clamp(nv.s + nv.v * dt, 3, WD.L - 3);
  var nmove = Math.abs(nv.v) > 0.25;
  if (nmove) nv.dir = nv.v > 0 ? 1 : -1;
  if (nmove) nv.ph += dt * Math.max(Math.abs(nv.v), 1.4) * 2.4; else nv.ph += (Math.round(nv.ph / Math.PI) * Math.PI - nv.ph) * Math.min(1, dt * 8);
  var nl = lean > 0.6 ? 1 : 0;
  nv.lean += (nl - nv.lean) * Math.min(1, dt * 1.8);
  if (Math.abs(nl - nv.lean) < 0.01) nv.lean = nl;
  nv.y = lerp(290, 259, nv.lean); nv.h = Math.round(lerp(28, 25, nv.lean));
  nv.x = clamp(AX + (nv.s - st.s) * PPM, 14, W - 14);
  av.show += ((st.withAvatar && st.started ? 1 : 0) - av.show) * Math.min(1, dt * 1.5);
  /* where he is on the phone screen, in CSS px */
  if (cv) {
    av.screen.x = (BX + nv.x * SCALE) * CSSK;
    av.screen.y = (BY + (nv.y - nv.h - 14 + OY) * SCALE) * CSSK;
  }
  /* the crowd */
  var ev = evening(st.dusk) * SEA.crowd, near = 0;
  for (var i = 0; i < CROWD.length; i++) {
    var p = CROWD[i], a = p.ph0 + p.w * st.t;
    p.s = p.home + p.amp * Math.sin(a); p.dir = Math.cos(a) >= 0 ? 1 : -1;
    p.pa += dt * (3 + p.v * 2.2);
    var dist = Math.abs(p.s - st.s);
    if (dist > 40 || !crowdInit) p.on = p.r < ev;
    if (p.on && dist < 40) near++;
  }
  crowdInit = true;
  crowdHere = Math.min(1, near / 8);
}

/* ---------- compose a frame ---------- */
function drawActors() {
  var S = ST.s, items = [], i, x;
  for (i = 0; i < lamps.length; i++) items.push({ y: 262, k: 0, l: lamps[i] });
  var sx0 = SX(2);
  if (sx0 > -30 && sx0 < W + 30) items.push({ y: 296, k: 1, x: Math.round(sx0) });
  var ex = SX(WD.L - 1);
  if (ex > -30 && ex < W + 30) items.push({ y: 296, k: 2, x: Math.round(ex) });
  for (i = 0; i < FIX.length; i++) {
    var f = FIX[i]; x = Math.round(SX(f.s));
    if (x < -40 || x > W + 40) continue;
    if (f.kind === 'dog') {
      var w = Math.sin(tm * 0.3 + i * 2) * 5, dxd = Math.cos(tm * 0.3 + i * 2) >= 0 ? 1 : -1;
      items.push({ y: 316, k: 3, x: Math.round(SX(f.s + w)), dir: dxd, ph: tm * 5 + i, col: i % 2 ? [150, 110, 70] : [60, 54, 60] });
    } else items.push({ y: f.kind === 'balloons' ? 276 : 268, k: 4, x: x, f: f, i: i });
  }
  for (i = 0; i < CROWD.length; i++) {
    var p = CROWD[i]; if (!p.on) continue;
    x = Math.round(SX(p.s));
    if (x < -24 || x > W + 24) continue;
    items.push({ y: p.y, k: 5, x: x, p: p });
  }
  items.push({ y: herY, k: 6 });
  if (av.show > 0.02) items.push({ y: nv.y, k: 7 });
  items.sort(function (a, b) { return a.y - b.y; });
  for (i = 0; i < items.length; i++) {
    var it = items[i];
    switch (it.k) {
      case 0: drawLampPost(it.l); break;
      case 1: fence(it.x, 262, 318, 26, 34, 8, 0, [120, 112, 108], true); break;
      case 2: fence(it.x, 258, 318, 28, 38, 9, 9, [118, 118, 126], false); break;
      case 3: dog(it.x, it.y, it.dir, it.ph, it.col); break;
      case 4: drawFixture(it.f, it.x, it.i); break;
      case 5: drawCrowd(it.p, it.x); break;
      case 6: drawHer(); break;
      case 7: drawHim(); break;
    }
  }
}
function drawFixture(f, x, i) {
  if (f.kind === 'balloons') {
    person({ x: x, y: 276, h: 23, dir: -1, still: true, legs: [60, 50, 70], body: [196, 150, 96], long: true, skin: [166, 116, 88], hair: [30, 24, 30] });
    balloons(x - 1, 276, 23, i);
  } else vendor(x, 268, f.kind);
}
function drawHer() {
  var o = Object.assign({}, HER, { x: AX, y: herY, h: herH, dir: ST.dir });
  if (SEA.coats) o.shawl = [176, 96, 84];
  if (lean > 0.5) { o.rail = lean > 0.85; o.ph = lean < 0.97 ? herPh : undefined; personBack(o); }
  else { o.ph = herPh; person(o); }
}
function drawHim() {
  GA = clamp(av.show, 0, 1);
  var o = Object.assign({}, HIM, { x: nv.x, y: nv.y, h: nv.h, dir: nv.dir });
  if (SEA.coats) { o.long = true; o.body = [60, 66, 96]; o.jacket = false; }
  if (nv.lean > 0.5) { o.rail = nv.lean > 0.85; o.ph = nv.lean < 0.97 ? nv.ph : undefined; personBack(o); }
  else { o.ph = nv.ph; person(o); }
  GA = 1;
}
function render() {
  buf.set(bg);
  computeLamps();
  drawStars(); drawClouds(); drawHills(); drawShore(); drawFarBuildings();
  drawWater(); drawBirds(); drawFarLights(); drawFarBoats(); drawJetty(); drawRegulator();
  drawWall(); drawWalk();
  /* beyond the two ends of the walk the paving stops */
  var e0 = Math.round(SX(0)), e1 = Math.round(SX(WD.L));
  if (e0 > 0) rect(0, 253, Math.min(W, e0), 69, P.ground, 0.6);
  if (e1 < W) rect(Math.max(0, e1), 253, W - Math.max(0, e1), 69, P.ground, 0.6);
  drawStairs(); drawLampPools();
  drawActors();
  for (var i = 0; i < lamps.length; i++) drawLampGlowAndReflect(lamps[i]);
  drawForeground();
  if (av.show > 0.05) {
    GA = clamp(av.show, 0, 1);
    pill(nv.x, nv.y - nv.h - 14);
    GA = 1;
  }
}
function frame(state) {
  if (!buf) return;
  ST = state; tm = state.t;
  setSeason(state.season);
  var key = Math.round(state.dusk * 250) + '|' + SEA.kind + '|' + W + 'x' + H;
  if (key !== bgKey) { bgKey = key; D = state.dusk; applyPalette(); buildBg(); }
  camX = state.s * PPM - AX;
  render();
  loCtx.putImageData(img, 0, 0);
  ctx.drawImage(lo, 0, 0, W, H, BX, BY, W * SCALE, H * SCALE);
}
function resize(dprCap) {
  if (!cv) return;
  var dpr = Math.min(window.devicePixelRatio || 1, dprCap || 1.5);
  var cw = cv.clientWidth || window.innerWidth, ch = cv.clientHeight || window.innerHeight;
  var dw = Math.max(64, Math.round(cw * dpr)), dh = Math.max(64, Math.round(ch * dpr));
  cv.width = dw; cv.height = dh;
  SCALE = Math.max(1, Math.min(Math.round(dw / 180), Math.floor(dh / 300)));
  W = Math.max(96, Math.ceil(dw / SCALE)); H = Math.max(200, Math.ceil(dh / SCALE)); /* overshoot by under one pixel and crop, so no seam shows at the edges */
  BX = Math.floor((dw - W * SCALE) / 2); BY = Math.floor((dh - H * SCALE) / 2); /* zero or slightly negative: the spare sub-pixel rows are cropped; any bar would be filled with the sky colour */
  CSSK = cw / dw;
  var extra = H - DH;
  OYB = extra > 0 ? Math.round(extra * 0.6) : 0; /* spare rows go mostly below the hedge, not into the sky */
  OY = extra - OYB;
  lo.width = W; lo.height = H;
  loCtx = lo.getContext('2d');
  img = loCtx.createImageData(W, H); buf = img.data; bg = new Uint8ClampedArray(W * H * 4);
  ctx.imageSmoothingEnabled = false; ctx.webkitImageSmoothingEnabled = false;
  layout();
  bgKey = '';
}
function init(canvas) {
  cv = canvas; ctx = cv.getContext('2d', { alpha: false });
  lo = document.createElement('canvas');
  resize(1.5);
}
SW.pix = { init: init, resize: resize, frame: frame, info: function () { return { W: W, H: H, scale: SCALE, oy: OY }; } };
SW.pixPeople = {
  update: update, avatar: av,
  crowdNear: function () { return crowdHere; },
  count: function () { return CROWD.filter(function (p) { return p.on; }).length; }
};
})();
