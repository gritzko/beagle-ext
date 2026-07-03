//  verbs/grep/grep.js — `grep:` literal-substring search VIEW (JAB-022).  Rides
//  the SHARED scaffold views/spot/search.js; the verb ("grep") selects the
//  substring matcher (no lexer, no .ext required).  See search.js for the
//  scaffold + framing.  spot:/regex: keep the legacy delegate; JAB-004 converts
//  ONLY grep: to the plain-args convention by wrapping the scaffold handler.
"use strict";

const handle = require("../spot/search.js");   // the shared (row,ctx) scaffold

//  JAB-004: a `?ref` trail token is NOT a search subject (seed classifies it a
//  ref op, not a row) — only the grep: URI args fan out (each fires one search).
function isSearchArg(a) { return String(a || "")[0] !== "?"; }

//  JAB-004: run ONE grep search — call the scaffold in its (row,ctx) shape with
//  a synthetic ctx off `be` (or the passed-through direct-handler ctx).
function grepOne(uri, ctx) {
  handle({ verb: "grep", uri: uri }, ctx);
}

//  JAB-004: PLAIN verb (`.jab="args"`) reads `be` and fans over its search args,
//  building a synthetic ctx to drive the shared search.js scaffold.
function grep() {
  //  JAB-004: build the shared ctx from `be`; ctx.args carries the FULL arg list
  //  (the scaffold parseURI re-parses args[0]'s grep: URI + any .ext/?ref trail).
  const _be = (typeof be !== "undefined") ? be : null;
  const args = Array.prototype.slice.call(arguments);
  const ctx = {
    repo: (_be && _be.repo) || null,
    sink: (_be && _be.sink) || null,
    args: args,
    refs: [],
  };
  if (!ctx.repo || !ctx.sink) return;
  //  JAB-004: fan out one search per non-ref arg (seed's per-row count); each
  //  handle call re-parses ctx.args[0], matching the legacy queue-row dispatch.
  let fired = 0;
  for (let i = 0; i < args.length; i++)
    if (isSearchArg(args[i])) { grepOne(args[i], ctx); fired++; }
  if (fired === 0) grepOne(args.length ? args[0] : "", ctx);
}
grep.jab = "args";
module.exports = grep;
