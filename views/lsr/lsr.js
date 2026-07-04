//  views/lsr/lsr.js — `lsr:` recursive worktree listing (JAB-019/JAB-004).  lsr
//  IS ls with recursion ON.  The per-dir listing + FIFO self-drive live in
//  ../ls/ls.js (its plain fn strips an `lsr:` scheme → recurses); here we pin
//  the IDENTITY off `be.verb` (authoritative, not the scheme) and force every
//  arg to carry `lsr:`, so `jab lsr .` recurses even with a scheme-less arg.
"use strict";

const ls = require("../ls/ls.js");

//  JAB-004: normalise one scope token to the `lsr:` scheme so ls's plain branch
//  drives the recursion (drop an existing ls:/lsr: prefix first — no double tag).
function asLsr(tok) {
  //  URI-013: force the `lsr:` scheme via the URI class — parse the token (an
  //  ls:/lsr:/scheme-less form) and re-make with scheme `lsr`, KEEPING auth/path/
  //  query/frag; replaces the indexOf-strip + `"lsr:" + s` concat.
  let u; try { u = uri._parse(String(tok || "")); } catch (e) { u = null; }
  if (!u) return "lsr:" + String(tok || "");
  return URI.make("lsr", u.authority, u.path, u.query, u.fragment) || "lsr:";
}

//  JAB-004: PLAIN verb (`.jab="args"`) — identity is `be.verb` ("lsr"), NOT the
//  scheme; force recursion on every arg then hand off to the shared ls listing.
function lsr() {
  //  No positional → the cwd (the legacy seed's "." row), always as lsr:.
  const argv = arguments.length ? arguments : ["."];
  const pfxd = [];
  for (let i = 0; i < argv.length; i++) pfxd.push(asLsr(argv[i]));
  ls.apply(null, pfxd);
}
lsr.jab = "args";
module.exports = lsr;
