//  core/registry.js — the verb->handler registry.  build() resolves each
//  distinct verb to its handler ONCE via require(verb) (warm process-resident
//  cache, keyed by abspath), so the require/eval cost is paid per DISTINCT verb.
"use strict";

//  VERB CONTRACT (JAB-004): a verb is a PLAIN-ARGS function.
//    module.exports = function verb(...args) { ... }; verb.jab = "args";
//      args : the tokenizer's plain JS values (strings / safe-scalars / evaled).
//      ambient repo/sink/out/format/force/verb ride the global `be` (mintBe).
//      the verb parses its own URIs, owns its own fan-out, feeds be.sink/be.out;
//      a THROW propagates to the loop edge (jab maps it to the non-zero exit).
//    (Object form `module.exports = { args:true, run:verb }` is also accepted.)
//    A verb module must NOT run `main();` — the cache evals the body ONCE.

//  JAB-004: opt-in marker — a verb exports a fn with `.jab==="args"` (or
//  `{args:true,run:fn}`).  An unmarked module has no plain-args handler.
function convention(mod) {
  if (mod && typeof mod === "object" && mod.args === true && typeof mod.run === "function")
    return { how: "args", fn: mod.run };
  if (typeof mod === "function")
    return { how: mod.jab === "args" ? "args" : "legacy", fn: mod };
  return null;                              // not a handler module
}

//  GIT-016: verbs register by FILE — a bareword resolves to verbs/<verb>/<verb>.js
//  here (no explicit list); `head` (verbs/head/head.js) is picked up automatically.
//  build(verbs, requireFn): map each distinct verb name to its handler.
//  `requireFn` is the be-relative require of the CALLING module (so the
//  upward be/-scan finds the shard nearest loop.js, not cwd); default the
//  global require.  A verb whose module does not export a handler is left
//  ABSENT (null) from the table — cli() then refuses the verb.
//  JAB-004: a converted entry is `{jab:"args",fn}` so cli() routes plain dispatch.
function build(verbs, requireFn) {
  const req = requireFn || require;
  const table = {};
  for (const verb of verbs) {
    if (table[verb] !== undefined) continue;   // distinct verbs only
    let mod;
    //  A name resolves from one of TWO trees: the mutating VERBS
    //  (verbs/<verb>/) — get/put/post/delete/patch — and the verbless VIEWS
    //  (views/<view>/) — the read-only projectors (ls/cat/diff/spot/…), which
    //  the loop dispatches by URI scheme exactly like a verb.  Try views/ then
    //  verbs/ (the names are disjoint); the be-relative scan (require.cpp)
    //  finds the shard nearest the requirer.
    try { mod = req("views/" + verb + "/" + verb + ".js"); }
    catch (e) {
      try { mod = req("verbs/" + verb + "/" + verb + ".js"); }
      catch (e2) { table[verb] = null; continue; }
    }
    const c = convention(mod);
    if (c == null) { table[verb] = null; continue; }
    table[verb] = c.how === "args" ? { jab: "args", fn: c.fn } : c.fn;
  }
  return table;
}

module.exports = { build: build, convention: convention };
