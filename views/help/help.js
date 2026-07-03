//  views/help/help.js — BRO-007: the `help:` read-only VIEW.  Emits ONE content
//  HUNK listing (a) the jab pager SHORTCUTS and (b) the URI SCHEMES typeable at
//  the `:` address bar.  Auto-dispatched by core/registry.js (scheme `help` →
//  views/help/help.js), so `jab help:` works outside the pager too AND the
//  pager's `h` key (which runs the `help:` spell via driveSpell→pushView) pushes
//  it like any other view — no bespoke pager "help mode".  Pure JS: one
//  ctx.sink.feed(uri, body, toks, verb, ts), the SAME path the log: view uses.
//
//  ANTI-DRIFT: the SHORTCUTS half is imported from views/bro/pager.js (its
//  SHORTCUTS export IS the live `_keyScroll` key map) so the displayed keys can
//  never diverge from the real bindings.  The URI-SCHEME half is a curated
//  scheme→blurb table, cross-checked against the be/views/ dirs.
"use strict";

const pager = require("../bro/pager.js");

//  tok32 (dog/tok/TOK.h): [31..27] tag (A+n), [23..0] end byte offset; token
//  i's start = token i-1's end.  D = comment/grey (section heads + blurbs),
//  L = hashlet/cyan (the key / scheme token), S = default (the gutter).
const TAG_L = 11, TAG_D = 3, TAG_S = 18;
function tok(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }

//  The URI SCHEMES typeable at `:` — a curated scheme→one-line table.  CROSS-
//  CHECKED against be/views/ (blob cat commit diff grep log ls lsr refs regex
//  sha1 size spot status tree type); `bro`/`help` are the viewers themselves so
//  they are not listed as navigation targets.  Keep this list in sync with the
//  registry's view dirs.
const SCHEMES = [
  ["commit:<rev>", "show one commit (message + changed files)"],
  ["diff:<path>?<rev>", "diff a path against a revision"],
  ["log:", "commit history, newest first"],
  ["tree:<path>", "list a tree (a directory in a revision)"],
  ["blob:<path>", "raw bytes of a file object"],
  ["cat:<file>", "a file's bytes, syntax-highlighted"],
  ["status:", "the working-tree status"],
  ["ls:<dir>", "list a working-tree directory"],
  ["lsr:<dir>", "list a directory recursively"],
  ["refs:", "branch + baseline refs"],
  ["grep:#<word>", "search the tree for a word"],
  ["regex:<pat>", "search the tree by regex"],
  ["spot:<word>", "locate a symbol's definition"],
  ["sha1:<path>", "the git sha1 of an object"],
  ["size:<path>", "the inflated byte size of an object"],
  ["type:<path>", "the git object type"],
];

//  Push one UTF-8 segment, advancing `off` by its BYTE length (NOT the JS string
//  length — a multibyte char like the em-dash would mis-count the tok32 end and
//  blow the body buffer) and closing a tok32 span of `tag` at the new offset.
function seg(text, tag, off, parts, spans) {
  const bytes = utf8.Encode(text);
  parts.push(bytes);
  off += bytes.length; spans.push([tag, off]);
  return off;
}

//  Two padded columns (`key   action`) so the rows read as a table; the left
//  column width is the widest key/scheme so the blurbs align.  Returns the body
//  bytes + per-token tok32 spans (L over the key, D over the blurb).
function table(pairs, off, parts, spans) {
  let w = 0;
  for (const p of pairs) if (p[0].length > w) w = p[0].length;
  for (const p of pairs) {
    off = seg("  ", TAG_S, off, parts, spans);
    off = seg(p[0], TAG_L, off, parts, spans);
    off = seg(" ".repeat(w - p[0].length + 2) + p[1] + "\n", TAG_D, off, parts, spans);
  }
  return off;
}

//  A grey section heading row (`<text>\n`) tagged D.
function heading(text, off, parts, spans) {
  return seg(text + "\n", TAG_D, off, parts, spans);
}

function concat(parts, total) {
  const all = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

//  Build the ONE static help HUNK and feed it to `sink` (the same edge the log:
//  view feeds — rendered plain/color/tlv by the loop edge).  No fan-out, no
//  store/wt access — pure static content, ignores any args.
function emit(sink) {
  if (!sink) return;

  const parts = [], spans = [];
  let off = 0;
  off = heading("PAGER SHORTCUTS", off, parts, spans);
  off = table(pager.SHORTCUTS, off, parts, spans);
  off = heading("", off, parts, spans);
  off = heading("URI SCHEMES  (type at the `:` address bar)", off, parts, spans);
  off = table(SCHEMES, off, parts, spans);

  const body = concat(parts, off);
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok(spans[i][0], spans[i][1]);

  //  Banner uri "help:" (no verb word), the body, the per-token tok32 spans.
  sink.feed("help:", body, toks, "", 0n);
}

//  JAB-004: PLAIN verb (`.jab="args"`) — reads the shared sink off global `be`;
//  args are ignored (static content).
function help() {
  emit((typeof be !== "undefined" && be) ? be.sink : null);
}
help.jab = "args";
module.exports = help;
module.exports.SCHEMES = SCHEMES;
