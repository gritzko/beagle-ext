//  weave.js — grow-on-"out full" retry around the WEAVE/HUNK fold bindings
//  (DIFF-010).  The C WEAVE builders (fold/merge/emit*) write into a fixed-size
//  JS buffer and throw "...failed (out full?)" / "out full" when it overflows.
//  A direct caller (diff.js, patch.js) used a fixed cap, so a large fold threw.
//  This mirrors core/loop.js:128-142 (the HUNK sink's grow-on-full replay) and
//  the [JS-055] grow-on-NOROOM pattern: alloc a buffer, run the op, and on a
//  "full" throw DOUBLE the cap (plus a content lower-bound) and retry.

"use strict";

const MAX_TRIES = 40;   // 1<<18 doubled 40x ⇒ way past any real blob; a guard

//  growOnFull(make, op, hint): allocate a buffer via make(cap), run op(buf), and
//  on a "full" throw double cap (≥ hint) and retry.  `make` is e.g.
//  (cap) => abc.ram("WEAVE", cap); `op` does the build and returns its result
//  (often the buffer).  Only a "full" error grows — anything else re-throws.
function growOnFull(make, op, cap, hint) {
  let c = cap || (1 << 18);
  for (let t = 0; t < MAX_TRIES; t++) {
    const buf = make(c);
    try { return op(buf); }
    catch (e) {
      if (!("" + e).includes("full")) throw e;   // only grow on `out full`
      c = c * 2;
      if (hint && c < hint) c = hint;
    }
  }
  throw "weave: grow-on-full retry exhausted";
}

//  fold(base, blob, ext, hash): a WEAVENext fold that grows its target WEAVE
//  buffer on overflow.  Returns the fresh WEAVE container (already rewound).
//  The cap lower-bound is the blob length (a fold blob can't shrink below it).
function fold(base, blob, ext, hash) {
  const n = blob ? blob.length : 0;
  return growOnFull(function (cap) { return abc.ram("WEAVE", cap); },
    function (w) { w.fold(base, blob, ext, hash); return w; }, 1 << 18, n + 256);
}

//  merge(a, b, hash): a WEAVEMerge that grows its target WEAVE buffer.  The cap
//  lower-bound is the sum of the two inputs' live byte sizes.
function merge(a, b, hash) {
  const n = (a.buffer.watermark | 0) + (b.buffer.watermark | 0);
  return growOnFull(function (cap) { return abc.ram("WEAVE", cap); },
    function (w) { w.merge(a, b, hash); return w; }, 1 << 18, n + 256);
}

module.exports = { growOnFull: growOnFull, fold: fold, merge: merge };
