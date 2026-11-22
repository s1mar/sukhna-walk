/* Sukhna walk: live synthesized soundscape (Web Audio only, no files, no network). */
(function () {
  "use strict";
  var SW = window.SW = window.SW || {};

  var ctx = null, master = null, noiseBuf = null, timer = null;
  var warned = false, wantMuted = false, muted = false, suspendedByUs = false;
  var cur = { walking: false, speed: 0, dusk: 0, s: 0, L: 2496, crowd: 0, season: "summer", migrants: false };
  var B = {}; // persistent nodes and buses
  var cache = {}; // last targets set by update()
  var N = {}; // next scheduled times for each rhythmic layer
  var stepAlt = false;
  var phrase = null, phraseIdx = 0, lastPhraseNo = -1;

  function warn(e) {
    if (warned) return;
    warned = true;
    try { console.warn("SW.audio: " + (e && e.message ? e.message : e)); } catch (x) {}
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // D major pentatonic: A3 B3 D4 E4 F#4 A4 B4 D5 E5
  var SC = [220, 246.94, 293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25];
  // phrases: [scale index, beats]; original, slow, stepwise with open fourth/fifth leaps
  var PHRASES = [
    [[4, 1], [3, 1], [2, 2], [3, 1], [4, 1], [5, 3]],
    [[2, 1], [4, 1], [5, 2], [6, 1], [5, 1], [4, 3]],
    [[5, 1], [4, 1], [3, 1], [2, 1], [1, 2], [2, 1], [3, 3]],
    [[3, 1], [5, 1], [4, 1], [3, 1], [2, 3]]
  ];
  var BEAT = 0.62;

  // ---------- the mix for an hour of the day ----------
  // Pure: what the soundscape should be doing for this walk state. update() and tick() both use it, and the gates read it.
  // Morning (5.5 to 11) has a dawn chorus (nearly twice golden hour's birdsong) and a thinner crowd; the afternoon (11 to 16.5) has sparse birds and the busiest
  // crowd; golden hour (16.5 on) has the dusk birds that fade as the light goes; crickets only after dark.
  function mix(p) {
    var dusk = clamp(p.dusk || 0, 0, 1);
    var h = typeof p.hour === "number" && isFinite(p.hour) ? p.hour : 17.5 + dusk * 3;
    var m = { hour: h, birds: 0, birdGap: [3, 8], chorus: false, crickets: false, crowdK: 1, boats: false, tuneK: 1 };
    if (h >= 5.5 && h < 11) { m.birds = 1.8; m.birdGap = [1.2, 3.2]; m.chorus = true; m.crowdK = 0.55; }
    else if (h >= 11 && h < 16.5) { m.birds = 0.4; m.birdGap = [4, 10]; m.crowdK = 1.15; }
    else if (h >= 16.5 && dusk < 0.3) { m.birds = 1 - dusk / 0.3; }
    m.crickets = dusk > 0.6 && (h >= 18.5 || h < 6);
    m.boats = h >= 8.5 && h < 19.5;
    m.tuneK = h < 16.5 ? 0.6 : 1;
    return m;
  }

  // ---------- helpers ----------
  function tgt(param, key, v, tc) {
    if (cache[key] !== undefined && Math.abs(cache[key] - v) < 0.0015) return;
    cache[key] = v;
    param.setTargetAtTime(v, ctx.currentTime, tc || 0.4);
  }

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 4);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function endCleanup(src, nodes) {
    src.onended = function () {
      for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) {} }
      try { src.disconnect(); } catch (e) {}
    };
  }

  // one-shot noise burst through bandpass
  function noiseBurst(t, dest, freq, q, peak, tau, dur) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.006, tau);
    src.connect(f); f.connect(g); g.connect(dest);
    endCleanup(src, [f, g]);
    src.start(t, Math.random() * 3.5, dur);
    src.stop(t + dur + 0.02);
  }

  // one-shot oscillator with attack/decay envelope
  function tone(t, dest, type, f0, f1, peak, att, dur, filt) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setTargetAtTime(0, t + att, Math.max(0.01, (dur - att) / 4));
    var nodes = [g], last = o;
    if (filt) {
      var f = ctx.createBiquadFilter();
      f.type = filt.type; f.frequency.value = filt.f; f.Q.value = filt.q || 1;
      o.connect(f); f.connect(g); nodes.push(f);
    } else {
      o.connect(g);
    }
    g.connect(dest);
    endCleanup(o, nodes);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function pluck(t, freq, dur, peak) {
    var o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    var o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = freq * 2.003;
    var f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = 2;
    f.frequency.setValueAtTime(2400, t);
    f.frequency.setTargetAtTime(500, t + 0.01, 0.12);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.01, dur / 5);
    var g2 = ctx.createGain();
    g2.gain.value = 0.3;
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(B.tuneIn);
    o.onended = function () {
      var a = [o2, g2, f, g];
      for (var i = 0; i < a.length; i++) { try { a[i].disconnect(); } catch (e) {} }
      try { o.disconnect(); } catch (e) {}
    };
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }

  // ---------- graph ----------
  function build() {
    var c = ctx;
    noiseBuf = makeNoise();

    master = c.createGain();
    master.gain.value = wantMuted ? 0 : 0.85;
    muted = wantMuted;
    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 24; comp.ratio.value = 3;
    comp.attack.value = 0.01; comp.release.value = 0.3;
    master.connect(comp); comp.connect(c.destination);
    B.comp = comp;

    function bus(v) { var g = c.createGain(); g.gain.value = v; g.connect(master); return g; }
    B.water = bus(0); B.steps = bus(0.5); B.crowd = bus(0); B.tune = bus(0);
    B.birds = bus(0.5); B.night = bus(0);

    // 1. water
    var ws = c.createBufferSource();
    ws.buffer = noiseBuf; ws.loop = true; ws.playbackRate.value = 0.8;
    B.waterLP = c.createBiquadFilter();
    B.waterLP.type = "lowpass"; B.waterLP.frequency.value = 500; B.waterLP.Q.value = 0.5;
    B.waterSwell = c.createGain();
    B.waterSwell.gain.value = 0.6;
    ws.connect(B.waterLP); B.waterLP.connect(B.waterSwell); B.waterSwell.connect(B.water);
    ws.start();

    // 3. crowd murmur: three distant voice bands
    var bands = [[420, 0.9], [760, 1.1], [1150, 1.3]];
    B.crowdAM = [];
    for (var i = 0; i < bands.length; i++) {
      var s = c.createBufferSource();
      s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = bands[i][1];
      var bp = c.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = bands[i][0]; bp.Q.value = 2.5;
      var am = c.createGain();
      am.gain.value = 0.3;
      s.connect(bp); bp.connect(am); am.connect(B.crowd);
      s.start(0, i * 1.1);
      B.crowdAM.push(am);
    }

    // 4. tune bus with a distant delay
    B.tuneIn = c.createGain();
    B.tuneIn.gain.value = 1;
    var dl = c.createDelay(1.0); dl.delayTime.value = 0.36;
    var fb = c.createGain(); fb.gain.value = 0.35;
    var dlp = c.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 1200;
    var wet = c.createGain(); wet.gain.value = 0.55;
    B.tuneIn.connect(B.tune);
    B.tuneIn.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl);
    dlp.connect(wet); wet.connect(B.tune);
  }

  // ---------- scheduler ----------
  function tick() {
    if (!ctx || ctx.state !== "running") return;
    try {
      var now = ctx.currentTime, ahead = now + 0.3, p = cur;
      var dusk = clamp(p.dusk || 0, 0, 1);

      // water swells
      if (N.swell === undefined || N.swell < now - 1) N.swell = now;
      while (N.swell < ahead) {
        var mons = p.season === "monsoon";
        B.waterSwell.gain.setTargetAtTime(rnd(mons ? 0.5 : 0.25, 1.0), N.swell, rnd(0.8, 1.6));
        N.swell += rnd(3, 6);
      }

      // crowd murmur modulation
      for (var i = 0; i < B.crowdAM.length; i++) {
        var k = "cm" + i;
        if (N[k] === undefined || N[k] < now - 1) N[k] = now;
        while (N[k] < ahead) {
          var burst = Math.random() < 0.12;
          B.crowdAM[i].gain.setTargetAtTime(burst ? rnd(0.7, 1) : rnd(0.05, 0.5), N[k], rnd(0.15, 0.5));
          N[k] += rnd(0.4, 1.6);
        }
      }

      // footsteps
      if (p.walking && p.speed > 0.02) {
        var sp = Math.max(0.15, p.speed);
        if (N.step === undefined || N.step < now) N.step = now + 0.02;
        while (N.step < ahead) {
          stepAlt = !stepAlt;
          var lvl = (0.35 + 0.35 * sp) * (stepAlt ? 1 : 0.8) * rnd(0.85, 1.1);
          noiseBurst(N.step, B.steps, (stepAlt ? 860 : 960) * rnd(0.95, 1.05), 1.2, lvl, 0.012, 0.14);
          N.step += 1 / (1.8 * sp);
        }
      } else {
        N.step = undefined;
      }

      var m = mix(p);
      // boatman's tune
      var tuneOn = dusk < 0.45 && p.s < 900 && m.boats;
      if (N.tune === undefined || N.tune < now - 1) N.tune = now + 1;
      if (tuneOn) {
        while (N.tune < ahead) {
          if (!phrase) {
            var no;
            do { no = Math.floor(Math.random() * PHRASES.length); } while (no === lastPhraseNo && PHRASES.length > 1);
            lastPhraseNo = no; phrase = PHRASES[no]; phraseIdx = 0;
          }
          var nt = phrase[phraseIdx];
          pluck(N.tune, SC[nt[0]], nt[1] * BEAT * 1.4, 0.16);
          N.tune += nt[1] * BEAT;
          phraseIdx++;
          if (phraseIdx >= phrase.length) { phrase = null; N.tune += rnd(5, 9); }
        }
      } else if (N.tune < now) {
        N.tune = now + 1; phrase = null;
      }

      // winter water birds
      if (N.water === undefined || N.water < now - 1) N.water = now + rnd(1, 4);
      if (p.migrants) {
        var wq = dusk > 0.7 ? clamp(1 - (dusk - 0.7) / 0.3 * 0.8, 0.2, 1) : 1;
        while (N.water < ahead) {
          if (Math.random() < 0.65) {
            tone(N.water, B.birds, "square", rnd(1200, 1800), 0, 0.035 * wq, 0.004, 0.03,
              { type: "bandpass", f: 1500, q: 1.5 });
          } else {
            var qf = rnd(330, 380);
            tone(N.water, B.birds, "sawtooth", qf * 1.5, qf * 0.8, 0.05 * wq, 0.012, 0.12,
              { type: "bandpass", f: 700, q: 2 });
          }
          N.water += rnd(4, 12);
        }
      } else if (N.water < now) {
        N.water = now + rnd(1, 4);
      }

      // birds: a dawn chorus in the morning, a few in the afternoon, the dusk birds at golden hour
      if (N.dbird === undefined || N.dbird < now - 1) N.dbird = now + rnd(1, 3);
      if (m.birds > 0.02) {
        var dq = m.birds;
        while (N.dbird < ahead) {
          var bf = rnd(2200, 3000);
          tone(N.dbird, B.birds, "sine", bf, bf * 1.12, 0.03 * dq, 0.01, 0.09);
          tone(N.dbird + 0.13, B.birds, "sine", bf * 1.2, bf * 0.95, 0.025 * dq, 0.01, 0.08);
          if (m.chorus) {   // a second voice, higher, answering in a quick trill
            var tf = rnd(3300, 4100);
            for (var q = 0; q < 3; q++) tone(N.dbird + 0.4 + q * 0.07, B.birds, "sine", tf, tf * 1.06, 0.022, 0.006, 0.05);
          }
          N.dbird += rnd(m.birdGap[0], m.birdGap[1]);
        }
      } else if (N.dbird < now) {
        N.dbird = now + rnd(1, 3);
      }

      // crickets and owl after dark
      if (N.cric === undefined || N.cric < now - 1) N.cric = now + rnd(0.2, 1);
      if (N.owl === undefined || N.owl < now - 1) N.owl = now + rnd(8, 20);
      if (m.crickets) {
        while (N.cric < ahead) {
          var n = 3 + Math.floor(Math.random() * 2);
          var cf = rnd(4300, 4700);
          for (var j = 0; j < n; j++) {
            tone(N.cric + j * 0.075, B.night, "sine", cf, 0, 0.5, 0.006, 0.035);
          }
          N.cric += n * 0.075 + rnd(0.4, 2.5);
        }
        if (N.owl < ahead) {
          tone(N.owl, B.night, "sine", 380, 372, 0.9, 0.15, 0.55);
          tone(N.owl + 0.7, B.night, "sine", 330, 322, 0.8, 0.18, 0.75);
          N.owl += rnd(25, 50);
        }
      } else {
        if (N.cric < now) N.cric = now + rnd(0.2, 1);
        if (N.owl < now) N.owl = now + rnd(8, 20);
      }
    } catch (e) { warn(e); }
  }

  // ---------- public API ----------
  SW.audio = {
    init: function () {
      try {
        try {
          if (navigator.audioSession) navigator.audioSession.type = "playback";
        } catch (e) {}
        if (ctx) { this.resume(); return; }
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { warn("Web Audio not supported"); return; }
        ctx = new AC();
        try {
          var sb = ctx.createBuffer(1, 1, 22050);
          var ss = ctx.createBufferSource();
          ss.buffer = sb; ss.connect(ctx.destination); ss.start(0);
        } catch (e) {}
        build();
        if (ctx.state !== "running" && ctx.resume) {
          var r = ctx.resume();
          if (r && r.catch) r.catch(function () {});
        }
        timer = setInterval(tick, 100);
      } catch (e) {
        warn(e);
      }
    },

    update: function (p) {
      if (!p) return;
      cur = p;
      if (!ctx || !master) return;
      try {
        var dusk = clamp(p.dusk || 0, 0, 1);
        var mons = p.season === "monsoon";
        tgt(B.water.gain, "water", mons ? 0.3 : 0.2, 0.8);
        tgt(B.waterLP.frequency, "wlp", mons ? 750 : 500, 0.8);
        var m = mix(p);
        tgt(B.crowd.gain, "crowd", clamp(p.crowd || 0, 0, 1) * (1 - 0.7 * dusk) * 0.12 * m.crowdK, 0.6);
        var tl = 0;
        if (dusk < 0.45 && p.s < 900 && m.boats) tl = (1 - dusk / 0.45) * clamp((900 - p.s) / 120, 0, 1) * m.tuneK;
        tgt(B.tune.gain, "tune", tl * 0.8, 1.2);
        var nl = clamp((dusk - 0.6) / 0.25, 0, 1);
        if (p.season === "winter") nl *= 0.5;
        tgt(B.night.gain, "night", nl * 0.05, 1.5);
      } catch (e) { warn(e); }
    },

    setMuted: function (m) {
      wantMuted = !!m;
      if (!ctx || !master) return;
      try {
        var t = ctx.currentTime, g = master.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(wantMuted ? 0 : 0.85, t + 0.3);
        muted = wantMuted;
      } catch (e) { warn(e); }
    },

    suspend: function () {
      if (!ctx) return;
      try {
        suspendedByUs = true;
        var r = ctx.suspend();
        if (r && r.catch) r.catch(function () {});
      } catch (e) { warn(e); }
    },

    resume: function () {
      if (!ctx) return;
      try {
        suspendedByUs = false;
        if (ctx.state !== "running") {
          var r = ctx.resume();
          if (r && r.catch) r.catch(function () {});
        }
      } catch (e) { warn(e); }
    },

    mix: mix,
    get started() { return !!ctx; },
    get state() { return ctx ? ctx.state : "none"; },

    // Test hook: RMS level (0..1) of what reaches the speakers, over about 85 ms.
    level: function () {
      if (!ctx || !B.comp) return -1;
      if (!B.probe) { B.probe = ctx.createAnalyser(); B.probe.fftSize = 4096; B.comp.connect(B.probe); }
      var a = new Float32Array(B.probe.fftSize);
      B.probe.getFloatTimeDomainData(a);
      var s = 0;
      for (var i = 0; i < a.length; i++) s += a[i] * a[i];
      return Math.sqrt(s / a.length);
    }
  };
})();
