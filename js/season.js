// Season parameters for Chandigarh (30.74 N). Sun azimuth at sunset from the date.
(function () {
  "use strict";
  function sunsetAz(date) {
    var start = Date.UTC(date.getUTCFullYear(), 0, 0);
    var doy = Math.floor((date.getTime() - start) / 86400000);
    var dec = -23.44 * Math.cos(2 * Math.PI / 365 * (doy + 10));
    var lat = 30.74 * Math.PI / 180;
    var c = Math.sin(dec * Math.PI / 180) / Math.cos(lat);
    return 360 - Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }
  // name -> look. haze 0..1 (winter fog), muddy water in monsoon, migrants in winter.
  var KINDS = {
    winter: { label: "Winter evening", haze: 0.55, muddy: false, migrants: true, coats: true, crowd: 0.8, bloom: null },
    spring: { label: "Spring evening", haze: 0.2, muddy: false, migrants: false, coats: false, crowd: 1, bloom: "jacaranda" },
    summer: { label: "Summer evening", haze: 0.3, muddy: false, migrants: false, coats: false, crowd: 1.15, bloom: "amaltas" },
    monsoon: { label: "Monsoon evening", haze: 0.35, muddy: true, migrants: false, coats: false, crowd: 0.7, bloom: null },
    autumn: { label: "Autumn evening", haze: 0.25, muddy: false, migrants: false, coats: false, crowd: 1, bloom: null }
  };
  // representative date per kind, used when she picks a season by hand
  var REP = { winter: "2026-12-15", spring: "2026-04-10", summer: "2026-06-01", monsoon: "2026-08-10", autumn: "2026-10-15" };
  function kindFor(date) {
    var m = date.getMonth() + 1;
    if (m === 11 || m === 12 || m === 1 || m === 2) return "winter";
    if (m === 3 || m === 4) return "spring";
    if (m === 5 || m === 6) return "summer";
    if (m >= 7 && m <= 9) return "monsoon";
    return "autumn";
  }
  function make(kind, date) {
    var d = date || new Date(REP[kind] + "T12:00:00Z");
    var k = KINDS[kind];
    var az = sunsetAz(d);
    var s = {};
    for (var key in k) s[key] = k[key];
    s.kind = kind;
    s.sunAz = az;
    s.moonAz = (az + 180) % 360; // a full moon rises roughly opposite the setting sun
    return s;
  }
  SW.season = {
    sunsetAz: sunsetAz, kindFor: kindFor, KINDS: KINDS,
    today: function () { var d = new Date(); return make(kindFor(d), d); },
    pick: function (kind) { return make(kind); }
  };
})();
