//  verbs/ls/ls.js — the `ls:` / `lsr:` worktree-listing view (JAB-018/019).
//  ONE handler, the VERB is the parameter: `ls` lists ONE directory as ONE
//  hunk; `lsr` is the SAME listing plus a fan-out — it enqueues an `lsr:<child>`
//  row per immediate subdir AND per mounted submodule, so the resident loop's
//  job queue (core/job.js) drives the recursion BFS, ONE HUNK PER DIRECTORY,
//  crossing store boundaries into submodules.  verbs/lsr/lsr.js is a one-line
//  re-export of this module — same code, `row.verb` selects recurse.
//
//  libabc+libdog ONLY (be.find / wtlog / store / classify): NO dog spawned, NO
//  sniff, NO /proc.  Each per-directory hunk is built from classify.classifyDir
//  — the O(dir) listing of the scope's IMMEDIATE entries: each immediate file
//  is its status row, each immediate subdir / mount is ONE BLANK-DATED `dir
//  <name>/` row (native ls: dates no dir row, so nothing under it is scanned —
//  the whole reason ls: now costs O(dir), not O(repo)).  Entry names render
//  RELATIVE to the scope dir; the banner names the scope RELATIVE to the top wt
//  (`ls:`, `ls:sub/`, `lsr:chsub/lib/`).  A scope INSIDE a submodule
//  re-discovers that shard via be.find, so `jab ls <path-in-sub>/` lists it.
"use strict";

const be       = require("../../core/discover.js");
const wtlog    = require("../../shared/wtlog.js");
const store    = require("../../shared/store.js");
const classify = require("../../shared/classify.js");
const join     = require("../../shared/util/path.js").join;
const render   = require("../../view/render.js");
const theme    = require("../../view/theme.js");

//  BRO-006: emit a content HUNK (text + tok32) per dir, mirroring sniff/LS.c
//  htbl_emit — each row carries a hidden `U`-tagged nav URI (`cat:<path>` for a
//  file/move-dst, `ls:<sub>` for a dir) so the bro pager's _uriAt makes a click
//  open the entry.  Row layout = `<7-date> <3-verb> <path>[ -> dst]<navuri>\n`,
//  toks L(date) S(sep) <verb> S(sep) F(path) U(navuri) W(\n).  The nav URI rides
//  BEFORE the '\n' (not after, as C) so the body ENDS in a visible '\n' — that
//  keeps HUNKu8sFeedText's plain render byte-identical to native ls (no extra
//  ensure-final '\n').  tag 'U' = 20; U bytes hidden in plain/color, click-only.
function tok(tag, end) { return ((tag & 0x1f) << 27) | (end & 0xffffff); }
function tagCode(letter) { return letter.charCodeAt(0) - 65; }

//  Append ONE entry row's bytes + tok32 spans to the accumulators.  `verb` is
//  the bucket name (eq/mod/dir…); `nav` is the hidden click-target URI.  Plain
//  bytes (date/verb/path columns) are byte-identical to the columnar emit; the
//  nav URI bytes ride hidden under a 'U' tok (skipped by plain/color renderers).
function appendRow(textParts, spans, off, verb, path, navUri, ts) {
  const date = render.dateCol(ts);                 // 7-col date; ts 0n → 7 spaces
  const vcol = render.verbCol(verb);               // 3-col verb
  const cols = date + " " + vcol + " " + path;     // visible columns (no '\n' yet)
  const colsB = utf8.Encode(cols);
  const uriB  = utf8.Encode(navUri);
  const nlB   = utf8.Encode("\n");
  textParts.push(colsB); textParts.push(uriB); textParts.push(nlB);
  const eDate = utf8.Encode(date).length;          // [.,7)   date
  const eSep1 = eDate + 1;                          // sep " "
  const eVerb = eSep1 + utf8.Encode(vcol).length;   // 3-col verb
  const eSep2 = eVerb + 1;                          // sep " "
  const ePath = colsB.length;                      // end of visible path
  const eUri  = ePath + uriB.length;               // hidden nav URI
  const eNL   = eUri + nlB.length;                 // visible '\n'
  const vtag  = theme.VERB_SLOT[verb] || "S";
  spans.push([tagCode("L"), off + eDate]);          // date
  spans.push([tagCode("S"), off + eSep1]);          // sep
  spans.push([tagCode(vtag), off + eVerb]);         // verb (palette slot)
  spans.push([tagCode("S"), off + eSep2]);          // sep
  spans.push([tagCode("F"), off + ePath]);          // visible path
  spans.push([tagCode("U"), off + eUri]);           // hidden nav URI (click target)
  spans.push([tagCode("S"), off + eNL]);            // the visible '\n'
  return colsB.length + uriB.length + nlB.length;
}

//  Build + feed ONE content hunk for a directory's `entries` (sorted) to the
//  HUNK `sink`.  navPfx is the scope relative to the top wt (so the hidden nav
//  URI is a full-path spell the pager can re-open).  A dir → `ls:<sub>/`, a
//  move → `cat:<dst>`, a plain file → `cat:<path>`.  Exposed for the repro test.
function emitHunk(sink, banner, navPfx, entries) {
  const textParts = [];
  const spans = [];
  let off = 0;
  for (const e of entries) {
    if (e.dir) {
      const nav = "ls:" + navPfx + e.name + "/";
      off += appendRow(textParts, spans, off, "dir", e.name + "/", nav, 0n);
    } else {
      const dst = e.verb === "mov" && e.text.indexOf(" -> ") >= 0
                ? e.text.slice(e.text.indexOf(" -> ") + 4) : null;
      const nav = "cat:" + navPfx + (dst || e.key);
      off += appendRow(textParts, spans, off, e.verb, e.text, nav, e.ts);
    }
  }
  const body = new Uint8Array(off);
  let p = 0;
  for (const part of textParts) { body.set(part, p); p += part.length; }
  const toks = new Uint32Array(spans.length);
  for (let i = 0; i < spans.length; i++) toks[i] = tok(spans[i][0], spans[i][1]);
  sink.feed(banner, body, toks, "", 0n);
}

//  Strip trailing slashes from an absolute dir (keep a lone "/").
function noSlash(p) { while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1); return p; }

//  `abs` relative to `base`, in DIR form (trailing "/"); "" when equal or not
//  under base.  Drives both the classifyDir scope prefix (base = owning repo
//  wt) and the banner prefix (base = top wt).
function relDir(base, abs) {
  base = noSlash(base); abs = noSlash(abs);
  if (abs === base) return "";
  const pfx = base + "/";
  return abs.indexOf(pfx) === 0 ? abs.slice(pfx.length) + "/" : "";
}

//  The store + wtlog readers for a repo, memoised on ctx so an `lsr` run opens
//  each shard (and builds its pack index) ONCE, reused across every per-dir
//  hunk of that repo — the cross-dir saving the old whole-repo classify cache
//  gave, without the whole-repo classify.
function repoReaders(ctx, repo) {
  const cache = ctx._lsReaders || (ctx._lsReaders = {});
  if (cache[repo.wt]) return cache[repo.wt];
  return (cache[repo.wt] = { log: wtlog.open(repo),
                             k: store.open(repo.storePath, repo.project) });
}

module.exports = function handle(row, ctx) {
  const recurse = row.verb === "lsr";
  const out     = ctx && ctx.out;
  const sink    = ctx && ctx.sink;
  //  BRO-006: the U-target content hunk feeds the bro pager (color/TTY) AND the
  //  --tlv wire (byte-parity with native `be ls: --tlv`, which carries the same
  //  content hunk + U toks).  PLAIN stays the columnar `out` render: the loop's
  //  non-TTY plain dump runs HUNKu8sFeedText, which lacks ls's htbl_trim, so the
  //  content hunk would gain a trailing blank vs native ls --plain.  Gate on
  //  mode: feed the sink (with U) for color/tlv, else the columnar `out`.
  const wantU   = sink && (ctx && ctx.mode) !== "plain";
  const topWt   = (ctx && ctx.repo && ctx.repo.wt) || ".";

  //  Resolve the scope to an ABSOLUTE dir.  The seed row carries "." (the cwd
  //  placeholder → the top wt), a wt-relative path (`sub/`), or — for an
  //  enqueued child / sub-wt — an absolute path.
  let absScope;
  if (!row.uri || row.uri === ".") absScope = topWt;
  else if (row.uri[0] === "/")     absScope = row.uri;
  else                             absScope = join(topWt, row.uri);
  absScope = noSlash(absScope);

  //  The OWNING repo of the scope dir — be.find re-discovers a submodule's
  //  shard when the scope is inside a mount (the cross-store seam), else the
  //  top repo.  A path anchoring nowhere falls back to the top repo.
  let repo;
  try { repo = be.find(absScope); } catch (e) { repo = (ctx && ctx.repo) || null; }
  if (!repo) return;

  const scopePfx = relDir(repo.wt, absScope);               // rel to OWNING wt
  const navPfx   = relDir(topWt, absScope);                 // rel to TOP wt
  const banner   = row.verb + ":" + navPfx;                  // the hunk URI
  const rd        = repoReaders(ctx, repo);
  const res       = classify.classifyDir(repo, rd.log, rd.k, scopePfx);

  //  Merge files + dirs into ONE lex-ordered entry list.  Sort key: a file by
  //  its name, a dir by `<name>/` — so a file `deep.txt` sorts before a dir
  //  `deep/`, exactly as native ls: orders the full paths.  A dir row's date is
  //  BLANK (ts 0n): native ls: dates no directory, and a recursive newest-mtime
  //  was never asked for (computing it was the whole O(repo) cost).
  const entries = [];
  for (const f of res.files) {
    const text = f.bucket === "mov" && f.dst ? f.name + " -> " + f.dst : f.name;
    entries.push({ key: f.name, dir: false, text: text, verb: f.bucket, ts: f.ts });
  }
  for (const name of res.dirs)
    entries.push({ key: name + "/", dir: true, name: name });
  entries.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });

  //  BRO-006: color/tlv emit ONE content HUNK (text + tok32) with a hidden `U`
  //  click-target per row — mirroring sniff/LS.c.  PLAIN keeps the byte-identical
  //  columnar `out` render (the loop's plain dump lacks ls's htbl_trim).
  if (wantU) emitHunk(sink, banner, navPfx, entries);
  else if (out) {
    out.raw(banner);
    for (const e of entries)
      if (e.dir) out.row(e.name + "/", "dir", 0n);
      else       out.row(e.text, e.verb, e.ts);
  }

  //  lsr: fan out — one `lsr:<child>` row per immediate subdir / mount, in lex
  //  order (BFS via the FIFO queue).  ls: is a leaf (no enqueue).
  if (recurse) {
    const enqueue = [];
    for (const e of entries) if (e.dir)
      enqueue.push({ verb: row.verb, uri: join(absScope, e.name) });
    if (enqueue.length) return { enqueue: enqueue };
  }
};

//  BRO-006: expose the U-target hunk builders for the repro test (the dog/HUNK
//  tok-build model — same idea as log.js's exported tok()/appendRow).
module.exports.tok = tok;
module.exports.appendRow = appendRow;
module.exports.emitHunk = emitHunk;
