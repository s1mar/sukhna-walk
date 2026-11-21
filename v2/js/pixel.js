/* Sukhna Walk: the pixel art side view (the default art). One low-res buffer, every pixel
   rasterised by hand, no images, no libraries. Design space is 390 rows tall; OY shifts it to the
   real buffer height. Exposes SW.pix (renderer) and SW.pixPeople (crowd, vendors, her companion). */
(function () {
'use strict';
var SW = window.SW, WD = SW.world;
var PPM = 7;              /* buffer px per metre along the walk */
var DH = 390;             /* design height in rows */
var HZ = 134;             /* horizon and far water line, design rows: the lake takes about a quarter of the frame */
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
  /* inks follow notes/LAKE_REFERENCE.md section 6: smoky golden hour, pale warm-grey dusk, and a dull
     brown-grey night under city glow (never navy) */
  skyTop: [[126, 134, 162], [62, 88, 146], [32, 31, 35]],
  skyMid: [[206, 170, 150], [150, 130, 150], [46, 43, 46]],
  skyHor: [[244, 192, 118], [212, 164, 134], [72, 64, 50]],
  ridge1: [[214, 180, 152], [152, 146, 160], [54, 50, 50]],
  ridge2: [[150, 134, 136], [92, 108, 130], [40, 38, 43]],
  ridge3: [[96, 94, 86], [54, 62, 76], [28, 27, 30]],
  haze: [[246, 200, 140], [214, 170, 140], [70, 63, 52]],
  shore: [[44, 46, 40], [18, 18, 24], [13, 13, 12]],
  shoreTop: [[70, 72, 56], [32, 32, 40], [22, 22, 20]],
  reed: [[168, 146, 98], [92, 84, 80], [30, 28, 24]],
  wTop: [[232, 178, 126], [184, 168, 160], [42, 37, 31]],
  wBot: [[150, 118, 98], [122, 110, 110], [20, 17, 16]],
  wLight: [[255, 228, 172], [228, 214, 206], [86, 78, 68]],
  capc: [[204, 178, 132], [128, 120, 116], [54, 52, 52]],
  wallc: [[134, 118, 100], [78, 74, 78], [30, 29, 30]],
  walk: [[188, 166, 138], [98, 96, 100], [42, 42, 46]],
  walkJ: [[160, 140, 116], [78, 76, 82], [31, 31, 35]],
  ground: [[58, 50, 56], [30, 28, 40], [16, 16, 20]],
  hedge: [[44, 64, 50], [24, 36, 40], [10, 15, 14]],
  hedgeTop: [[110, 104, 80], [60, 60, 64], [22, 26, 24]],
  bldg: [[232, 220, 200], [158, 146, 148], [60, 58, 60]],
  conc: [[208, 188, 160], [140, 128, 128], [60, 58, 60]],
  steel: [[40, 40, 46], [28, 28, 36], [14, 14, 16]],
  railB: [[150, 196, 222], [104, 140, 176], [52, 66, 82]],
  cloudT: [[156, 150, 164], [92, 104, 146], [40, 38, 42]],
  cloudB: [[244, 196, 150], [214, 160, 140], [58, 53, 50]]
};

/* the other sky: the earlier pink and purple dusk, violet hills, deep blue starry night. Only these colour
   tables differ (sky, clouds, hills, water tint, far shore tint, night sky, stars); every shape is shared. */
var KD = {
  skyTop: [[74, 104, 164], [46, 44, 104], [8, 12, 36]],
  skyMid: [[236, 150, 110], [156, 78, 116], [18, 28, 66]],
  skyHor: [[255, 208, 122], [240, 132, 100], [40, 58, 102]],
  ridge1: [[178, 130, 152], [96, 66, 116], [36, 48, 92]],
  ridge2: [[142, 98, 130], [68, 48, 98], [26, 36, 74]],
  ridge3: [[104, 70, 106], [46, 36, 76], [13, 20, 44]],
  haze: [[252, 196, 140], [226, 124, 112], [54, 72, 116]],
  shore: [[66, 50, 84], [34, 28, 58], [8, 12, 28]],
  shoreTop: [[160, 108, 104], [80, 52, 82], [22, 30, 58]],
  reed: [[150, 112, 104], [84, 62, 88], [30, 34, 60]],
  wTop: [[244, 176, 112], [186, 100, 112], [34, 50, 94]],
  wBot: [[78, 78, 130], [34, 38, 86], [8, 14, 38]],
  wLight: [[255, 228, 164], [250, 172, 132], [130, 158, 214]],
  cloudT: [[170, 120, 150], [100, 62, 122], [26, 36, 74]],
  cloudB: [[255, 196, 136], [240, 126, 112], [46, 64, 108]]
};
var SKYN = 'real';          /* 'real' or 'dusk' */
var SKYX = {                /* non-keyed sky colours: low sun glow, moon halo */
  real: { glow: [[250, 198, 124], [236, 164, 128]], halo: [156, 146, 128] },
  dusk: { glow: [[255, 196, 120], [244, 150, 120]], halo: [170, 190, 240] }
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
    var a = (SKYN === 'dusk' && KD[k]) || K[k];
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
  AMB = lerp(1, 0.5, ss(0.05, 0.95, D));
  TR = 1.1 - 0.3 * D; TG = 0.9 - 0.12 * D; TB = 0.8 - 0.03 * D; /* night light is neutral brown-grey, not blue */
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
  { x: 30, y: 6, rx: 34, ry: 3 }, { x: 118, y: -8, rx: 28, ry: 3 }, { x: 90, y: 40, rx: 44, ry: 4 },
  { x: 205, y: 26, rx: 36, ry: 3 }, { x: 250, y: 72, rx: 40, ry: 3 }, { x: 40, y: 82, rx: 30, ry: 2 },
  { x: 160, y: 62, rx: 22, ry: 2 }, { x: 310, y: 54, rx: 30, ry: 3 }
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
var HEDGE = blobs(31, 30, 5, 10, 5, 12);
/* the far shore is one flat dark band: its top edge only wanders by a pixel or two (tree texture) */
var SHTEX = [];
for (var ti = 0; ti < 360; ti++) SHTEX.push(Math.floor(h2(ti >> 2, 7) * 2) + (h2(ti, 8) > 0.86 ? 1 : 0));
var SHORELIGHTS = [];
for (var li = 0; li < 44; li++) SHORELIGHTS.push({ x: Math.floor(li * 8.2 + h2(li, 11) * 5), up: h2(li, 12) > 0.7 ? 1 : 0, warm: h2(li, 13) > 0.35, p: h2(li, 14) * 6.28, big: h2(li, 15) > 0.8 });
var BIRDS = [];
for (var bi = 0; bi < 18; bi++) BIRDS.push({ x: h2(bi, 201) * 360, y: HZ + 14 + Math.floor(h2(bi, 202) * 64), v: (h2(bi, 203) - 0.5) * 1.4, p: h2(bi, 204) * 6.28 });
var SPECK = [];
for (var si = 0; si < 150; si++) SPECK.push({ x: Math.floor(h2(si, 501) * 720), y: 259 + Math.floor(h2(si, 502) * 59), d: h2(si, 503) > 0.5 });

/* ---------- the real lake: how far the water runs straight across from the dam, in metres, by distance
   walked (notes/LAKE_REFERENCE.md section 4: 0.6 km at the Boat Club, 0.8 to 0.9 km through the middle,
   0.4 km at the Regulator End). A nearer far shore stands taller and sits a little lower. ---------- */
var WTAB = [[0, 560], [124, 591], [624, 862], [1248, 823], [1872, 809], [2371, 413], [2497, 390]];
function lakeWidth(s) {
  var q = clamp(s / WD.L, 0, 1) * 2497;
  for (var i = 1; i < WTAB.length; i++) if (q <= WTAB[i][0]) return lerp(WTAB[i - 1][1], WTAB[i][1], (q - WTAB[i - 1][0]) / (WTAB[i][0] - WTAB[i - 1][0]));
  return 390;
}
/* per frame: NB is the compass bearing she faces when she looks straight out over the water (the dam
   curves, so it swings from about 77 degrees at the Boat Club to about -34 at the Regulator End) */
var NB = 40, shoreH = 12, shoreDip = 0, PXD = 3;
function viewVars() {
  NB = mod(WD.heading(ST.s) - 90 + 180, 360) - 180;
  var n = clamp((lakeWidth(ST.s) - 400) / 460, 0, 1);
  shoreH = Math.round(lerp(18, 12, n)); shoreDip = Math.round(lerp(3, 0, n));
}

/* ---------- the Shivaliks: low (about a tenth of the frame), three layers, broad flat-topped summits with
   shallow saddles, running the whole width. They lie to the north and north-east, so they are placed by
   compass bearing: u is bearing times PXD. No sun is ever drawn: it sets behind her, WSW. ---------- */
function plat(v) { return clamp(v * 1.5, -1, 1); }
function hillEnv(u) { var b = u / PXD; return 0.62 + 0.38 * ss(-70, -10, b) * (1 - ss(85, 140, b)); }
function ridgeFar(u) { return HZ - hillEnv(u) * (37 + 7 * plat(1.4 * Math.sin(u / 22 + 1.0)) + 2 * Math.sin(u / 8 + 2.0)); }
function ridgeMain(u) { return HZ - hillEnv(u) * (26 + 5 * plat(1.4 * Math.sin(u / 16 + 4.0)) + 1.5 * Math.sin(u / 6 + 1.0)); }
function ridgeFoot(u) { return HZ - hillEnv(u) * (17 + 3 * plat(Math.sin(u / 9 + 2.0)) + 1.5 * Math.sin(u / 3.5)) - (h2(Math.floor(u), 5) > 0.6 ? 1 : 0); }

/* ---------- cached sky, water, walkway and ground (rebuilt when dusk or season moves) ---------- */
function skyColor(v) { return v < 0.6 ? mixc(P.skyTop, P.skyMid, v / 0.6) : mixc(P.skyMid, P.skyHor, (v - 0.6) / 0.4); }
function buildBg() {
  var Ls = 10, skyc = [], wcol = [], i, x, by, y, c;
  for (i = 0; i <= Ls; i++) skyc.push(skyColor(i / Ls));
  for (i = 0; i <= 8; i++) wcol.push(mixc(P.wTop, P.wBot, i / 8));
  var skyRows = HZ + OY;
  var ag = (1 - ss(0, 0.8, D)) * (1 - SEA.haze * 0.3);
  var ms = ss(0.35, 0.8, D) * (1 - 0.55 * SEA.cloud);
  moonY = lerp(HZ + 14, Math.max(HZ - 110, -OY + 30), ss(0.3, 0.95, D));
  var gx0 = W * 0.5, gxr = Math.max(90, W * 0.78);
  var grad = SKYX[SKYN].glow;
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
        if (ag > 0.01 && y > HZ - 62) {
          var gdx = (x - gx0) / gxr, gdy = (y - (HZ - 3)) / 54, gd = Math.sqrt(gdx * gdx + gdy * gdy);
          if (gd < 1) {
            var gf = Math.pow(1 - gd, 1.6) * 0.9 * ag, gq = Math.floor(gf * 5 + B(x, by)) / 5;
            if (gq > 0) c = mixc(c, y > HZ - 20 ? grad[0] : grad[1], gq * 0.6);
          }
        }
        if (ms > 0.01) {
          var mdx = x - MOONX, mdy = y - moonY;
          if (mdx > -27 && mdx < 27 && mdy > -27 && mdy < 27) {
            var md = Math.sqrt(mdx * mdx + mdy * mdy);
            if (md < 26) { /* a hazy city-glow halo, not a clear-sky one */
              var mf = Math.pow(1 - md / 26, 2) * 0.8 * ms, mq = Math.floor(mf * 4 + B(x, by)) / 4;
              if (mq > 0) c = mixc(c, SKYX[SKYN].halo, mq * 0.5);
            }
            if (md < 5.2) {
              var mc = [230, 220, 194];
              if ((Math.abs(mdx + 1) < 1.2 && Math.abs(mdy + 1) < 1.2) || (Math.abs(mdx - 2) < 1.1 && Math.abs(mdy - 2) < 1.1)) mc = [204, 194, 168];
              if (md > 4.2) mc = [212, 202, 178];
              c = mixc(c, mc, ms);
            }
          }
        }
      } else if (y < 252) {
        var wt = (y - HZ) / (252 - HZ);
        c = wcol[clamp(Math.floor(Math.pow(wt, 0.9) * 8 + B(x, by)), 0, 8)];
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
var COOL = [224, 232, 226], COOLG = [150, 160, 156]; /* the dam lamps are cool white (the one night photo from the dam) */
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
    if (dd < 34) { var k = 1 - dd / 34; k = k * k * lamps[i].on * 0.9; r += 54 * k; g += 60 * k; b += 58 * k; }
  }
  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
}

/* ---------- sky layers (real sky: no stars, a dull brown-grey city glow; dusk sky: the old starry night) ---------- */
function drawStars() {
  if (SKYN !== 'dusk') return;
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
    var cx = mod(c.x - camX * 0.02 + tm * 0.5 + 60, 360) - 60;
    if (cx < -rx - 4 || cx > W + rx + 4) continue;
    for (var y = Math.floor(c.y - ry - 1); y <= c.y + ry + 1; y++) for (var x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      var dx = (x - cx) / rx, dy = (y - c.y) / ry, d = dx * dx + dy * dy;
      d += (h2(x + 5000, y) - 0.5) * 0.45;
      if (d > 1 || x < 0 || x >= W) continue;
      var t3 = (y - (c.y - ry)) / (2 * ry + 1);
      var lv = Math.floor(t3 * 3 + (B(x, y & 255) - 0.5) * 0.9);
      var cc = lv <= 0 ? P.cloudT : lv === 1 ? mixc(P.cloudT, P.cloudB, 0.5) : P.cloudB;
      px(x, y, cc, Math.min(1, 0.7 * vis));
    }
  }
}
function drawRidge(fn, pal, f, rim, hz) {
  var off = -W / 2 + NB * PXD * f;
  for (var x = 0; x < W; x++) {
    var y = Math.round(fn(x + off));
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
  var rimA = lerp(0.5, 0.15, D) * (1 - SEA.haze * 0.5);
  drawRidge(ridgeFar, R1, 1, mixc(P.ridge1, rim, rimA * 0.5), 0.9);
  drawRidge(ridgeMain, R2, 1.06, mixc(P.ridge2, rim, rimA * 0.4), 0.7);
  drawRidge(ridgeFoot, R3, 1.14, mixc(P.ridge3, rim, rimA * 0.2), 0.35);
  /* wooded slopes on the foothills */
  var dk = mixc(P.ridge3, [0, 0, 0], 0.3), off = -W / 2 + NB * PXD * 1.14;
  for (var x = 0; x < W; x++) {
    var u = Math.floor(x + off), yy = Math.round(ridgeFoot(u)) + 2 + Math.floor(h2(u, 40) * 6);
    if (yy < HZ - 1 && h2(u, 70) > 0.5) px(x, yy, dk);
  }
  for (var y = HZ - 5; y < HZ; y++) for (x = 0; x < W; x++) {
    var m = (y - (HZ - 5)) / 5;
    var q = Math.floor(m * 3 * 0.55 + B(x, y & 255)) / 3;
    if (q > 0) px(x, y, P.haze, q * 0.4);
  }
}
/* the red and white lattice mast in front of the hills: a landmark at a fixed compass bearing, so it
   stands left of centre from the Boat Club and drifts right as the dam turns */
function drawMast() {
  var x = Math.round(W / 2 + (50 - NB) * PXD);
  if (x < -3 || x > W + 3) return;
  var top = HZ - 33, fade = 0.2 + 0.5 * D;
  var red = mixc([216, 64, 54], P.ridge2, fade), wh = mixc([244, 240, 232], P.ridge2, fade);
  px(x, top - 2, red); px(x, top - 1, red);
  for (var y = top; y < HZ - 4; y++) {
    var c = Math.floor((y - top) / 4) % 2 ? wh : red, r = y - top;
    px(x, y, c);
    if (r > 9) { px(x - 1, y, c, (r + 1) % 2 ? 1 : 0.5); px(x + 1, y, c, r % 2 ? 1 : 0.5); }
    if (r > 21 && r % 2) { px(x - 2, y, c, 0.7); px(x + 2, y, c, 0.7); }
  }
  var lw = ss(0.4, 0.75, D);
  if (lw > 0.02) px(x, top - 2, [255, 70, 60], lw * (0.55 + 0.45 * Math.sin(tm * 2.4)));
}
/* ---------- far shore: one continuous low dark line under the hills, a tan reed strip at the water ---------- */
function drawShore() {
  var lw = ss(0.35, 0.75, D), base = HZ + shoreDip, x, wx, top, j;
  for (x = 0; x < W; x++) {
    wx = mod(Math.floor(x + camX * 0.3), 360); top = base - shoreH - SHTEX[wx];
    rect(x, top + 1, 1, base - top, P.shore); px(x, top, P.shoreTop);
    px(x, base + 1, h2(wx, 3) < 0.72 ? P.reed : P.shore);
  }
  var rh = 5 + Math.round(shoreH / 3);
  for (j = 0; j < rh; j++) for (x = 0; x < W; x++) {
    if (((x + j * 3 + Math.floor(tm * 1.3)) & 7) === 0) continue;
    px(x + Math.round(Math.sin(tm * 1.4 + j * 1.1 + x * 0.05)), base + 2 + j, P.shore, 0.42 * (1 - j / rh));
  }
  /* at night: a long dotted string of lights along the far side, each with a short reflection */
  if (lw < 0.05) return;
  for (var i = 0; i < SHORELIGHTS.length; i++) {
    var l = SHORELIGHTS[i], lx = Math.round(mod(l.x - camX * 0.3 + 60, 360) - 60);
    if (lx < 0 || lx >= W) continue;
    var on = lw * (0.8 + 0.2 * Math.sin(tm * 2.1 + l.p));
    var c2 = l.warm ? [255, 214, 150] : [226, 234, 240], ly = base - 1 - l.up;
    px(lx, ly, c2, on);
    if (l.big) { px(lx - 1, ly, c2, on * 0.3); px(lx + 1, ly, c2, on * 0.3); px(lx, ly - 1, c2, on * 0.3); }
    for (var r = 0; r < (l.big ? 7 : 4); r++) {
      var sh = Math.round(Math.sin(tm * 1.6 + r * 1.3 + l.p) * (0.5 + r * 0.2));
      if ((r + Math.floor(tm * 1.5 + l.p)) % 3 !== 2) px(lx + sh, base + 2 + r, c2, on * (0.5 - r * 0.07));
    }
  }
}
/* the near peninsula by the Boat Club: round trees, a low white pavilion with a sloped roof, the white
   three-blade wind turbine and the jet fountain. Seen only from the first stretch of the walk. */
function drawPeninsula() {
  var tip = Math.round(SX(45, 0.4));
  if (tip < -16) return;
  var base = HZ + 17, c = mixc(P.shore, P.hedge, 0.55), ct = mixc(P.shoreTop, P.hedgeTop, 0.55), x, k;
  for (x = Math.max(0, tip - 260); x < Math.min(W, tip); x++) {
    var d = tip - x, h = Math.min(4, Math.round(Math.sqrt(d) * 0.8));
    if (d > 16) h += Math.max(0, Math.round(4 + 3.5 * Math.sin(d / 5.5) + 2 * Math.sin(d / 2.3 + 1)));
    rect(x, base - h, 1, h + 1, c); px(x, base - h, ct); px(x, base + 1, P.reed);
    px(x, base + 2 + ((x + Math.floor(tm * 1.2)) & 1), c, 0.35);
  }
  var pv = tip - 12;
  if (pv > -16 && pv < W + 4) {
    rect(pv, base - 4, 11, 4, lit(P.bldg, pv)); rect(pv - 1, base - 6, 13, 2, lit(mixc(P.bldg, [120, 70, 60], 0.6), pv)); rect(pv + 1, base - 7, 9, 1, lit(mixc(P.bldg, [120, 70, 60], 0.6), pv));
    rect(pv + 2, base - 3, 2, 3, mixc(mixc(P.bldg, [0, 0, 0], 0.5), [255, 214, 130], ss(0.3, 0.7, D)));
    for (k = 0; k < 3; k++) rect(pv - 9 + k * 4, base + 1, 3, 1, lit(BOATC[k + 1], pv));
  }
  var tx = tip - 40;
  if (tx > -8 && tx < W + 8) { /* wind turbine */
    var wc = mixc([244, 244, 240], P.ridge2, 0.15 + 0.5 * D);
    rect(tx, base - 24, 1, 16, wc);
    for (k = 0; k < 3; k++) { var a = tm * 0.9 + k * 2.094; for (var q = 1; q <= 5; q++) px(tx + Math.round(Math.cos(a) * q), base - 24 + Math.round(Math.sin(a) * q), wc, q > 4 ? 0.6 : 1); }
  }
  var fx = tip + 12;
  if (fx > -4 && fx < W + 4) { /* jet fountain */
    var fc = mixc([250, 250, 250], P.wTop, 0.25 + 0.4 * D);
    for (k = 0; k < 6; k++) px(fx, base + 3 - k, fc, 0.8 - k * 0.06);
    for (k = 0; k < 8; k++) { var ph = (tm * 0.9 + k * 0.125) % 1; px(fx + Math.round((k % 2 ? 1 : -1) * (0.6 + ph * 3)), base - 3 + Math.round(ph * ph * 7), fc, 0.75 * (1 - ph)); }
    px(fx - 1, base - 3, fc, 0.6); px(fx + 1, base - 3, fc, 0.6);
    rect(fx - 2, base + 4, 5, 1, fc, 0.4);
  }
}
/* ---------- water: a wide flat mirror, fine short ripple dashes that grow toward the dam ---------- */
function drawWater() {
  var y, k, dy;
  for (y = HZ + 2; y < 246; y++) {
    dy = y - HZ;
    var n = 1 + Math.floor(dy * 0.045 + h2(y, 7) * 1.5);
    for (k = 0; k < n; k++) {
      var b = h2(y, k), sp = (0.4 + h2(k, y) * 1.4) * (0.3 + dy / 90) * (h2(y, 99) > 0.5 ? 1 : -1);
      var x = mod(Math.floor(b * W + tm * sp * 3 - camX * (0.1 + dy / 240)), W + 8) - 4;
      var w = 2 + Math.floor(dy / 22) + Math.floor(h2(y, k + 9) * 3);
      var tw = (Math.floor(tm * 2 + h2(k, y) * 5) & 1);
      rect(x, y, w, 1, P.wLight, tw ? 0.34 : 0.15);
    }
  }
  /* the faint moon path, straight down from the moon */
  var mp = ss(0.4, 0.8, D) * clamp((HZ - 10 - moonY) / 60, 0, 1) * (1 - 0.5 * SEA.cloud) * 0.42;
  if (mp > 0.02) {
    for (y = HZ + 2; y < 246; y += 1) {
      dy = y - HZ;
      for (k = 0; k < 4; k++) {
        var xx = MOONX + (h2(y, k + 150) - 0.5) * (5 + dy * 0.3) + Math.sin(tm * 1.1 + y * 0.8 + k) * 1.4;
        var ww = 1 + Math.floor(h2(y, k + 160) * (2 + dy / 30));
        if (h2(y + Math.floor(tm * 2.2), k + 3) > 0.5) rect(xx, y, ww, 1, [226, 218, 196], mp * (1 - dy / 150));
      }
    }
  }
}
/* ducks and coots: winter migrants on the water */
function drawBirds() {
  if (!SEA.migrants) return;
  var dark = mixc([46, 46, 58], [0, 0, 0], 1 - AMB), wh = mixc([236, 236, 240], [90, 96, 110], 1 - AMB);
  for (var i = 0; i < BIRDS.length; i++) {
    var b = BIRDS[i], bx = Math.round(mod(b.x - camX * 0.5 + tm * b.v * 2 + 60, 360) - 60);
    if (bx < -6 || bx > W + 2) continue;
    var by = b.y + Math.round(Math.sin(tm * 1.2 + b.p) * 0.6), sz = 2 + Math.floor((b.y - HZ) / 26);
    var dir = b.v >= 0 ? 1 : -1;
    rect(bx, by, sz, 2, dark); px(bx + (dir > 0 ? sz : -1), by - 1, dark); px(bx + (dir > 0 ? sz + 1 : -2), by - 1, wh, 0.9);
    px(bx + 1, by, wh, 0.6);
    rect(bx - 1, by + 2, sz + 2, 1, dark, 0.3);
    rect(bx - 2 * dir, by + 1, 1, 1, P.wLight, 0.4);
  }
}
/* the far dam across the bend: a string of its low lamps, only seen where the lake bends */
function drawFarLights() {
  var lw = ss(0.2, 0.55, D);
  var c0 = SX(1260, 0.35), fade = 1 - clamp(Math.abs(ST.s - 1260) / 380, 0, 1);
  if (fade <= 0.02) return;
  for (var i = 0; i < 11; i++) {
    var x = Math.round(c0 - 50 + i * 9), t2 = i / 10, y = Math.round(lerp(HZ + 36, HZ + 7, Math.pow(t2, 1.2)));
    if (x < -8 || x > W + 8) continue;
    rect(x - 4, y, 10, 2, P.shore, fade); px(x - 4, y, mixc(P.shore, P.shoreTop, 0.6), fade);
    px(x, y - 1, mixc(P.shore, COOL, lw), fade);
    glow(x, y - 1, 5, COOLG, 0.7 * lw * fade, 4);
    for (var r = 0; r < 6; r++) {
      var sh = Math.round(Math.sin(tm * 1.7 + r * 1.2 + i) * (0.5 + r * 0.2));
      if (r % 2 === 0 || h2(i, r + Math.floor(tm * 2)) > 0.5) px(x + sh, y + 3 + r, COOL, lw * (0.5 - r * 0.07) * fade);
    }
  }
}
/* ---------- boats: swan pedal boats and plain boxy ones, moored at the floating jetty, others out on the
   water coming home as dusk grows ---------- */
var JF = 0.7;
var BOATC = [[244, 244, 240], [240, 130, 170], [90, 170, 226], [250, 206, 70], [110, 200, 130], [236, 84, 72]];
var PONT = [[66, 124, 198], [156, 162, 170], [236, 138, 58]];
function pedalBoat(x, y, col, i, wob) {
  var by = y + Math.round(Math.sin(tm * 1.3 + i * 1.7) * wob), k;
  var hull = lit(col, x), dk = lit(mixc(col, [0, 0, 0], 0.45), x), hi = lit(mixc(col, [255, 255, 255], 0.45), x);
  if (i % 2 === 0) { /* a swan: round body, raised tail, tall curled neck and head at the bow */
    rect(x + 1, by - 3, 11, 3, hull); rect(x + 2, by - 4, 9, 1, hull); rect(x + 2, by - 3, 9, 1, hi); rect(x + 1, by, 11, 1, dk);
    px(x, by - 4, hull); px(x, by - 5, hull); px(x + 1, by - 4, hull);
    rect(x + 11, by - 10, 1, 7, hi); px(x + 12, by - 11, hi); px(x + 13, by - 11, hi); px(x + 14, by - 10, hi); px(x + 13, by - 10, hull);
    px(x + 15, by - 10, lit([244, 150, 50], x)); px(x + 12, by - 4, hull); px(x + 10, by - 5, hull);
    px(x + 4, by - 5, dk); px(x + 5, by - 5, dk); px(x + 8, by - 5, dk);
  } else { /* a plain boxy two-seater, some with a green and white striped canopy */
    rect(x, by - 3, 13, 3, hull); rect(x + 1, by - 3, 11, 1, hi); rect(x, by, 13, 1, dk); px(x + 13, by - 3, hull);
    rect(x + 3, by - 5, 2, 2, dk); rect(x + 8, by - 5, 2, 2, dk);
    if (i % 4 === 1) {
      for (k = 0; k < 6; k++) rect(x + 1 + k * 2, by - 10, 2, 2, lit(k % 2 ? [244, 244, 236] : [70, 160, 96], x));
      rect(x + 1, by - 8, 1, 5, dk); rect(x + 12, by - 8, 1, 5, dk);
    }
  }
  for (k = 0; k < 4; k++) px(x - 1 + k * 5 + Math.round(Math.sin(tm * 2 + k + i)), by + 1, P.wLight, 0.4);
}
function drawFarBoats() {
  var home = ss(0.2, 0.55, D);
  var pier = WD.pierS;
  for (var i = 0; i < 6; i++) {
    var h0 = pier - 160 + i * 70 + h2(i, 311) * 40, dock = pier + 44 + i * 5;
    var bs = lerp(h0 + Math.sin(tm * 0.15 + i) * 6, dock, home);
    var x = Math.round(SX(bs, 0.55)), y = HZ + 30 + (i % 3) * 9 + Math.round(home * 22);
    if (x < -10 || x > W + 4) continue;
    var c = lit(BOATC[i % 6], x);
    rect(x, y, 7, 2, c); px(x + 1, y + 2, P.wLight, 0.35); px(x + 4, y + 2, P.wLight, 0.25);
    if (i % 2 === 0) { px(x + 6, y - 1, c); px(x + 6, y - 2, c); px(x + 7, y - 2, c); px(x, y - 1, c); }
    else rect(x + 2, y - 1, 3, 1, lit([60, 54, 66], x));
  }
}
/* the Boat Club jetty: a floating pontoon of plastic cubes (blue, grey and orange in a checkerboard) with
   a pale blue ramp from the bank, a black and white pipe rail, small black lamp poles, a white board */
function drawJetty() {
  var jx = Math.round(SX(WD.pierS - 6, JF));
  if (jx > W + 4 || jx < -190) return;
  var lw = ss(0.25, 0.65, D), i, k, mid = jx + 75;
  var pc = [lit(PONT[0], mid), lit(PONT[1], mid), lit(PONT[2], mid)], blk = lit([30, 30, 36], mid), wht = lit([238, 238, 232], mid);
  for (k = 0; k < 18; k++) {
    var ry = 220 + k, rx = jx + 7 - Math.round(k * 0.5);
    rect(rx, ry, 7, 1, lit([172, 208, 230], rx)); px(rx - 1, ry, k % 2 ? wht : blk); px(rx + 7, ry, k % 2 ? blk : wht);
  }
  for (i = 0; i < 75; i++) for (k = 0; k < 2; k++) rect(jx + i * 2, 216 + k * 2, 2, 2, pc[((i + k) & 1) ? 0 : (h2(i >> 1, 61 + k) < 0.4 ? 2 : 1)]);
  rect(jx, 220, 150, 1, lit([36, 48, 76], mid), 0.8);
  for (k = 0; k < 30; k++) px(jx + 2 + k * 5 + Math.round(Math.sin(tm * 2 + k)), 221, P.wLight, 0.3);
  /* the board on its pipe legs */
  rect(jx + 25, 210, 1, 6, wht); rect(jx + 57, 210, 1, 6, wht);
  rect(jx + 22, 199, 39, 11, lit([246, 244, 236], jx + 30)); rect(jx + 22, 199, 39, 2, lit([206, 60, 52], jx + 30));
  text3('BOAT CLUB', jx + 26, 203, lit([40, 36, 56], jx));
  /* a flower-shaped yellow umbrella on the deck */
  var uc = lit([250, 208, 60], jx + 84);
  rect(jx + 84, 210, 1, 6, blk); rect(jx + 80, 208, 9, 2, uc); rect(jx + 82, 207, 5, 1, uc);
  for (k = 0; k < 5; k++) px(jx + 80 + k * 2, 210, uc);
  /* black poles with small round lamps */
  for (i = 0; i < 3; i++) {
    var lx = jx + 68 + i * 39;
    rect(lx, 206, 1, 10, blk); px(lx, 205, mixc(lit([150, 150, 150], lx), [255, 240, 204], lw));
    glow(lx, 205, 7, WARM, 0.45 * lw, 6);
  }
  var dockN = ss(0.2, 0.55, D);
  for (i = 0; i < 5; i++) pedalBoat(jx + 34 + i * 22 + (i % 2), 232 + (i % 2), BOATC[i], i, 1);
  /* a sixth boat comes in to the end of the jetty as the light goes */
  if (dockN > 0.6) pedalBoat(jx + 150, 233, BOATC[5], 5, 1);
}
/* ---------- the Regulator End: a concrete deck with a square-post balustrade, black drum gates with blue
   winch frames below, a light blue pipe rail on the gate walkway, tall cantilever lamps ---------- */
function drawRegulator() {
  var gx = Math.round(SX(WD.L - 14, 0.95));
  if (gx > W + 10 || gx < -110) return;
  var lw = ss(0.3, 0.7, D), i, y, f;
  var conc = P.conc, concD = mixc(conc, [0, 0, 0], 0.3), concL = mixc(conc, [255, 236, 200], 0.25 * (1 - D));
  var drum = P.steel, drumL = mixc(P.steel, P.conc, 0.35), blue = mixc(P.railB, [30, 80, 170], 0.45);
  rect(gx - 4, 232, 100, 10, concD);
  for (i = 0; i < 4; i++) {
    var px0 = gx + i * 25;
    rect(px0, 206, 6, 28, conc); rect(px0, 206, 1, 28, concL); rect(px0 + 5, 206, 1, 28, concD);
    for (y = 210; y < 234; y += 4) rect(px0 + 1, y, 4, 1, concD, 0.5); /* ashlar courses */
    if (i < 3) {
      rect(px0 + 6, 228, 19, 6, mixc(P.wBot, [0, 0, 0], 0.4));
      rect(px0 + 6, 214, 19, 13, drum); rect(px0 + 7, 213, 17, 1, drum); rect(px0 + 7, 227, 17, 1, drum);
      rect(px0 + 7, 216, 17, 1, drumL); rect(px0 + 6, 223, 19, 2, mixc(drum, [0, 0, 0], 0.4));
      for (f = 0; f < 6; f++) { var fx = px0 + 7 + f * 3 + Math.round(Math.sin(tm * 3 + f + i)); px(fx, 232, [236, 240, 240], 0.5); px(fx + 1, 231, [236, 240, 240], 0.3); }
      /* winch frame */
      rect(px0 + 11, 188, 1, 8, blue); rect(px0 + 19, 188, 1, 8, blue); rect(px0 + 11, 188, 9, 1, blue); rect(px0 + 14, 189, 3, 2, blue);
      rect(px0 + 15, 191, 1, 22, mixc(drum, P.conc, 0.2), 0.8);
    }
  }
  /* the gate walkway and its light blue pipe rail */
  rect(gx - 2, 210, 82, 1, concD);
  rect(gx - 2, 207, 82, 1, P.railB); for (i = 0; i < 14; i++) rect(gx - 2 + i * 6, 208, 1, 2, P.railB);
  /* the deck and the balustrade: square posts and a flat top rail */
  rect(gx - 4, 202, 86, 3, conc); rect(gx - 4, 202, 86, 1, concL); rect(gx - 4, 205, 86, 1, concD);
  rect(gx - 4, 196, 86, 1, concL);
  for (i = 0; i < 15; i++) rect(gx - 4 + i * 6, 197, 2, 5, conc);
  /* tall poles with a curved arm */
  for (i = 0; i < 2; i++) {
    var lx = gx - 7 + i * 92, dir = i ? -1 : 1, pc = mixc(P.steel, P.conc, 0.35);
    rect(lx, 172, 1, 34, pc); px(lx + dir, 171, pc); px(lx + dir * 2, 170, pc); px(lx + dir * 3, 170, pc);
    rect(lx + dir * 4 - (dir < 0 ? 1 : 0), 170, 2, 1, mixc(pc, COOL, lw));
    glow(lx + dir * 4, 171, 12, COOLG, 0.6 * lw, 9);
    glow(lx + dir * 4, 200, 16, COOLG, 0.22 * lw, 12);
  }
}
/* ---------- the dam edge: a low kerb of rounded boulders set in mortar, and below it a riprap slope of
   grey-brown stones down to the water. No wall stands in the water and there is no parapet, except at the
   Regulator End, where the edge is a concrete balustrade with light blue pipe rails. ---------- */
/* one rounded stone in a course of uneven stones: sets SKX (column inside the stone), SWD (its width)
   and SID (a 0..1 tone for that stone) for world column wx */
var SKX = 0, SWD = 6, SID = 0;
function stoneAt(wx, cw, seed) {
  var c = Math.floor(wx / cw), e = c * cw + Math.floor(h2(c, seed) * 3), e2;
  if (wx < e) { e2 = e; c--; e = c * cw + Math.floor(h2(c, seed) * 3); }
  else e2 = (c + 1) * cw + Math.floor(h2(c + 1, seed) * 3);
  SKX = wx - e; SWD = e2 - e; SID = h2(c, seed + 1);
}
var RIP = [[236, 3, 6, 71], [239, 4, 8, 73], [243, 4, 7, 75]]; /* riprap courses: top row, rows, stone width, seed */
function drawKerb() {
  var x, y, wx, i, r, ry, t;
  var rp = [], kb = [];
  for (i = 0; i < 6; i++) { rp.push(mixc(mixc(P.wallc, [0, 0, 0], 0.22), mixc(P.wallc, P.capc, 0.7), i / 5)); kb.push(mixc(mixc(P.capc, P.wallc, 0.45), mixc(P.capc, [255, 244, 220], 0.3 * (1 - D)), i / 5)); }
  var mortar = mixc(P.capc, P.wallc, 0.6);
  var grass = SEA.kind === 'monsoon' ? mixc(P.hedge, P.hedgeTop, 0.45) : null;
  var b0 = SX(WD.L - 64), b1 = SX(WD.L + 2);
  for (x = 0; x < W; x++) {
    wx = Math.floor(x + camX);
    if (x >= b0 && x < b1) continue;
    for (r = 0; r < 3; r++) {
      var c = RIP[r];
      stoneAt(wx + r * 3, c[2], c[3]);
      var edge = SKX === 0 || SKX === SWD - 1;
      for (ry = 0; ry < c[1]; ry++) {
        y = c[0] + ry;
        if (r === 0 && (SID < 0.3 || (ry === 0 && (edge || SID < 0.6)))) continue;  /* a ragged water line */
        if (ry === 0 && edge) t = 0;                 /* rounded shoulders: the gap between two stones */
        else if (ry === c[1] - 1) t = SKX === 0 ? 0 : 1;
        else if (SKX === 0) t = 1;
        else t = Math.min(5, 2 + Math.floor(SID * 2.4) + (ry === 0 ? 1 : 0));
        if (r === 0) t = Math.max(0, t - 1);          /* wet stones at the water */
        px(x, y, grass && r > 0 && ry === 0 && SID > 0.45 ? grass : rp[t]);
      }
    }
    /* the kerb: a single row of pale rounded boulders in mortar, about knee high */
    stoneAt(wx, 7, 55);
    if (SID > 0.55 && SKX >= 2 && SKX <= SWD - 3) px(x, 246, kb[5]);
    for (y = 247; y < 252; y++) {
      if (SKX === 0 || (y === 247 && SKX === SWD - 1)) { px(x, y, mortar); continue; }
      t = 1 + Math.floor(SID * 2.2) + (y === 247 ? 2 : y === 248 ? 1 : y === 251 ? -1 : 0);
      px(x, y, kb[clamp(t, 0, 5)]);
    }
  }
  /* water lapping on the stones */
  for (x = 0; x < 14; x++) {
    var lx = mod(Math.floor(h2(x, 88) * (W + 20) + Math.sin(tm * 0.9 + x) * 3 - camX), W + 20) - 10;
    rect(lx, 236 + (x & 1), 2 + (x % 3), 1, P.wLight, 0.3 + 0.2 * Math.sin(tm * 2 + x));
  }
  /* the Regulator End balustrade */
  var x0 = Math.max(0, Math.round(b0)), x1 = Math.min(W, Math.round(b1));
  if (x1 > x0) {
    var conc = P.conc, concD = mixc(P.conc, [0, 0, 0], 0.3), concL = mixc(P.conc, [255, 236, 200], 0.25 * (1 - D));
    rect(x0, 245, x1 - x0, 7, conc); rect(x0, 251, x1 - x0, 1, concD);
    rect(x0, 239, x1 - x0, 1, P.railB); rect(x0, 242, x1 - x0, 1, P.railB);
    rect(x0, 236, x1 - x0, 2, concL); rect(x0, 238, x1 - x0, 1, concD);
    for (x = x0; x < x1; x++) { wx = Math.floor(x + camX); if (mod(wx, 14) < 3) { rect(x, 238, 1, 7, mod(wx, 14) === 2 ? concD : conc); } }
  }
  rect(0, 252, W, 1, mixc(P.walk, [0, 0, 0], 0.3));
}
/* the walking surface: plain pale asphalt and concrete, a band of small cobbles along the lake edge and
   grey kerb pavers on the city side. No tile grid and no brick. */
function drawWalk() {
  var x, wx, r, o, i;
  var cob = mixc(P.walk, P.capc, 0.55), cobM = mixc(P.walk, P.capc, 0.2), cobD = mixc(P.walkJ, P.walk, 0.3), pav = mixc(P.walkJ, P.capc, 0.3);
  for (x = 0; x < W; x++) {
    wx = Math.floor(x + camX);
    for (r = 0; r < 4; r++) { o = wx + (r >> 1) * 2; px(x, 253 + r, mod(o, 4) === 0 ? cobD : (r & 1) ? cobM : cob); }
    px(x, 320, mod(wx, 7) === 0 ? cobD : pav);
  }
  rect(0, 257, W, 1, P.walkJ, 0.7);
  for (i = 0; i < SPECK.length; i++) {
    var s = SPECK[i], sx = mod(s.x - Math.floor(camX) + 20, 720) - 20;
    if (sx < 0 || sx >= W) continue;
    rect(sx, s.y, s.d ? 2 : 1, 1, s.d ? P.walkJ : cob, 0.5);
  }
  rect(0, 319, W, 1, P.walkJ, 0.6);
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
/* the dam lamps: low hook-shaped fittings about waist height, cool white, each with a pool on the path */
function drawLampPools() {
  for (var i = 0; i < lamps.length; i++) {
    var l = lamps[i]; if (l.on <= 0.02) continue;
    glow(l.x + 3, 268, 36, COOLG, 0.36 * l.on, 12, 8);
  }
}
function drawLampPost(l) {
  var x = l.x, dark = lit([58, 56, 64], x);
  rect(x, 249, 1, 10, dark); px(x - 1, 258, dark); px(x + 1, 258, dark);
  px(x, 248, dark); px(x + 1, 247, dark); px(x + 2, 247, dark); px(x + 3, 247, dark); px(x + 4, 248, dark);
  var gc = mixc(lit([124, 122, 128], x), [240, 246, 242], l.on);
  px(x + 2, 248, gc); px(x + 3, 248, gc); px(x + 3, 249, gc);
}
function drawLampGlowAndReflect(l) {
  if (l.on > 0.02) {
    glow(l.x + 3, 250, 8, COOLG, 0.4 * l.on, 7);
    glow(l.x + 3, 249, 3, [236, 242, 238], 0.6 * l.on, 3);
    if (WD.lamps[l.i] > WD.L - 70) return; /* behind the Regulator End balustrade: no streak across the gates */
    for (var r = 0; r < 16; r++) {
      var y = 235 - r;
      var sh = Math.round(Math.sin(tm * 2.2 + r * 0.9 + l.i) * (1 + r * 0.12));
      if (h2(r + l.i * 7, Math.floor(tm * 2.5 + r)) > 0.33) {
        var w = r < 3 ? 3 : (r > 9 ? 1 : 2) + (h2(r, 3) > 0.6 ? 1 : 0);
        rect(l.x + 3 + sh - Math.floor(w / 2), y, w, 1, COOL, l.on * (0.6 - r / 30));
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
      /* pushed back: the hairline sits one row higher at the front, the bulk is up and behind */
      if (o.swept && yy === Math.ceil(head * 0.42) - 1 && xx * s >= 1) isHair = false;
      px(pxx, topY + yy, isHair ? hair : skin);
    }
  }
  px(Math.round(hcx + s * Math.ceil(hr)), topY + Math.floor(head / 2), mixc(skin, rim, rimA * 0.6));
  if (o.pony) { for (var p = 0; p < 4; p++) px(x - s * (Math.ceil(hr) + 1 + (p > 1 ? 1 : 0)), topY + 2 + p + Math.round(Math.sin(tm * 3 + p) * (p > 2 ? 1 : 0)), hair); }
  var hx0 = Math.round(hcx);
  if (o.bob) { /* a short bob: hair round the back of the head down to the jaw, clear of the shoulders */
    for (p = 1; p < head; p++) px(hx0 - s * Math.ceil(hr), topY + p, hair);
    px(hx0 - s * (Math.ceil(hr) - 1), topY + head - 1, hair);
  }
  if (o.glasses) { /* one small round violet lens, seen side on */
    var gl = mixc(L(o.glasses), o.glasses, 0.55), gy = topY + Math.floor(head * 0.6), gxx = hx0 + s * Math.max(1, Math.ceil(hr) - 2);
    px(gxx, gy, gl); px(gxx - s, gy, mixc(hair, skin, 0.35));
  }
  if (o.tee) { /* the tee shows where the jacket hangs open */
    var tc = L(o.tee), tcx = s > 0 ? tx + tw - 2 : tx + 1;
    rect(tcx, topY + head, 1, Math.max(2, tor - 2), tc); px(tcx - s, topY + head, tc);
  }
  if (o.scarf) { /* wound once at the neck, a short tail flutters behind her */
    var scc = L(o.scarf);
    rect(tx, topY + head, tw, 1, scc); px(s > 0 ? tx + tw - 2 : tx + 1, topY + head + 1, scc); px(s > 0 ? tx + tw - 2 : tx + 1, topY + head + 2, mixc(scc, [0, 0, 0], 0.2));
    for (p = 0; p < 4; p++) px(x - s * (Math.floor(tw / 2) + 1 + (p > 1 ? 1 : 0)), topY + head + 1 + p + Math.round(Math.sin(tm * 2.4 + p * 0.8) * 0.8), p === 3 ? mixc(scc, [0, 0, 0], 0.2) : scc);
  }
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
  if (o.bob) { /* the bob from behind: full to the jaw, a touch wider than the head, nape covered */
    rect(x - Math.ceil(hr) + 1, topY + Math.floor(head * 0.4), Math.ceil(hr) * 2 - 1, head - Math.floor(head * 0.4), hair);
    px(x - Math.ceil(hr), topY + head - 2, hair); px(x + Math.ceil(hr), topY + head - 2, hair);
  } else { px(x, topY + head - 1, skin); px(x - 1, topY + head - 1, skin, 0.5); }
  if (o.pony) rect(x, topY + head, 1, 6, hair);
  if (o.scarf) {
    var scb = L(o.scarf);
    rect(tx, topY + head, tw, 2, scb); px(tx - 1, topY + head, scb); px(tx + tw, topY + head, scb);
    for (var q = 0; q < 5; q++) px(x + s * (Math.floor(tw / 2) - 1) + (q > 2 ? Math.round(Math.sin(tm * 2.2 + q * 0.7) * 0.7) : 0), topY + head + 2 + q, q === 4 ? mixc(scb, [0, 0, 0], 0.2) : scb);
  }
  if (o.tee) px(x, topY + head, L(o.tee));
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
/* She: a short dark bob to the jaw, a dark jacket with a coral scarf, trousers.
   Her companion: clean-shaven, small round violet-tinted glasses, thick dark hair pushed back, a brown suede
   jacket over a rust tee, dark jeans. Same sprite as everyone else; only these flags differ. */
var HER = { legs: [92, 86, 104], body: [48, 50, 74], skin: [192, 134, 100], hair: [30, 22, 28], bob: true, scarf: [242, 112, 94], jacket: true };
var HIM = { legs: [42, 48, 76], body: [148, 100, 62], tee: [190, 84, 48], skin: [176, 120, 90], hair: [26, 20, 24], swept: true, glasses: [156, 112, 238], jacket: true };
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
  /* the lean: when she has turned her gaze to the lake (gaze above one half) she faces the water at the parapet */
  var leanT = (st.gaze || 0) > 0.5 ? 1 : 0;
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
  var nl = (lean > 0.6 && !moving) ? 1 : 0;
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
  for (i = 0; i < lamps.length; i++) items.push({ y: 259, k: 0, l: lamps[i] });
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
      case 2: fence(it.x, 258, 318, 28, 38, 9, 9, [140, 184, 212], false); break;
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
  if (lean > 0.5) { o.rail = lean > 0.85; o.ph = (lean < 0.97 || ST.speed > 0.15) ? herPh : undefined; personBack(o); }
  else { o.ph = herPh; person(o); }
}
function drawHim() {
  GA = clamp(av.show, 0, 1);
  var o = Object.assign({}, HIM, { x: nv.x, y: nv.y, h: nv.h, dir: nv.dir });
  if (nv.lean > 0.5) { o.rail = nv.lean > 0.85; o.ph = nv.lean < 0.97 ? nv.ph : undefined; personBack(o); }
  else { o.ph = nv.ph; person(o); }
  GA = 1;
}
/* framing follows her gaze: the sky, hills and lake above the wall are scaled about the wall line, so the
   lake and hills take more of the screen as she turns to the water (gaze toward 1) and less as she turns
   back to the path (gaze toward -1). Row repeat only, so the pixels stay square. */
var rfTmp = null;
function reframe(g) {
  var y1 = 244 + OY, z = 1 + 0.16 * g;
  if (Math.abs(g) < 0.005 || y1 < 8 || y1 > H) return;
  var rb = W * 4;
  if (!rfTmp || rfTmp.length !== rb * y1) rfTmp = new Uint8ClampedArray(rb * y1);
  rfTmp.set(buf.subarray(0, rb * y1));
  for (var y = 0; y < y1; y++) {
    var ys = Math.round(y1 - (y1 - y) / z);
    if (ys < 0) ys = 0; else if (ys > y1 - 1) ys = y1 - 1;
    if (ys !== y) buf.set(rfTmp.subarray(ys * rb, ys * rb + rb), y * rb);
  }
}
function render() {
  buf.set(bg);
  computeLamps();
  viewVars();
  drawStars(); drawClouds(); drawHills(); drawMast(); drawShore();
  drawWater(); drawPeninsula(); drawBirds(); drawFarLights(); drawFarBoats(); drawJetty(); drawRegulator();
  reframe(ST.gaze || 0);
  drawKerb(); drawWalk();
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
  SKYN = state.sky === 'dusk' ? 'dusk' : 'real';
  var key = Math.round(state.dusk * 250) + '|' + SEA.kind + '|' + W + 'x' + H + '|' + SKYN;
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
  OYB = Math.round(extra * (extra > 0 ? 0.6 : 0.35)); /* spare rows go mostly below the hedge, not into the sky; a short screen gives up some hedge as well as sky */
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
  place: function (s, dir) { nv.s = s + dir * 4.4; nv.init = true; nv.dir = dir; nv.v = 0; },
  crowdNear: function () { return crowdHere; },
  count: function () { return CROWD.filter(function (p) { return p.on; }).length; }
};
})();
