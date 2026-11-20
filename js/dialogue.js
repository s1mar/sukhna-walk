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

  // marks: what she picked before (set by a reply's mark); a later topic may carry
  // variants keyed to a mark, so her earlier answer changes what he says then
  var S = { done: {}, ignored: {}, marks: {}, personal: 0, quiet: false, walkedSince: 999, sinceLast: 999, spoken: 0, introDone: false };
  function sayFor(t) {
    var v = t.variants || [];
    for (var i = 0; i < v.length; i++) if (S.marks[v[i].if]) return v[i].say;
    return t.say;
  }
  var open = null;          // the topic on screen
  var answered = false;     // she tapped a reply for it
  var withAvatar = true, acts = {};

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
    card.style.display = "block";
    document.body.classList.add("carding");
    requestAnimationFrame(function () { card.classList.add("on"); });
  }
  function hide() {
    card.classList.remove("on");
    document.body.classList.remove("carding");
    var was = open;
    open = null;
    setTimeout(function () { if (!open) card.style.display = "none"; }, 600);
    return was;
  }

  function choose(topic, r) {
    S.done[topic.id] = 1;
    answered = true;
    if (r.mark) S.marks[r.mark] = 1;
    if (r.act === "quiet") S.quiet = true;
    if (r.act && acts[r.act]) acts[r.act]();
    if (r.poem) {
      show(topic, Ls.POEM.join("\n") + "\n\n" + (Ls.POEM_BY || ""), [{ label: "Thank you", then: r.then }], true);
      return;
    }
    if (r.then) show(topic, r.then, [], true);
    else hide();
  }

  function eligible(t, fs) {
    if (S.done[t.id]) return false;
    if (t.after && !S.done[t.after]) return false;
    if (t.where !== "any" && (fs.s < t.where[0] || fs.s > t.where[1])) return false;
    if (fs.dusk < t.dusk[0] || fs.dusk > t.dusk[1]) return false;
    if (t.dir && t.dir !== fs.dir) return false;
    if (t.season && t.season.indexOf(fs.season.kind) < 0) return false;
    if (t.lean && fs.yaw < 70) return false;
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
    if (lastS !== null) S.walkedSince += Math.abs(fs.s - lastS);
    lastS = fs.s;
    S.sinceLast += dt;
    if (!withAvatar) { if (open) hide(); return; }

    if (open) {
      // she walked on: that is an answer too
      if (fs.speed > 1.2) {
        var t = hide();
        if (t && !answered && t.id !== "intro" && t.id !== "resume") {
          S.ignored[t.id] = (S.ignored[t.id] || 0) + 1;
          // a topic she walked past comes back once, softly, later
          if (S.ignored[t.id] >= 2) S.done[t.id] = 1;
        }
        if (t && t.id === "intro") S.introDone = true;
      }
      return;
    }
    if (!S.introDone) return;
    if (fs.stillFor < STILL_BEFORE) return;
    if (S.walkedSince < GAP_METRES && S.sinceLast < GAP_SECONDS) return;
    if (S.sinceLast < 8) return;
    var topic = pick(fs);
    if (!topic) return;
    S.spoken++;
    S.walkedSince = 0; S.sinceLast = 0;
    if (topic.personal) S.personal++;
    var soft = S.ignored[topic.id] > 0;
    show(topic, soft ? topic.soft : sayFor(topic), soft ? [] : topic.replies);
    if (soft) S.done[topic.id] = 1;
  }

  function start(o) {
    withAvatar = o.withAvatar;
    if (!withAvatar) return;
    var intro = o.resumed && S.introDone ? Ls.RESUME : Ls.INTRO;
    show(intro, intro.say, intro.replies.map(function (r) {
      return { label: r.label, then: r.then, act: r.act };
    }));
    S.introDone = true;
    S.sinceLast = 0;
  }

  SW.dialogue = {
    update: update, start: start,
    isOpen: function () { return !!open; },
    openId: function () { return open ? open.id : null; },
    setAvatar: function (v) { withAvatar = v; if (!v && open) hide(); },
    on: function (name, fn) { acts[name] = fn; },
    saveState: function () { return { done: S.done, ignored: S.ignored, marks: S.marks, personal: S.personal, quiet: S.quiet, introDone: S.introDone }; },
    loadState: function (v) {
      if (!v || typeof v !== "object") return;
      S.done = v.done || {}; S.ignored = v.ignored || {}; S.marks = v.marks || {}; S.personal = v.personal || 0; S.quiet = !!v.quiet; S.introDone = !!v.introDone;
    },
    sayFor: sayFor,
    reset: function () { S.done = {}; S.ignored = {}; S.marks = {}; S.personal = 0; S.spoken = 0; S.walkedSince = 999; S.sinceLast = 999; if (open) hide(); },
    _state: S
  };
})();
