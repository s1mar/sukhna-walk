// Notes on the lake; design, storage, pairing and photos are in notes/NOTES_FEATURE.md. Every word she sees is from
// SW.lines.NOTES (approved script); without it (generic edition) this file does nothing. No token is ever in this
// file, the repo or a release. Told photos upload to images/<id>.jpg before a note points at them.
(function () {
  "use strict";
  var REPO = "s1mar/sukhna-notes", FILE = "notes.json";
  var API = "https://api.github.com/repos/";
  var TOKEN_FORM = "https://github.com/settings/personal-access-tokens/new";
  var MAX_TEXT = 600, NEAR_M = 12, PIC_LONG = 1280, PIC_MAX = 300 * 1024;
  var KEY = SW.edition.key("sukhna-notes-v1"), PKEY = SW.edition.key("sukhna-notes-pair-v1");
  var doc = { v: 1, notes: {} }, pair = null, timer = 0, running = null, again = false, saidBuilt = {};
  var simar = /(?:^#|&)simar=1(?:&|$)/.test(location.hash);

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else if (k === "on") e.addEventListener("click", attrs[k]); else e.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function num(v, a, b) { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : null; }
  // a note is data, never trusted: fields coerced, text cut, unknown fields dropped
  function clean(n) {
    if (!n || typeof n !== "object" || typeof n.id !== "string" || !/^[a-z0-9]{6,24}$/.test(n.id)) return null;
    var s = num(n.s, 0, 5000), u = num(n.u, 0, 1e14), at = num(n.at, 0, 1e14);
    if (s === null || u === null) return null;
    var out = { id: n.id, s: s, at: at || u, u: u, to: n.to === "simar" ? "simar" : "me", text: (typeof n.text == "string" ? n.text : "").slice(0, MAX_TEXT), built: !!n.built, hour: n.hour == null ? null : num(n.hour, 0, 24) };
    var m = n.img;
    if (m && typeof m === "object" && m.path === "images/" + n.id + ".jpg") out.img = { path: m.path, w: num(m.w, 0, 8192) || 0, h: num(m.h, 0, 8192) || 0, bytes: num(m.bytes, 0, 4e6) || 0 };
    if (n.pp === true) out.pp = true;   // a photo on this phone that is not on GitHub yet (never synced)
    if (n.pic && typeof n.pic === "object") out.pic = { w: num(n.pic.w, 0, 8192) || 0, h: num(n.pic.h, 0, 8192) || 0 };   // this phone keeps a photo for the note
    return out;
  }
  function cleanDoc(d) {
    var out = { v: 1, notes: {} }, src = d && typeof d === "object" && d.notes && typeof d.notes === "object" ? d.notes : {};
    for (var k in src) { var n = clean(src[k]); if (n && n.id === k) out.notes[k] = n; }
    return out;
  }
  function load() {
    try { doc = cleanDoc(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { doc = { v: 1, notes: {} }; }
    try { var p = JSON.parse(localStorage.getItem(PKEY) || "null"); if (p && typeof p.t === "string" && p.r === REPO) pair = { t: p.t, r: REPO }; } catch (e) { pair = null; }
  }
  function persist() { try { var o = cleanDoc(JSON.parse(localStorage.getItem(KEY))).notes; for (var k in o) if (!doc.notes[k] || o[k].u > doc.notes[k].u) doc.notes[k] = o[k]; localStorage.setItem(KEY, JSON.stringify(doc)); } catch (e) { /* storage blocked: notes last this visit */ } }
  function savePair() { try { if (pair) localStorage.setItem(PKEY, JSON.stringify(pair)); else localStorage.removeItem(PKEY); } catch (e) { /* storage blocked */ } }

  // ---- pairing from her link: #k=...&p=<base64url {"t":token,"r":repo}>; kept on the phone, dropped from the address bar
  function b64url(s) { return b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return unb64(s); }
  function b64(s) { var b = new TextEncoder().encode(s), o = ""; for (var i = 0; i < b.length; i++) o += String.fromCharCode(b[i]); return btoa(o); }
  function unb64(s) { var o = atob(s.replace(/\s/g, "")), b = new Uint8Array(o.length); for (var i = 0; i < o.length; i++) b[i] = o.charCodeAt(i); return new TextDecoder().decode(b); }
  function takePairFromLink() {
    var m = /(?:^#|&)p=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m || !/^#k=/.test(location.hash)) return;
    try { var p = JSON.parse(unb64url(m[1])); if (p && typeof p.t === "string" && p.t && p.r === REPO) { pair = { t: p.t, r: REPO }; savePair(); } } catch (e) { /* a broken pairing: ignored */ }
    try { history.replaceState(null, "", location.pathname + location.search + location.hash.replace(/&p=[A-Za-z0-9_-]+/, "")); } catch (e) { /* the address bar keeps it */ }
  }

  // ---- sync: one at a time; read, merge (newest u wins per note), write with the file's sha, retry on a clash
  function shared() {
    var o = {};
    for (var k in doc.notes) if (doc.notes[k].to === "simar") { var n = doc.notes[k], c = {}; for (var f in n) if (f !== "pp" && f !== "pic") c[f] = n[f]; o[k] = c; }
    return o;
  }
  function merge(remote) {
    var changed = false;
    for (var k in remote.notes) {
      var r = remote.notes[k], l = doc.notes[k];
      if (!l || r.u > l.u || (r.u === l.u && r.built && !l.built)) { if (l && l.pp && !r.img) r.pp = true; if (l && l.pic) r.pic = l.pic; doc.notes[k] = r; changed = true; }
    }
    return changed;
  }
  function headers(extra) { var h = { Accept: "application/vnd.github+json" }; h.Authorization = "Bearer " + pair.t; for (var k in extra || {}) h[k] = extra[k]; return h; }
  function url() { return API + REPO + "/contents/" + FILE; }
  function later(n) { return Math.max(Date.now(), n.u + 1); }   // a phone clock ahead never undoes a newer change
  function ts() { return AbortSignal.timeout && AbortSignal.timeout(45000); }   // a hung request ends
  function same(a, b) { return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b)); }
  function sortKeys(o) { var out = {}; Object.keys(o).sort().forEach(function (k) { out[k] = o[k]; }); return out; }
  async function runSync() {
    for (var i = 0; i < 4; i++) {
      var r = await fetch(url() + "?_=" + Date.now(), { signal: ts(), headers: headers(), cache: "no-store" });
      var sha = null, remote = { v: 1, notes: {} };
      if (r.status === 404) { /* the file is not there yet: the first write makes it */ }
      else if (r.ok) { var j = await r.json(); sha = j.sha; try { remote = cleanDoc(JSON.parse(j.content ? unb64(j.content) : j.size ? "?" : "{}")); } catch (e) { return "unreadable"; } }   // never overwrite a file we cannot read
      else return r.status === 401 ? "expired" : r.status === 403 || r.status === 404 ? "denied" : "offline";
      if (merge(remote)) { persist(); }
      if (!i) await sendPhotos();   // after the merge, so a photo's newer u never undoes Simar's Mark built
      var mine = shared();
      if (sha && same(mine, remote.notes)) return "ok";
      var body = { message: "notes: " + new Date().toISOString(), content: b64(JSON.stringify({ v: 1, notes: mine }, null, 1)) };
      if (sha) body.sha = sha;
      var w = await fetch(url(), { method: "PUT", signal: ts(), headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (w.ok) return "ok";
      if (w.status === 409 || w.status === 422) { await new Promise(function (res) { setTimeout(res, 250 + Math.random() * 500); }); continue; }
      return w.status === 401 ? "expired" : w.status === 403 ? "denied" : "offline";
    }
    return "retry";
  }
  // ---- photos
  var DB = SW.edition.key("sukhna-pics-v1");
  function idb(mode, fn) {
    return new Promise(function (ok, no) {
      if (!window.indexedDB) return no(new Error("no idb"));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore("pics"); };
      r.onerror = function () { no(r.error); };
      r.onsuccess = function () {
        var d = r.result, t = d.transaction("pics", mode), q = fn(t.objectStore("pics"));
        t.oncomplete = function () { d.close(); ok(q && q.result); };
        t.onerror = t.onabort = function () { d.close(); no(t.error || new Error("idb")); };
      };
    });
  }
  // raw bytes, not a Blob: some WebKit builds cannot keep a Blob in IndexedDB
  async function picPut(id, blob) { var buf = blob.arrayBuffer ? await blob.arrayBuffer() : await new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; r.readAsArrayBuffer(blob); }); return idb("readwrite", function (st) { return st.put(buf, id); }); }
  async function picGet(id) { var buf = await idb("readonly", function (st) { return st.get(id); }); return buf && buf.byteLength ? new Blob([buf], { type: "image/jpeg" }) : null; }
  function decode(file) {
    return new Promise(function (ok, no) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { ok({ src: im, w: im.naturalWidth, h: im.naturalHeight, done: function () { URL.revokeObjectURL(u); } }); };
      im.onerror = function () { URL.revokeObjectURL(u); no(new Error("read")); };
      im.src = u;
    });
  }
  // canvas re-encode: only pixels survive, so EXIF and GPS never leave the phone
  async function shrink(file) {
    if (!file || file.size > 40 * 1024 * 1024) throw new Error("read");
    var d = await decode(file), out = null;
    try {
      if (!d.w || !d.h) throw new Error("read");
      var steps = [[PIC_LONG, 0.85], [PIC_LONG, 0.75], [PIC_LONG, 0.65], [1024, 0.6], [800, 0.55]];
      for (var i = 0; i < steps.length; i++) {
        var k = Math.min(1, steps[i][0] / Math.max(d.w, d.h)), w = Math.max(1, Math.round(d.w * k)), h = Math.max(1, Math.round(d.h * k));
        var c = document.createElement("canvas"); c.width = w; c.height = h;
        var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.drawImage(d.src, 0, 0, w, h);
        var b = await new Promise(function (r) { c.toBlob(r, "image/jpeg", steps[i][1]); });
        c.width = c.height = 0;
        if (!b) continue;
        out = { blob: new Blob([b], { type: "image/jpeg" }), w: w, h: h };
        if (b.size <= PIC_MAX) break;
      }
    } finally { d.done(); }
    if (!out) throw new Error("read");
    return out;
  }
  function blobB64(b) { return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(",")[1] || ""); }; r.onerror = function () { no(r.error); }; r.readAsDataURL(b); }); }
  function picUrl(path) { return API + REPO + "/contents/" + path; }
  async function putPhoto(n) {
    var blob = await picGet(n.id); if (!blob) return "gone";
    var path = "images/" + n.id + ".jpg";
    var w = await fetch(picUrl(path), { method: "PUT", signal: ts(), headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ message: "notes: photo " + new Date().toISOString(), content: await blobB64(blob) }) });
    if (!w.ok && w.status !== 422) return "offline";   // 422: the file is already there from an earlier try
    var meta = n.pic || {};
    n.img = { path: path, w: meta.w || 0, h: meta.h || 0, bytes: blob.size }; delete n.pp; n.u = later(n); persist();
    return "ok";
  }
  async function sendPhotos() {
    for (var k in doc.notes) {
      var n = doc.notes[k];
      if (n.to !== "simar" || !n.pp) continue;
      var r; try { r = await putPhoto(n); } catch (e) { r = "offline"; }
      if (r === "gone") { delete n.pp; persist(); }
    }
  }
  function waiting(id) { var n = doc.notes[id]; return !!(n && n.pp); }
  var pu = {};   // one fetch per photo (overlapping ones hung in WebKit); a failure is retried
  function photoUrl(n) {
    var k = n.id + !!n.pic, f = function (u) { delete pu[k]; return u; };
    return pu[k] || (pu[k] = fetchPhoto(n).then(function (u) { return u || f(u); }, function (e) { f(); throw e; }));
  }
  async function fetchPhoto(n) {
    if (n.pic) { try { var b = await picGet(n.id); if (b) return URL.createObjectURL(b); } catch (e) { /* not on this phone */ } }
    if (!n.img || !pair) return null;
    var r = await fetch(picUrl(n.img.path), { signal: ts(), headers: headers({ Accept: "application/vnd.github.raw" }), cache: "no-store" });
    if (!r.ok) return null;
    return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: "image/jpeg" }));
  }

  function sync() {
    if (!pair) return Promise.resolve("local");
    if (running) { again = true; return running; }
    running = runSync().catch(function () { return "offline"; }).then(function (res) {
      running = null; api.last = res;
      if (again) { again = false; return sync(); }
      if (res !== "ok") { clearTimeout(timer); timer = setTimeout(sync, 30000); }   // keep trying quietly; a waiting note stays on the phone
      return res;
    });
    return running;
  }

  // ---- her side: the box in More
  function here() { var st = SW.debug && SW.debug.state; return st ? { s: st.s, hour: st.hour } : null; }
  function uid() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 16); }
  // resolves {note, photo: "none" | "kept" | "lost"}; the note's text is saved before the photo is even stored
  async function add(text, to, photo) {
    var h = here(); if (!h) return null;
    var now = Date.now(), n = clean({ id: uid(), s: h.s, hour: typeof h.hour === "number" ? h.hour : null, at: now, u: now, to: to, text: text });
    doc.notes[n.id] = n; persist();
    var res = "none";
    if (photo) {
      try { await picPut(n.id, photo.blob); n.pic = { w: photo.w, h: photo.h }; if (to === "simar") n.pp = true; res = "kept"; }
      catch (e) { res = "lost"; }
      persist();
    }
    if (to === "simar") await sync();
    return { note: n, photo: res };
  }
  function told() { var c = 0; for (var k in doc.notes) if (doc.notes[k].to === "simar") c++; return c; }
  function buildBox(N) {
    var box = $("notesBox"); if (!box) return;
    box.hidden = false;
    var ta = el("textarea", { maxlength: String(MAX_TEXT), placeholder: N.prompt, "aria-label": N.prompt, id: "noteText" });
    var form = el("div", { id: "noteForm" }, [ta]); form.hidden = true;
    var picked = null, busy = false;
    var file = el("input", { type: "file", accept: "image/*", id: "notePhotoFile", hidden: "" });
    var addP = el("button", { id: "bNotePhoto", type: "button", text: N.photo, on: function () { file.click(); } });
    var thumb = el("img", { id: "notePhotoThumb", alt: N.photoAlt });
    var dropP = el("button", { id: "bNotePhotoRemove", type: "button", text: N.photoRemove, on: function () { setPick(null); addP.focus(); } });
    var prev = el("div", { id: "notePhotoPrev", class: "row" }, [thumb, dropP]); prev.hidden = true;
    var msg = el("p", { id: "notePhotoMsg", class: "small", role: "status" }); msg.hidden = true;
    function setPick(p) {
      if (picked) URL.revokeObjectURL(picked.url);
      picked = p; prev.hidden = !p; addP.hidden = !!p;
      if (p) thumb.src = p.url; else thumb.removeAttribute("src");
    }
    file.addEventListener("change", async function () {
      var f = file.files && file.files[0]; file.value = ""; if (!f) return;
      msg.hidden = true;
      try { var r = await shrink(f); r.url = URL.createObjectURL(r.blob); setPick(r); }
      catch (e) { msg.textContent = N.photoBad; msg.hidden = false; }
    });
    form.appendChild(el("div", { class: "row" }, [addP, file]));
    form.appendChild(prev); form.appendChild(msg);
    var row = el("div", { class: "row" });
    async function finish(to) {
      var t = ta.value.trim(); if (!t || busy) { if (!t) ta.focus(); return; }
      busy = true;
      var p = picked ? { blob: picked.blob, w: picked.w, h: picked.h } : null, r = null;
      try { r = await add(t, to, p); } finally { busy = false; }
      if (!r) return;
      ta.value = ""; setPick(null); msg.hidden = true; form.hidden = true; openB.hidden = false;
      var c = $("bClose"); if (c) c.click();
      if (!SW.dialogue || !SW.dialogue.noteLine) return;
      if (r.photo === "lost") SW.dialogue.noteLine("photoLost");
      else if (to === "simar" && r.photo === "kept" && pair && waiting(r.note.id)) SW.dialogue.noteLine("photoWait");
      else if (to === "simar") SW.dialogue.noteLine("replies", told() - 1); else SW.dialogue.noteLine("kept");
    }
    row.appendChild(el("button", { id: "bNoteMine", text: N.mine, on: function () { finish("me"); } }));
    row.appendChild(el("button", { id: "bNoteTell", text: N.tell, on: function () { finish("simar"); } }));
    row.appendChild(el("button", { id: "bNoteCancel", text: N.cancel, on: function () { ta.value = ""; setPick(null); msg.hidden = true; form.hidden = true; openB.hidden = false; openB.focus(); } }));
    form.appendChild(row);
    var openB = el("button", { id: "bNote", text: N.open, on: function () { openB.hidden = true; form.hidden = false; ta.focus(); } });
    box.appendChild(el("div", { class: "row" }, [openB]));
    box.appendChild(form);
  }

  // ---- Simar's side (his own link with &simar=1): make the key, connect, her link, and mark notes built
  function buildSetup() {
    var box = $("notesBox"); if (!box) return;
    box.hidden = false;
    var wrap = el("div", { id: "notesSetup" }); box.appendChild(wrap);
    function render() {
      wrap.textContent = "";
      wrap.appendChild(el("h2", { text: "Notes (Simar only)" }));
      if (!pair) {
        var q = "name=" + encodeURIComponent("Sukhna notes") + "&description=" + encodeURIComponent("Lets the walk save notes to " + REPO + " and nothing else.") + "&target_name=s1mar&expires_in=365&contents=write";
        wrap.appendChild(el("p", { class: "small", text: "1. Tap Make the key. GitHub opens with it filled in. 2. Under Repository access pick Only select repositories, choose sukhna-notes, tap Generate token, copy it. 3. Paste it here and tap Connect." }));
        wrap.appendChild(el("div", { class: "row" }, [el("button", { id: "bMakeKey", text: "Make the key", on: function () { window.open(TOKEN_FORM + "?" + q, "_blank", "noopener"); } })]));
        var tok = el("input", { type: "password", id: "noteToken", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Token" });
        var msg = el("p", { class: "small", id: "noteMsg" });
        wrap.appendChild(tok);
        wrap.appendChild(el("div", { class: "row" }, [el("button", { id: "bConnect", text: "Connect", on: async function () {
          var t = tok.value.trim(); if (!t) { msg.textContent = "Paste the token first."; return; }
          var prev = pair; pair = { t: t, r: REPO }; msg.textContent = "Checking...";
          var res = await sync();
          if (res !== "ok") { pair = prev; msg.textContent = res === "expired" ? "GitHub did not take that token. Copy all of it." : res === "denied" ? "The token cannot write to sukhna-notes. Give it Contents: Read and write on that repo." : "Could not save (" + res + "). Try again."; return; }
          savePair(); render();
        } })]));
        wrap.appendChild(msg);
        return;
      }
      var link = location.origin + location.pathname + location.hash.replace(/&simar=1/, "").replace(/&p=[A-Za-z0-9_-]+/, "") + "&p=" + b64url(JSON.stringify({ t: pair.t, r: REPO }));
      var ta = el("textarea", { readonly: "", id: "herLink", "aria-label": "Her link" }); ta.value = link;
      wrap.appendChild(el("p", { class: "small", text: "Connected. Send her this link in your private chat. It is a key to the notes: if it leaks, delete the token on GitHub and make a new one." }));
      wrap.appendChild(ta);
      wrap.appendChild(el("div", { class: "row" }, [
        el("button", { text: "Copy her link", on: function () { ta.select(); try { navigator.clipboard.writeText(link); } catch (e) { document.execCommand("copy"); } } }),
        el("button", { text: "Refresh notes", on: function () { sync().then(render); } }),
        el("button", { text: "Disconnect", on: function () { pair = null; savePair(); render(); } })]));
      var list = Object.keys(doc.notes).map(function (k) { return doc.notes[k]; }).filter(function (n) { return n.to === "simar"; }).sort(function (a, b) { return b.at - a.at; });
      if (!list.length) wrap.appendChild(el("p", { class: "small", text: "No notes yet." }));
      list.forEach(function (n) {
        var b = el("button", { class: "noteBuilt", text: n.built ? "Built (undo)" : "Mark built", on: function () { n.built = !n.built; n.u = later(n); persist(); sync().then(render); render(); } });
        wrap.appendChild(el("p", { class: "small", text: Math.round(n.s) + " m, " + new Date(n.at).toLocaleString() + ": " + n.text }));
        if (n.img) {
          var im = el("img", { class: "notePhoto", alt: "Photo with this note" }); wrap.appendChild(im);
          (function (im, n) { photoUrl(n).then(function (u) { if (u) im.src = u; else im.alt = "Photo did not load. Tap Refresh notes."; }, function () { im.alt = "Photo did not load. Tap Refresh notes."; }); })(im, n);
        }
        wrap.appendChild(el("div", { class: "row" }, [b]));
      });
    }
    render();
    if (pair) sync().then(render);
  }

  // ---- markers, and the built line when she walks up to a built note
  var api = {
    last: null,
    marks: function () { var o = []; for (var k in doc.notes) o.push({ s: doc.notes[k].s, built: doc.notes[k].built && doc.notes[k].to === "simar" }); return o; },
    list: function () { return Object.keys(doc.notes).map(function (k) { return doc.notes[k]; }); },
    sync: sync, paired: function () { return !!pair; },
    photo: function (id) { return picGet(id); }, waiting: waiting
  };
  function watchBuilt() {
    setInterval(function () {
      var h = here(); if (!h || !SW.dialogue || SW.dialogue.isOpen()) return;
      for (var k in doc.notes) {
        var n = doc.notes[k];
        if (n.built && n.to === "simar" && !saidBuilt[k] && !n.heard && Math.abs(n.s - h.s) < NEAR_M) {
          saidBuilt[k] = 1;
          if (SW.dialogue.noteLine("builtSay")) { n.heard = 1; try { var seen = JSON.parse(localStorage.getItem(KEY + ":heard") || "{}"); seen[k] = 1; localStorage.setItem(KEY + ":heard", JSON.stringify(seen)); } catch (e) { /* once a visit */ } }
          return;
        }
      }
    }, 1000);
  }
  function init() {
    var N = SW.lines && SW.lines.NOTES;
    if (!N || typeof N.open !== "string") { SW.notes = null; return; }   // the generic edition has no notes
    load();
    try { var seen = JSON.parse(localStorage.getItem(KEY + ":heard") || "{}"); for (var k in seen) saidBuilt[k] = 1; } catch (e) { /* none heard */ }
    takePairFromLink();
    SW.notes = api;
    if (simar) buildSetup(); else buildBox(N);
    // a reply with act "note" (lines.js) opens More at the note box, ready to write
    if (!simar && SW.dialogue && SW.dialogue.on) SW.dialogue.on("note", function () {
      var sh = $("sheet"), m = $("bMore"), b = $("bNote");
      if (sh && m && getComputedStyle(sh).display === "none") m.click();
      if (b && !b.hidden) b.click();
    });
    watchBuilt();
    sync();
    window.addEventListener("online", function () { sync(); });
  }
  if (SW.whenReady) SW.whenReady(init); else init();
})();
