// When AI Simar speaks: only when she has stopped, only near something he has a line
// for, one line at a time, never twice, and walking on is always a fine answer.
(function () {
  "use strict";
  var Ls = SW.lines;
  var card = document.getElementById("card");
  var sayEl = card.querySelector(".say"), repEl = card.querySelector(".replies");

  var STILL_BEFORE = 2.2;   // seconds stopped before he says anything
  var GAP_METRES = 70;      // walking between two lines
  var GAP_SECONDS = 25;
  var MAX_PERSONAL = 6;     // personal lines per walk
  var QUIET_MAX = 3;        // in quiet mode only the special spots, and few of them
  var LEAN_YAW_MIN = 55;    // a line about the water needs her turned at least this far toward it...
  var LEAN_STILL = 10;      // ...or standing still this many seconds (she may never have found the look drag)
  var LATER_METRES = 120;   // "maybe later" on a topic: it is offered once more after she has walked this far

  // marks: what she picked before (set by a reply's mark); a later topic may carry
  // variants keyed to a mark, so her earlier answer changes what he says then.
  // later: topic id -> the distance walked (walkTotal) when she put it off. hour: the hour of the day, kept current by main.js.
  var S = { done: {}, ignored: {}, marks: {}, shown: {}, later: {}, personal: 0, quiet: false, walkedSince: 999, sinceLast: 999, spoken: 0, introDone: false, walkTotal: 0, hour: 17.5 };
  // what he says: an earlier answer's variant first (when its hours fit), then the wording for this part of the day, then the plain line
  function sayFor(t) {
    var v = t.variants || [];
    for (var i = 0; i < v.length; i++) if (S.marks[v[i].if] && hourOk(v[i], S.hour)) return v[i].say;
    return hourText(t, "say");
  }
  function hourText(t, key) {
    var b = t.byHour || [];
    for (var i = 0; i < b.length; i++) if (b[i][key] !== undefined && hourOk(b[i], S.hour)) return b[i][key];
    return t[key];
  }
  // hours: [from, to] is the time of day a line fits; it wraps past midnight ([19, 6] is night). No hours means any hour.
  function hourOk(t, h) {
    var r = t.hours;
    if (!r) return true;
    return r[0] <= r[1] ? h >= r[0] && h < r[1] : h >= r[0] || h < r[1];
  }
  // a reply's answer for the hour of the day: the first hour variant that fits, else the plain one
  function thenFor(r, h) {
    var v = r.byHour || [];
    for (var i = 0; i < v.length; i++) if (hourOk(v[i], h)) return v[i].then;
    return r.then;
  }
  var open = null;          // the topic on screen
  var answered = false;     // she tapped a reply for it
  var withAvatar = true, acts = {}, begun = false, dismissTimer = 0;

  function show(topic, text, replies, followUp) {
    if (!followUp) answered = false;
    open = topic;
    sayEl.textContent = "";
    var lines = text.split("\n");
    lines.forEach(function (ln, i) {
      if (i) sayEl.appendChild(document.createElement("br"));
      sayEl.appendChild(document.createTextNode(ln));
    });
    repEl.innerHTML = "";
    (replies || []).forEach(function (r) {
      var b = document.createElement("button");
      b.textContent = r.label;
      b.addEventListener("click", function (e) { e.stopPropagation(); choose(topic, r); });
      repEl.appendChild(b);
    });
    card.scrollTop = 0;
    clearTimeout(dismissTimer);
    // a card with no buttons (a follow-up or a soft line) leaves by itself: nothing on it is left to tap
    if (!(replies && replies.length)) {
      dismissTimer = setTimeout(function () { if (open === topic) hide(); }, Math.min(7000, 3200 + text.length * 40));
    }
    card.style.display = "block";
    document.body.classList.add("carding");
    requestAnimationFrame(function () { card.classList.add("on"); });
  }
  function hide() {
    clearTimeout(dismissTimer);
    card.classList.remove("on");
    document.body.classList.remove("carding");
    var was = open;
    open = null;
    setTimeout(function () { if (!open) card.style.display = "none"; }, 600);
    return was;
  }
  // a line that was on screen but never answered, closed by something other than her (a jump, a change of the hour):
  // it was neither answered nor ignored, so it stays available, and it does not use up a slot
  function giveBack(t) {
    if (!t || t.id === "intro" || t.id === "resume" || answered) return;
    delete S.shown[t.id];
    if (S.spoken > 0) S.spoken--;
    if (t.personal && S.personal > 0) S.personal--;
  }

  function choose(topic, r) {
    // "maybe later" puts a topic off, once: it comes back after a walk; asked a second time it is done
    if (r.later && S.later[topic.id] === undefined) { S.later[topic.id] = S.walkTotal; delete S.shown[topic.id]; }
    else S.done[topic.id] = 1;
    answered = true;
    if (r.mark) S.marks[r.mark] = 1;
    if (r.act === "quiet") S.quiet = true;
    if (r.act && acts[r.act]) acts[r.act]();
    var then = thenFor(r, S.hour);
    if (r.poem) {
      show(topic, Ls.POEM.join("\n") + "\n\n" + (Ls.POEM_BY || ""), [{ label: "Thank you", then: then }], true);
      return;
    }
    if (then) show(topic, then, [], true);
    else hide();
  }

  // the gates that depend only on where she is and what the light is doing (not on what has been said so far)
  function fits(t, fs) {
    if (t.where !== "any" && (fs.s < t.where[0] || fs.s > t.where[1])) return false;
    if (fs.dusk < t.dusk[0] || fs.dusk > t.dusk[1]) return false;
    if (!hourOk(t, fs.hour)) return false;
    if (t.dir && t.dir !== fs.dir) return false;
    if (t.season && t.season.indexOf(fs.season.kind) < 0) return false;
    if (t.lean && fs.yaw < LEAN_YAW_MIN && fs.stillFor < LEAN_STILL) return false;
    return true;
  }
  function eligible(t, fs) {
    if (S.done[t.id]) return false;
    if (S.shown[t.id] && !(S.ignored[t.id] > 0)) return false;   // already on screen once (and saved): a reload never repeats it
    if (S.later[t.id] !== undefined && S.walkTotal - S.later[t.id] < LATER_METRES) return false;   // put off: not before a walk
    if (t.after && !S.done[t.after]) return false;
    if (!fits(t, fs)) return false;
    if (t.walked && S.walkTotal < t.walked) return false;   // a line about the whole walk waits until she has walked that far
    if (t.personal && S.personal >= MAX_PERSONAL) return false;
    if (S.quiet && !t.special) return false;
    if (S.quiet && S.spoken >= QUIET_MAX && t.id !== "home" && t.id !== "regulator") return false;
    return true;
  }

  function pick(fs) {
    var best = null, bestScore = -1;
    for (var i = 0; i < Ls.TOPICS.length; i++) {
      var t = Ls.TOPICS[i];
      if (!eligible(t, fs)) continue;
      // prefer place-anchored lines over "any" ones, and special spots most
      var score = (t.special ? 3 : 0) + (t.where === "any" ? 0 : 2) - (S.ignored[t.id] || 0);
      if (score > bestScore) { best = t; bestScore = score; }
    }
    return best;
  }

  var lastS = null;
  function update(dt, fs) {
    if (lastS !== null) { var d = Math.abs(fs.s - lastS); S.walkedSince += d; S.walkTotal = Math.min(1e6, S.walkTotal + d); }
    lastS = fs.s;
    S.sinceLast += dt;
    S.hour = fs.hour;
    if (!withAvatar) { if (open) hide(); return; }

    if (open) {
      // she walked on: that is an answer too
      if (fs.speed > 0.6) { /* a stroll (about 1.2 m/s) counts as walking on */
        var t = hide();
        if (t && !answered && t.id !== "intro" && t.id !== "resume") {
          S.ignored[t.id] = (S.ignored[t.id] || 0) + 1;
          // a topic she walked past comes back once, softly, later
          if (S.ignored[t.id] >= 2) S.done[t.id] = 1;
        }
        if (t && t.id === "intro") S.introDone = true;
      } else if (!answered && open.id !== "intro" && open.id !== "resume" && (!hourOk(open, fs.hour) || fs.dusk < open.dusk[0] || fs.dusk > open.dusk[1])) {
        // the time of day changed under an open card and the line no longer fits: close it, and keep it for its own hour
        giveBack(hide());
      }
      return;
    }
    if (!S.introDone) {
      // an intro that a jump closed before she answered returns, once she has stopped
      if (begun && fs.stillFor >= STILL_BEFORE) showIntro(false);
      return;
    }
    if (fs.stillFor < STILL_BEFORE) return;
    if (S.walkedSince < GAP_METRES && S.sinceLast < GAP_SECONDS) return;
    if (S.sinceLast < 8) return;
    var topic = pick(fs);
    if (!topic) return;
    S.spoken++;
    S.walkedSince = 0; S.sinceLast = 0;
    if (topic.personal) S.personal++;
    var soft = S.ignored[topic.id] > 0;
    S.shown[topic.id] = 1;
    show(topic, soft ? hourText(topic, "soft") : sayFor(topic), soft ? [] : topic.replies);
    if (soft) S.done[topic.id] = 1;
    if (acts.save) acts.save();   // the slot spent and the topic shown reach the save at once
  }

  function showIntro(resumed) {
    var intro = resumed && S.introDone ? Ls.RESUME : Ls.INTRO;
    show(intro, intro.say, intro.replies.map(function (r) {
      return { label: r.label, then: r.then, byHour: r.byHour, act: r.act };
    }));
    S.introDone = true;
    S.sinceLast = 0;
  }

  function start(o) {
    withAvatar = o.withAvatar;
    begun = true;
    if (typeof o.hour === "number" && isFinite(o.hour)) S.hour = o.hour;
    if (!withAvatar) return;
    showIntro(o.resumed);
  }

  // a state read from a save or a link is data, never trusted: keep only known keys and known value types
  function ids() { var o = {}; (Ls.TOPICS || []).forEach(function (t) { o[t.id] = 1; }); return o; }
  function markNames() {
    var o = {};
    (Ls.TOPICS || []).forEach(function (t) { (t.replies || []).forEach(function (r) { if (r.mark) o[r.mark] = 1; }); });
    return o;
  }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function cleanMap(src, allowed, count) {
    var out = {};
    if (!src || typeof src !== "object" || Array.isArray(src)) return out;
    Object.keys(src).forEach(function (k) {
      if (!own(allowed, k)) return;
      var v = src[k];
      if (count) { if (typeof v === "number" && isFinite(v) && v > 0) out[k] = Math.min(9, Math.floor(v)); }
      else if (v) out[k] = 1;
    });
    return out;
  }
  // topic id -> a distance in metres (zero or more)
  function cleanLater(src, allowed) {
    var out = {};
    if (!src || typeof src !== "object" || Array.isArray(src)) return out;
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (own(allowed, k) && typeof v === "number" && isFinite(v) && v >= 0) out[k] = Math.min(1e6, v);
    });
    return out;
  }
  function count(v, hi) { return typeof v === "number" && isFinite(v) && v > 0 ? Math.min(hi, Math.floor(v)) : 0; }

  SW.dialogue = {
    update: update, start: start,
    isOpen: function () { return !!open; },
    openId: function () { return open ? open.id : null; },
    setAvatar: function (v) {
      var was = withAvatar; withAvatar = !!v;
      if (!withAvatar && open) hide();
      // switched to him mid-walk and he never introduced himself: do that first, then he may speak
      if (withAvatar && !was && begun && !S.introDone && !open) showIntro(false);
    },
    setQuiet: function (v) { S.quiet = !!v; },
    isQuiet: function () { return !!S.quiet; },
    setHour: function (h) { if (typeof h === "number" && isFinite(h)) S.hour = h; },
    on: function (name, fn) { acts[name] = fn; },
    saveState: function () { return { done: S.done, ignored: S.ignored, marks: S.marks, shown: S.shown, later: S.later, personal: S.personal, spoken: S.spoken, quiet: S.quiet, introDone: S.introDone, walkTotal: Math.round(S.walkTotal) }; },
    loadState: function (v) {
      if (!v || typeof v !== "object" || Array.isArray(v)) return;
      var t = ids();
      S.done = cleanMap(v.done, t); S.ignored = cleanMap(v.ignored, t, true); S.marks = cleanMap(v.marks, markNames());
      S.shown = cleanMap(v.shown, t); S.later = cleanLater(v.later, t);
      S.personal = count(v.personal, MAX_PERSONAL); S.spoken = count(v.spoken, 99); S.walkTotal = count(v.walkTotal, 1e6);
      S.quiet = v.quiet === true; S.introDone = v.introDone === true;
    },
    /* she jumped along the dam: the distance does not count as walked, nothing is said at once, and a card that was
       open closes quietly (it is neither answered nor ignored): a topic stays available, and an intro she had not
       answered comes back once she has stopped */
    afterJump: function () {
      lastS = null; S.walkedSince = 0; S.sinceLast = 0;
      if (open) {
        var t = hide();
        if (t && t.id === "intro" && !answered) S.introDone = false; else giveBack(t);
      }
    },
    sayFor: sayFor, hourOk: hourOk, thenFor: thenFor,
    // for the gates: the topics whose place, light, hour, direction and season fit this frame state (what has been said so far is ignored)
    eligibleIds: function (fs) { return (Ls.TOPICS || []).filter(function (t) { return eligible(t, fs); }).map(function (t) { return t.id; }); },
    fitting: function (fs) { return (Ls.TOPICS || []).filter(function (t) { return fits(t, fs); }).map(function (t) { return t.id; }); },
    // Start again clears what was said and chosen, but not the way she asked him to talk: Quiet stays
    reset: function () { S.done = {}; S.ignored = {}; S.marks = {}; S.shown = {}; S.later = {}; S.personal = 0; S.spoken = 0; S.walkTotal = 0; S.walkedSince = 999; S.sinceLast = 999; if (open) hide(); },
    _state: S
  };
})();
