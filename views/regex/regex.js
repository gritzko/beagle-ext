//  views/regex/regex.js — `regex:` native-RegExp search VIEW (JAB-023).  Rides
//  the SHARED scaffold views/spot/search.js; the VERB ("regex") selects the
//  native JS RegExp matcher (replaces the C Thompson NFA).  See search.js for
//  the scaffold + framing.
//
//  JAB-004: regex is the CONVERTED (plain-args) verb of the search trio; spot/
//  grep stay legacy on the SAME scaffold.  We can't touch search.js (shared), so
//  regex() adapts the plain call into the scaffold's legacy `handle(row, ctx)`:
//  it synthesises a ctx from the global `be` (repo/sink/out/flags + ambient
//  format→mode), packs its string args as `ctx.args` (the FULL projector URI the
//  scaffold re-parses), and pins `row.verb = "regex"` (the mode selector).  The
//  plain path never seeds, so ctx.refs is empty — a `?ref` search still resolves
//  via the URI query (scaffold q.ref → walkRef), the ctx.refs fast-path only.
"use strict";

const search  = require("../spot/search.js");   // the shared legacy handler
const ambient = require("../../shared/ambient.js");

//  JAB-004: search ONE arg — a full `regex:<uri>` projector URI.  The scaffold's
//  parseURI takes `ctx.args` (the FULL projector URI in slot 0 + trailing
//  `.ext`/`?ref`); here each fan-out arg is its OWN standalone URI, so args is
//  `[arg]`.  Reads be.repo/be.sink/be.out + ambient.format(); `ctx` =
//  direct-handler fallback (legacy `regex(row, ctx)` call, no global be).
function regexOne(arg, ctx, args) {
  const _be = (typeof be !== "undefined") ? be : null;
  const argv = args || [String(arg == null ? "" : arg)];
  const shim = {
    repo:  (_be && _be.repo)  || (ctx && ctx.repo)  || null,
    sink:  (_be && _be.sink)  || (ctx && ctx.sink)  || null,
    out:   (_be && _be.out)   || (ctx && ctx.out)   || null,
    flags: (_be && _be.flags) || (ctx && ctx.flags) || [],
    mode:  ambient.format(),               // color|tlv|plain
    args:  argv,                              // the projector URI (+ trail args)
    refs:  (ctx && ctx.refs) || [],           // plain path never seeds → []
  };
  search({ verb: "regex", uri: argv[0] || "." }, shim);
}

//  JAB-004: PLAIN verb (`.jab="args"`) loops its args reading `be`; each arg is
//  a standalone `regex:<uri>` fed into the shared search.js scaffold.
function regex() {
  for (let i = 0; i < arguments.length; i++) regexOne(arguments[i], null, null);
}
regex.jab = "args";
module.exports = regex;
