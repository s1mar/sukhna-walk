// Content loader. Dev: js/lines.js and js/personal.js are plain scripts, nothing to do.
// Release: those two files are absent; content.enc (iv 12 bytes, then AES-GCM ciphertext)
// holds the lines and the personal start-screen strings. The key lives only in the URL
// fragment (#k=...); it is kept in localStorage after one good decrypt so a reload from
// Messenger still works. Without a good key the start screen stays hidden and a calm
// "needs its link" screen shows instead.
(function () {
  "use strict";
  var LSK = "sukhna-walk-key";
  var $ = function (id) { return document.getElementById(id); };
  var queue = [], ready = false;

  SW.whenReady = function (fn) { if (ready) fn(); else queue.push(fn); };
  function done() { ready = true; var q = queue; queue = []; q.forEach(function (fn) { fn(); }); }

  function applyPersonal() {
    var p = SW.personal || {};
    if (typeof p.from === "string") $("from").textContent = p.from;
  }

  // dev path: lines.js already ran
  if (SW.lines && SW.lines.TOPICS) { applyPersonal(); done(); return; }

  // release path
  SW.lines = {};                       // dialogue.js keeps this reference; it is filled after decrypt
  $("start").style.display = "none";

  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* blocked storage */ } }
  function stored() { try { return localStorage.getItem(LSK); } catch (e) { return null; } }
  function needLink() { $("start").style.display = "none"; $("needlink").hidden = false; }
  function b64u(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var b = atob(s), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function findKey() {
    var m = location.hash.match(/^#k=([A-Za-z0-9_-]+)/);
    if (m) return { k: m[1], fromHash: true };
    var s = stored();
    return s && /^[A-Za-z0-9_-]+$/.test(s) ? { k: s, fromHash: false } : null;
  }
  function decrypt(keyStr, buf) {
    var raw = b64u(keyStr);
    if (raw.length !== 32) return Promise.reject(new Error("key"));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]).then(function (key) {
      var u = new Uint8Array(buf);
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, key, u.slice(12));
    }).then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
  }

  var found = findKey();
  if (!found || !window.crypto || !crypto.subtle) { needLink(); return; }
  fetch("content.enc", { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error("http");
    return r.arrayBuffer();
  }).then(function (buf) {
    return decrypt(found.k, buf).then(function (data) {
      if (!data || !data.lines || !data.lines.TOPICS) throw new Error("shape");
      store(LSK, found.k);
      for (var k in data.lines) SW.lines[k] = data.lines[k];
      SW.personal = data.strings || {};
      applyPersonal();
      $("start").style.display = "";
      done();
    }, function () {
      if (!found.fromHash) store(LSK, null);   // a stored key that fails is dropped
      needLink();
    });
  }).catch(function () { needLink(); });

  window.addEventListener("hashchange", function () { if (location.hash.indexOf("#k=") === 0) location.reload(); });
})();
