// World model: the promenade as a smooth curve, the lake as a raster, landmarks.
// All in metres, x east, y north, origin at the boat-club end of the promenade.
(function () {
  "use strict";
  var D = SW.DATA;
  var STEP = 2; // resample spacing, metres

  // 1. Resample the OSM polyline every STEP metres.
  var raw = D.promenade;
  var cum = [0];
  for (var i = 1; i < raw.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  }
  var Lraw = cum[cum.length - 1];
  var n = Math.floor(Lraw / STEP) + 1;
  var px = new Float64Array(n), py = new Float64Array(n);
  var j = 0;
  for (var k = 0; k < n; k++) {
    var s = k * STEP;
    while (j < raw.length - 2 && cum[j + 1] < s) j++;
    var t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    t = Math.max(0, Math.min(1, t));
    px[k] = raw[j][0] + (raw[j + 1][0] - raw[j][0]) * t;
    py[k] = raw[j][1] + (raw[j + 1][1] - raw[j][1]) * t;
  }
  // 2. Smooth (moving average, 30 m window) so the walk has no kinks.
  function smooth(a, w) {
    var out = new Float64Array(a.length);
    for (var i = 0; i < a.length; i++) {
      var sum = 0, c = 0;
      for (var d = -w; d <= w; d++) {
        var q = Math.max(0, Math.min(a.length - 1, i + d));
        sum += a[q]; c++;
      }
      out[i] = sum / c;
    }
    return out;
  }
  px = smooth(px, 7); py = smooth(py, 7);
  var L = (n - 1) * STEP;

  function idx(s) {
    var f = Math.max(0, Math.min(L, s)) / STEP;
    var i0 = Math.min(n - 2, Math.floor(f));
    return [i0, f - i0];
  }
  function pos(s) {
    var r = idx(s), i0 = r[0], t = r[1];
    return [px[i0] + (px[i0 + 1] - px[i0]) * t, py[i0] + (py[i0 + 1] - py[i0]) * t];
  }
  // Heading in degrees clockwise from north, direction of increasing s.
  function heading(s) {
    var a = pos(Math.max(0, s - 6)), b = pos(Math.min(L, s + 6));
    return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360;
  }
  // Unit tangent and the unit normal pointing to the water (left of increasing s).
  function frame(s) {
    var h = heading(s) * Math.PI / 180;
    var tx = Math.sin(h), ty = Math.cos(h);
    return { tx: tx, ty: ty, nx: -ty, ny: tx };
  }
  // World point at path distance s and lateral offset o (positive toward the water).
  function at(s, o) {
    var p = pos(s), f = frame(s);
    return [p[0] + f.nx * o, p[1] + f.ny * o];
  }
  function nearestS(x, y) {
    var best = 1e18, bi = 0;
    for (var i = 0; i < n; i++) {
      var d = (px[i] - x) * (px[i] - x) + (py[i] - y) * (py[i] - y);
      if (d < best) { best = d; bi = i; }
    }
    return { s: bi * STEP, d: Math.sqrt(best) };
  }

  // 3. Rasterise the lake (outer minus inner rings) at 8 m cells.
  var CELL = 8;
  var allx = [], ally = [];
  D.lake.outer.forEach(function (r) { r.forEach(function (p) { allx.push(p[0]); ally.push(p[1]); }); });
  var minx = Math.min.apply(null, allx) - 40, maxx = Math.max.apply(null, allx) + 40;
  var miny = Math.min.apply(null, ally) - 40, maxy = Math.max.apply(null, ally) + 40;
  var gw = Math.ceil((maxx - minx) / CELL), gh = Math.ceil((maxy - miny) / CELL);
  var grid = new Uint8Array(gw * gh);
  function pip(ring, x, y) {
    var inside = false;
    for (var a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      var xa = ring[a][0], ya = ring[a][1], xb = ring[b][0], yb = ring[b][1];
      if (((ya > y) !== (yb > y)) && (x < (xb - xa) * (y - ya) / (yb - ya) + xa)) inside = !inside;
    }
    return inside;
  }
  for (var gy = 0; gy < gh; gy++) {
    for (var gx = 0; gx < gw; gx++) {
      var wx = minx + (gx + 0.5) * CELL, wy = miny + (gy + 0.5) * CELL;
      var inW = D.lake.outer.some(function (r) { return pip(r, wx, wy); }) &&
        !D.lake.inner.some(function (r) { return pip(r, wx, wy); });
      grid[gy * gw + gx] = inW ? 1 : 0;
    }
  }
  // The dam is the lake's edge. Make that exact: water from 6 m out on the water
  // side, land on the dam and behind it. (OSM's shoreline is a few metres off and
  // the 8 m raster would show a ragged strip of land along the wall otherwise.)
  function setCell(x, y, v) {
    var gx = Math.floor((x - minx) / CELL), gy = Math.floor((y - miny) / CELL);
    if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) grid[gy * gw + gx] = v;
  }
  var WATER_FROM = 6, WATER_BAND = 30;
  for (var q = 0; q < n; q += 1) {
    var s0 = q * STEP;
    if (s0 < 40 || s0 > (n - 1) * STEP - 30) continue; // leave the two ends as mapped
    var hh = Math.atan2(px[Math.min(n - 1, q + 3)] - px[Math.max(0, q - 3)], py[Math.min(n - 1, q + 3)] - py[Math.max(0, q - 3)]);
    var nx = -Math.cos(hh), ny = Math.sin(hh);
    for (var o = WATER_FROM; o <= WATER_BAND; o += 3) setCell(px[q] + nx * o, py[q] + ny * o, 1);
    for (var o2 = -40; o2 < WATER_FROM - 1; o2 += 3) setCell(px[q] + nx * o2, py[q] + ny * o2, 0);
  }
  function inWater(x, y) {
    var gx = Math.floor((x - minx) / CELL), gy = Math.floor((y - miny) / CELL);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return false;
    return grid[gy * gw + gx] === 1;
  }

  // 4. Landmarks, placed at the path distance nearest their OSM point.
  var P = D.points;
  var stairs = ["stair1", "stair2", "stair3", "stair4", "stair5", "stair6"].map(function (k) {
    return nearestS(P[k][0], P[k][1]).s;
  });
  var pierS = nearestS(P.boatPier[0], P.boatPier[1]).s;

  var lamps = [];
  for (var ls = 10; ls < L - 6; ls += 24) lamps.push(ls);

  SW.world = {
    L: L, STEP: STEP, pos: pos, heading: heading, frame: frame, at: at,
    nearestS: nearestS, inWater: inWater, lamps: lamps, stairs: stairs,
    pierS: pierS, points: P,
    waterCells: function () { var c = 0; for (var i = 0; i < grid.length; i++) c += grid[i]; return c; }
  };
})();
