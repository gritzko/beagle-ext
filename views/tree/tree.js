//  views/tree/tree.js — the `tree:` read-only VIEW (JAB-008).  Resolve a URI to
//  a git tree and emit ONE row per entry in raw git-tree order:
//    `<mode6> <type6> <sha40>\t<name>[/]`
//  with a leading BARE `..` row first iff the URI path descends below the tree
//  root.  Pure JS over the libabc/libdog bindings: shared/store.js (object/ref
//  read + the descendPath path descender), core/resolve.js (the hex/short-sha
//  classifier), shared/wtlog.js (the empty-`?` cur-tip default), the URI binding
//  (the structured scheme/path/query/frag split).  NO dog binary, NO /proc.
//  Mirrors keeper/PROJ.c::KEEPProjTree (resolve → descend → drain → emit) +
//  KEEP.c::KEEPResolveTree (the `?branch`/`?<hex>`/`#<hex>`/empty resolution) +
//  WALK.c::KEEPTreeDescend (the `./path` segment walk).
//
//  OUTPUT CONTRACT (JAB-008): the rows are a FIXED-FORMAT byte block, not the
//  core/emit.js date/verb columns — so each line is pushed VERBATIM through the
//  emit sink's `out.raw(text)` (which renders a raw line unchanged in BOTH the
//  plain and the colour render, never columnised).  PLAIN is the bare row text;
//  COLOUR is the row hand-painted to match native `be tree: --color` (a leading
//  `tree:<path>` banner band width-filled to 200, each entry's mode/type/sha
//  prefix in the dim "tree-meta" SGR + the name in the violet "name" SGR, the
//  `..` row name-only in the name SGR).  The view OWNS its byte shape here
//  because the C HUNK binding's generic content-hunk render does NOT reproduce
//  the keeper projector's per-token theme (verified: an empty/`tree:`-uri hunk
//  renders verbatim-with-framing, NOT the gray-rows/violet-name/200-fill block).
//
//  Error edges (NO stdout rows + a THROW → nonzero exit, matching native's
//  PROJFAIL/PROJNONE/KEEPFAIL stderr + nonzero — the exact dog exit code/stderr
//  text is dog-internal and not reproduced; stdout parity is exact):
//    file-as-tree / non-tree leaf / non-tree object   -> throw "TREEFAIL"
//    missing path segment                              -> throw "TREENONE"
//    bad ref / unresolvable sha                        -> throw "TREENONE"

"use strict";

const be     = require("../../core/discover.js");
const store  = require("../../shared/store.js");
const wtlog  = require("../../shared/wtlog.js");
const resolve = require("../../core/resolve.js");

//  mode-class -> the row's `<mode6> <type-padded-to-6>` prefix (proj_tree_mode_
//  type :271/:274).  The type column is 6 wide ("tree "/"blob "/"commit"), then
//  proj :362 adds a single ' ' before the sha — folded into the constant here so
//  the row build is `<this><sha40>\t<name>`.
const MODE_PREFIX = {
  tree:   "040000 tree   ",   // dir       (+ trailing '/' on the name)
  blob:   "100644 blob   ",   // regular file
  exe:    "100755 blob   ",   // executable
  link:   "120000 blob   ",   // symlink
  commit: "160000 commit ",   // gitlink / submodule (type col 6 → 0 pad)
};

//  --- colour SGR (native `be tree: --color`, verified byte-for-byte) --------
//  The meta prefix (mode/type/sha) paints in the dim grey "90"; the entry name
//  (and the bare `..`) in the violet "38;5;56".  The banner band opens with the
//  pale-yellow `38;5;0;48;5;230` and width-FILLS the `tree:<path>` text to 200
//  columns (native KEEPProjTree's banner — the only width-200 fill in tree:).
const SGR = "\x1b[";
const META_OPEN  = SGR + "90m";
const NAME_OPEN  = SGR + "38;5;56m";
const RESET      = SGR + "0m";
const BANNER_OPEN = SGR + "38;5;0;48;5;230m";
const BANNER_WIDTH = 200;

//  Pad a banner's text to BANNER_WIDTH columns with spaces (the native fill).
function bannerLine(text) {
  let t = text;
  while (t.length < BANNER_WIDTH) t += " ";
  return BANNER_OPEN + t + RESET;
}

//  Build ONE entry row's bytes in the active mode.  `name` already carries the
//  trailing '/' for a dir.
//    plain:  <prefix><sha40>\t<name>
//    color:  <META>‹prefix sha40 \t›<NAME>‹name›<RESET>
function entryRow(prefix, sha, name, color) {
  const meta = prefix + sha + "\t";
  if (!color) return meta + name;
  return META_OPEN + meta + NAME_OPEN + name + RESET;
}

//  The bare `..` row: plain `..`; colour name-only in the violet name SGR.
function dotdotRow(color) {
  return color ? (NAME_OPEN + ".." + RESET) : "..";
}

//  Resolve the URI's root TREE sha (KEEPResolveTree).  `frag`/`query` may pin a
//  sha (commit→tree deref, or a tree sha used directly) or a branch ref; an
//  empty query+frag defaults to the cur tip (HOME.cur_sha).  Returns the tree
//  sha, or null when the ref/sha is unresolvable (→ TREENONE at the caller).
function resolveRootTree(k, wtl, query, frag) {
  //  A hex (full sha or 6..40 short prefix) in EITHER slot is a sha: native
  //  promotes `?<hex>`→fragment (KEEPProjDispatch :664) and resolves it as a
  //  tree, or a commit deref'd to its tree.  Fragment wins when both are set.
  const hex = resolve.isHexish(frag) ? frag
            : resolve.isHexish(query) ? query
            : null;
  if (hex) {
    const full = resolve.resolveHex(k, hex);
    if (!full) return null;
    return commitOrTree(k, full);
  }
  //  A non-hex query is a branch/ref name: resolve → commit → its tree.
  if (query) {
    const sha = k.resolveRef(query);
    if (!sha) return null;
    return commitOrTree(k, sha);
  }
  //  Empty `?` (+ empty `#`): the cur tip (HOME.cur_sha).
  const cur = wtl.curTip();
  if (!cur || !cur.sha) return null;
  return commitOrTree(k, cur.sha);
}

//  A resolved object id → its TREE sha: a commit deref's to its tree, a tree is
//  used directly.  A blob/other → null (a non-tree object → TREEFAIL caller).
function commitOrTree(k, sha) {
  const obj = k.getObject(sha);
  if (!obj) return null;
  if (obj.type === "tree") return sha;
  if (obj.type === "commit") return k.commitTree(sha) || null;
  return null;                                  // a blob/tag is not a tree
}

module.exports = function handle(row, ctx) {
  const out  = ctx && ctx.out;
  const mode = (ctx && ctx.mode) || "plain";
  const color = mode === "color";
  const repo = (ctx && ctx.repo) || be.find();
  if (!repo) return;

  //  The whole projector URI rides ctx.args (a fragment-only URI lowers to a "."
  //  placeholder in the queue row), exactly like cat:/spot:.  Strip the
  //  `tree:` scheme so the URI binding sees the bare body.
  const rawArgs = (ctx && ctx.args && ctx.args.length) ? ctx.args : [row.uri];
  let first = String(rawArgs[0] || "");
  if (first.indexOf("tree:") === 0) first = first.slice("tree:".length);
  const u = new URI(first);
  const path  = u.path || "";
  const query = u.query || "";
  const frag  = u.fragment || "";

  const k   = store.open(repo.storePath, repo.project);
  const wtl = wtlog.open(repo);

  //  1) resolve the root tree (ref/sha/cur-tip).
  const rootTree = resolveRootTree(k, wtl, query, frag);
  if (!rootTree) throw "TREENONE";              // bad ref / unresolvable sha

  //  2) descend the `./path` segments (the descendPath anchor).  "."/"./"/empty
  //  collapse to the root; below-root ⇒ a leading `..` row.  A missing segment
  //  → TREENONE; a non-tree LEAF (file-as-tree) → TREEFAIL.
  const segs = path.split("/").filter(function (s) { return s !== "" && s !== "."; });
  const leaf = k.descendPath(rootTree, segs);
  if (!leaf) {
    //  descendPath returns undefined for BOTH a missing segment (PROJNONE) and a
    //  can't-descend-through-non-tree mid-path (PROJFAIL).  Native distinguishes
    //  them, but both yield 0 stdout rows + nonzero — TREENONE covers the stdout
    //  parity (the dog exit code split is not reproduced; see header).
    throw "TREENONE";
  }
  if (leaf.kind !== "tree") throw "TREEFAIL";   // file-as-tree / non-tree leaf

  const belowRoot = segs.length > 0;
  const entries = k.readTree(leaf.sha);
  if (!entries) throw "TREEFAIL";               // leaf sha not a readable tree

  //  3) emit.  COLOUR leads with the banner band; PLAIN has no banner.  The
  //  banner text is `tree:` + the NORMALISED path ("."/"./"-collapsed) + a
  //  `?<rev>` suffix when a sha/ref was given — native promotes `#<hex>` to the
  //  `?<hex>` query form in the banner and keeps the VERBATIM (un-expanded)
  //  value (`?054a0d44`, `?heads/feat`).  No suffix for a pure-path/empty URI.
  if (!out) return;
  if (color) {
    const rev = query || frag;                  // frag (#hex) shows as ?<hex>
    out.raw(bannerLine("tree:" + segs.join("/") + (rev ? "?" + rev : "")));
  }
  if (belowRoot) out.raw(dotdotRow(color));     // the bare `..`, never at root
  for (const e of entries) {
    const kind = store.modeKind(e.mode);
    const prefix = MODE_PREFIX[kind] || MODE_PREFIX.blob;
    const name = kind === "tree" ? (e.name + "/") : e.name;   // trailing '/' on dirs
    out.raw(entryRow(prefix, e.sha, name, color));
  }
  //  Read-only leaf: no fan-out.
};
