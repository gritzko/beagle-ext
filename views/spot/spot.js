//  views/spot/spot.js — `spot:` structural search VIEW (JAB-021).  Rides the
//  SHARED scaffold views/spot/search.js; the VERB ("spot") selects the
//  structural matcher.  See search.js for the scaffold + parity caveats.
//
//  JAB-004: spot is a CONVERTED (plain-args) verb of the search trio (the twin
//  of the landed regex.js); grep stays legacy on the SAME scaffold.  We can't
//  touch search.js (shared), so spot() adapts the plain call into the scaffold's
//  legacy `handle(row, ctx)`: it synthesises a ctx from the global `be`
//  (repo/sink/out/flags + ambient format→mode), packs its string args as
//  `ctx.args` (the FULL projector URI the scaffold re-parses), and pins
//  `row.verb = "spot"` (the mode selector).  The plain path never seeds, so
//  ctx.refs is empty — a `?ref` search still resolves via the URI query
//  (scaffold q.ref → walkRef), the ctx.refs fast-path only.
"use strict";

const search  = require("./search.js");             // the shared legacy handler
const ambient = require("../../shared/ambient.js");

//  JAB-004: search ONE arg — a full `spot:<uri>` projector URI.  The scaffold's
//  parseURI takes `ctx.args` (the FULL projector URI in slot 0 + trailing
//  `.ext`/`?ref`); each fan-out arg is its OWN standalone URI, so args is
//  `[arg]`.  Reads be.repo/be.sink/be.out + ambient.format(); `ctx` =
//  direct-handler fallback (legacy `spot(row, ctx)` call, no global be).
function spotOne(arg, ctx, args) {
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
  search({ verb: "spot", uri: argv[0] || "." }, shim);
}

//  JAB-004: PLAIN verb (`.jab="args"`) loops its args reading `be`; each arg is
//  a standalone `spot:<uri>` fed into the shared search.js scaffold.
function spot() {
  for (let i = 0; i < arguments.length; i++) spotOne(arguments[i], null, null);
}
spot.jab = "args";
module.exports = spot;
