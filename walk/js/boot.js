// Content loader. Dev: js/lines.js and js/personal.js are plain scripts, nothing to do.
// Release: those two files are absent; content.enc (iv 12 bytes, then AES-GCM ciphertext)
// holds the lines and the personal start-screen strings. The key lives only in the URL
// fragment (#k=...); it is kept in localStorage after one good decrypt so a reload from
// Messenger still works. Without a good key the start screen stays hidden and a calm
// "needs its link" screen shows instead. A failed download shows a retry screen and never
// touches the stored key: only a definite decrypt failure of a complete body drops it.
(function () {
  "use strict";
  // Saved keys are per edition (SW.edition, js/edition.js): the editions share one origin. The old unprefixed
  // key is only a fallback for the editions that had it, so a saved key from before survives.
  var LSK_BASE = "sukhna-walk-key", LSK = SW.edition.key(LSK_BASE), LSK_OLD = SW.edition.legacy(LSK_BASE);
  var $ = function (id) { return document.getElementById(id); };
  var queue = [], ready = false;

  SW.whenReady = function (fn) { if (ready) fn(); else queue.push(fn); };
  function done() { ready = true; var q = queue; queue = []; q.forEach(function (fn) { fn(); }); }

  // the start screen's "from" line; a generic edition (personal.named) puts the name from the link in front, as text
  function applyPersonal() {
    var p = SW.personal || {};
    if (typeof p.from === "string") $("from").textContent = (p.named === true && SW.who ? "for " + SW.who + ", " : "") + p.from;
  }

  // dev path: lines.js already ran
  if (SW.lines && SW.lines.TOPICS) { applyPersonal(); done(); return; }

  // release path
  SW.lines = {};                       // dialogue.js keeps this reference; it is filled after decrypt
  $("start").style.display = "none";

  // store(LSK, null) drops the key from this edition's slot and from the old unprefixed one it may have been read from
  function store(k, v) {
    try {
      if (v === null) { localStorage.removeItem(k); if (LSK_OLD) localStorage.removeItem(LSK_OLD); }
      else localStorage.setItem(k, v);
    } catch (e) { /* blocked storage */ }
  }
  function stored() {
    try {
      var v = localStorage.getItem(LSK);
      if (v === null && LSK_OLD) v = localStorage.getItem(LSK_OLD);
      return v;
    } catch (e) { return null; }
  }
  function needLink() { $("start").style.display = "none"; $("loadfail").hidden = true; $("needlink").hidden = false; }
  function loadFailed() { $("start").style.display = "none"; $("needlink").hidden = true; $("loadfail").hidden = false; }
  function b64u(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var b = atob(s), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  // the keys to try, in order: the one in the link, then the stored one (a mangled link must not beat a good stored key)
  function candidateKeys() {
    var out = [], m = location.hash.match(/^#k=([A-Za-z0-9_-]+)/), s = stored();
    if (m) out.push({ k: m[1], fromHash: true });
    if (s && /^[A-Za-z0-9_-]+$/.test(s) && !(m && m[1] === s)) out.push({ k: s, fromHash: false });
    return out;
  }
  // resolves with the data, or rejects with { definite: true } when this key cannot open a complete body
  function decrypt(keyStr, buf) {
    var raw;
    try { raw = b64u(keyStr); } catch (e) { return Promise.reject({ definite: true }); }
    if (raw.length !== 32) return Promise.reject({ definite: true });
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]).then(function (key) {
      var u = new Uint8Array(buf);
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, key, u.slice(12));
    }).then(function (plain) {
      var data;
      try { data = JSON.parse(new TextDecoder().decode(plain)); } catch (e) { return Promise.reject({ definite: true }); }
      if (!data || !data.lines || !data.lines.TOPICS) return Promise.reject({ definite: true });
      return data;
    }, function () { return Promise.reject({ definite: true }); });
  }
  function get() {
    return fetch("content.enc", { cache: "no-cache", signal: AbortSignal.timeout && AbortSignal.timeout(30000) }).then(function (r) {
      if (!r.ok || /html/.test(r.headers.get("content-type"))) throw new Error("http");   // a wifi login page is not a wrong key
      return r.arrayBuffer();
    }).then(function (buf) { if (buf.byteLength < 29) throw new Error("short"); return buf; });
  }
  function same(a, b) {
    if (a.byteLength !== b.byteLength) return false;
    var x = new Uint8Array(a), y = new Uint8Array(b);
    for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  function accept(c, data) {
    store(LSK, c.k);
    for (var k in data.lines) SW.lines[k] = data.lines[k];
    SW.personal = data.strings || {};
    applyPersonal();
    $("start").style.display = "";
    $("loadfail").hidden = true;
    done();
  }
  // try each key on one body; resolves { data, c } or { bad: [keys that definitely failed] }
  function tryKeys(keys, buf) {
    var bad = [];
    function next(i) {
      if (i >= keys.length) return Promise.resolve({ bad: bad });
      return decrypt(keys[i].k, buf).then(function (data) { return { data: data, c: keys[i], bad: bad }; },
        function () { bad.push(keys[i]); return next(i + 1); });
    }
    return next(0);
  }

  function load() {
    var keys = candidateKeys();
    if (!keys.length || !window.crypto || !crypto.subtle) { needLink(); return; }
    get().then(function (buf) {
      return tryKeys(keys, buf).then(function (r) {
        if (r.data) { accept(r.c, r.data); return; }
        // every key failed on this body. A truncated body fails the same way a wrong key does, so fetch it again:
        // only an identical second body makes the failure definite and lets a stored key be dropped.
        return get().then(function (buf2) {
          if (!same(buf, buf2)) { return tryKeys(keys, buf2).then(function (r2) { if (r2.data) accept(r2.c, r2.data); else loadFailed(); }); }
          keys.forEach(function (c) { if (!c.fromHash) store(LSK, null); });
          needLink();
        });
      });
    }).catch(function () { loadFailed(); });
  }
  $("bRetry").addEventListener("click", function () { $("loadfail").hidden = true; load(); });
  load();

  window.addEventListener("hashchange", function () { if (location.hash.indexOf("#k=") === 0) location.reload(); });
})();
