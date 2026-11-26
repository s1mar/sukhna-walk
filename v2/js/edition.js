// Edition: which copy of the walk this is, and who it greets. Runs before boot.js and main.js.
//
// SW.edition.key(name): a localStorage key for this edition. Editions share one origin (the
// original, /v2/ and /walk/ live under one host), so every key carries the folder the page is
// served from and saves never cross between them. The old unprefixed keys are still read
// (once, as a fallback) by the editions that had them, so a walk saved before this change
// survives; the generic edition (the /walk/ folder, or ?content=generic in dev) never reads them.
// SW.edition.legacy(name): the old unprefixed key to fall back to, or null.
//
// SW.who: the name from the link fragment, #k=<key>&n=<name>. The fragment never reaches a
// server (a query string would). Decoded, then only letters, marks, spaces, apostrophes,
// dots and hyphens are kept, at most 24 characters. Anything else, or no name, gives "".
// It is shown only through textContent; it is never put into HTML.
(function () {
  "use strict";
  var MAX_NAME = 24;

  function folder() {
    var p = "/";
    try { p = String(location.pathname || "/"); } catch (e) { /* keep the root */ }
    p = p.replace(/[^\/]*$/, "");      // drop a trailing file name such as index.html
    return p || "/";
  }
  function devGeneric() {
    try { return /(?:^|[?&])content=generic(?:&|$)/.test(location.search); } catch (e) { return false; }
  }
  var dir = folder();
  var generic = /\/walk\/$/.test(dir) || devGeneric();

  function cleanName(raw) {
    var s = String(raw || "");
    s = s.replace(/\+/g, " ");
    try { s = decodeURIComponent(s); } catch (e) { /* a broken escape: use the text as it came */ }
    try {
      s = s.replace(/[^\p{L}\p{M} '.\-]/gu, "");
    } catch (e) {
      s = s.replace(/[^A-Za-z '.\-]/g, "");   // an engine without Unicode property escapes
    }
    s = s.replace(/\s+/g, " ").trim();
    s = Array.from(s).slice(0, MAX_NAME).join("").trim();
    return s;
  }
  function nameFromHash() {
    var m = null;
    try { m = /(?:^#|&)n=([^&?]*)/.exec(location.hash); } catch (e) { m = null; }
    return m ? cleanName(m[1]) : "";
  }

  SW.who = nameFromHash();
  SW.edition = {
    dir: dir,
    generic: generic,
    key: function (name) { return name + "@" + dir; },
    legacy: function (name) { return generic ? null : name; }
  };
})();
