//  ulog.js — the single ULOG read+write module shared by bin/*.js (JS-043,
//  JS-048).  Pure JS over the JABC ULOG family (`abc.mmap("ULOG", path, "r")`
//  for reads; `abc.ram("ULOG", …)` + io leaves for the crash-safe write).
//  libabc+libdog ONLY — no keeper/sniff binding; we append the ULOG file
//  ourselves.  Consolidates the watermark-fix-up drain incantation that was
//  open-coded ~6× (wtlog.js, keeper.js, be.js, get.js, ingest.js) AND the
//  crash-safe, monotonic ULOG writer (folded in from wtwrite.js).
//
//  An RO-mapped ULOG opens with watermark 0 (the write head); the read
//  cursor (next/rewind) treats watermark as the DATA length, so every
//  reader must first set watermark = byteLength to expose the whole file
//  (the JS-029 finding).  `each`/`drain` bottle that up:
//
//  READERS
//    each(path, cb)  open RO, expose all rows, call cb(log) per row in
//                    frame (rule #4 — no held native cursor); a failed
//                    open is a silent no-op (matches every former site's
//                    try/catch).  The caller pulls log.time/verb/uri.
//    drain(path)  →  [{ ts, ron, verb, uri:URI }]  the rich row list
//                    (the wtlog.js / keeper.js drainUlog shape).
//
//  WRITERS (the wtlog/ULOG WRITE substrate; the write twin of the readers)
//    write(path, rows)      build a fresh ULOG from `rows` and write it
//                           CRASH-SAFELY (temp file + io.rename); each row
//                           is { verb, uri, ts? } — an explicit ts is honoured.
//    append(bePath, rows)   read the existing ULOG, sample a ts STRICTLY
//                           greater than its tail (SNIFFAtNow's monotonic
//                           bump; a gross-backwards clock throws CLOCKBAD),
//                           feed the new rows with explicit increasing ts,
//                           and rewrite via write().
//    _stage(path, rows)     the crash-safe half: write a temp sibling and
//                           return its path WITHOUT renaming (caller renames).
//
//  Row shapes are the caller's (sniff/AT.md): wt rows `<verb> ?<branch>#<sha>`,
//  refs rows `<verb> ?<key>#<sha>`.  The write side only owns ts assignment +
//  the durable write.

"use strict";

//  --- READERS ------------------------------------------------------------

function each(path, cb) {
  let log;
  try { log = abc.mmap("ULOG", path, "r"); } catch (e) { return; }
  log.buffer.watermark = log.byteLength;     // map is full; expose all rows
  log.rewind();
  while (log.next()) cb(log);
}

function drain(path) {
  const rows = [];
  each(path, function (log) {
    rows.push({ ts: log.time, ron: ron.encode(log.time),
                verb: log.verb, uri: new URI(log.uri) });
  });
  return rows;
}

//  --- WRITERS ------------------------------------------------------------

//  CLOCKBAD: the system clock is grossly (> 30 s) behind the ULOG tail — an
//  NTP step / DST / suspend-resume, not the per-call self-bump.  Mirrors
//  sniff/AT.c::SNIFFCheckClock.  10-char ron60 code, thrown as a JS error.
const CLOCKBAD = "CLOCKBAD";
const SKEW_MS_MAX = 30000;

//  Decode a ron60 (BigInt) to absolute ms for skew math.  Layout (abc/RON.c
//  RONToTime): 10 RON64 6-bit digits, MS→LS = YY M DD hh mm ss lll.  We use
//  Date.UTC so the (cancelling) tz/DST offset doesn't enter a DELTA.
function ronToMs(r) {
  r = BigInt(r);
  const d = (k) => Number((r >> BigInt(k * 6)) & 63n);
  const yy = d(9) * 10 + d(8);
  const mon = d(7), day = d(6) * 10 + d(5);
  const hh = d(4), mm = d(3), ss = d(2);
  const ms = d(1) * 64 + d(0);
  return Date.UTC(2000 + yy, mon - 1, day, hh, mm, ss, ms);
}

//  DIS-057: step a ron60 by `k` MILLISECONDS, carrying/borrowing through the
//  PACKED calendar fields so the result is always a VALID ron60 (ms 0-999).
//  A raw BigInt `r + k` corrupts the low 12-bit ms field (ms>=1000 → RONToTime
//  rejects → FILESetMtime stamps epoch-0), so the patch stamp band MUST step
//  in ms, not in raw BigInt.  Pure inverse of the RON packing — no tz, no Date.
function ronStepMs(r, k) {
  r = BigInt(r);
  const d = (i) => Number((r >> BigInt(i * 6)) & 63n);
  const yy = d(9) * 10 + d(8), mon = d(7);
  let day = d(6) * 10 + d(5), hh = d(4), mm = d(3), ss = d(2), ms = d(1) * 64 + d(0);
  let t = ((((day * 24 + hh) * 60 + mm) * 60 + ss) * 1000) + ms + (k | 0);
  ms = ((t % 1000) + 1000) % 1000; t = (t - ms) / 1000;
  ss = ((t % 60) + 60) % 60; t = (t - ss) / 60;
  mm = ((t % 60) + 60) % 60; t = (t - mm) / 60;
  hh = ((t % 24) + 24) % 24; t = (t - hh) / 24;
  day = t;                                            // remaining whole days
  let o = 0n; const set = (i, v) => { o |= (BigInt(v) & 63n) << BigInt(i * 6); };
  set(9, Math.floor(yy / 10)); set(8, yy % 10); set(7, mon);
  set(6, Math.floor(day / 10)); set(5, day % 10);
  set(4, hh); set(3, mm); set(2, ss);
  set(1, Math.floor(ms / 64)); set(0, ms % 64);
  return o;
}

//  SNIFFAtNow port: a fresh stamp strictly greater than `tail`.  RONNow()
//  is the wall clock; bump to tail+1 when it has not advanced past the tail
//  (a burst within one ms, or a future-stamped tail).  A gross-backwards
//  wall clock (> 30 s behind tail) is a clock fault → CLOCKBAD.
function nowAfter(tail) {
  let now = ron.now();
  if (tail != null && tail > 0n) {
    if (now < tail && (ronToMs(tail) - ronToMs(now)) > SKEW_MS_MAX)
      throw CLOCKBAD + ": system clock is before the latest wtlog row";
    if (now <= tail) now = tail + 1n;
  }
  return now;
}

//  Build the DATA region of a fresh ULOG over `rows` in RAM.  Each row's
//  explicit ts is fed verbatim; the container's own monotonic guard keeps
//  same-ms rows strictly increasing.  Returns a Uint8Array (its own copy).
function buildUlog(rows) {
  const log = abc.ram("ULOG", Math.max(1 << 16, rows.length * 256));
  for (const r of rows) log.feed(r.verb, r.uri, r.ts);
  const n = Number(log.buffer.watermark);
  return log.subarray(0, n).slice();
}

//  Crash-safe stage: write the bytes to a temp sibling of `path` and return
//  the temp path.  The caller commits with io.rename (atomic within a FS);
//  a crash before that leaves the OLD `path` byte-intact (no resize-in-place).
function _stage(path, rows) {
  const bytes = buildUlog(rows);
  const tmp = path + ".tmp." + (ron.now()).toString(36) +
              "." + (Math.random() * 1e9 | 0);
  const fd = io.open(tmp, "c");
  try {
    const b = io.buf(bytes.length + 8);
    b.feed(bytes);
    io.writeAll(fd, b);
    io.sync(fd);
  } finally { io.close(fd); }
  return tmp;
}

//  Write a fresh ULOG from `rows` over `path`, crash-safely.
function write(path, rows) {
  const tmp = _stage(path, rows);
  try { io.rename(tmp, path); }
  catch (e) { try { io.unlink(tmp); } catch (e2) {} throw e; }
}

//  Append `rows` to the EXISTING ULOG at `bePath`: drain the old rows
//  (preserving their original ts), sample a monotonic new ts strictly past
//  the tail, assign consecutive increasing ts to the new rows, then rewrite.
function append(bePath, rows) {
  const old = [];
  each(bePath, function (log) {
    old.push({ verb: log.verb, uri: log.uri, ts: log.time });
  });
  const tail = old.length ? old[old.length - 1].ts : 0n;
  let ts = nowAfter(tail);
  const fresh = rows.map(function (r) {
    const row = { verb: r.verb, uri: r.uri, ts: (r.ts != null ? BigInt(r.ts) : ts) };
    ts = (row.ts >= ts ? row.ts : ts) + 1n;     // next row strictly later
    return row;
  });
  write(bePath, old.concat(fresh));
}

//  --- STREAMING TAIL-APPEND (JSQUE-003) ----------------------------------

//  Per-row IDLE headroom for a booked sparse file (verb + 2KB URI + ts + nl).
const ROW_CAP = 2048;

//  Read the existing ULOG bytes (empty if absent), then open a BOOKED sparse
//  "c" file (abc.book truncates on open, so snapshot first) sized to the old
//  bytes + `growRows` of headroom, copy the survivors back in, and position
//  the feed head past them.  Returns { c, tail } — ONE container whose read
//  cursor and feed head are the same instance (JSQUE-003).  NOT an "rw" map:
//  an "rw" map is exact-length, zero IDLE, and SIGBUSes when fed past .end.
function _book(path, growRows) {
  let old = new Uint8Array(0);
  try { old = abc.mmap("ULOG", path, "r").slice(); } catch (e) {}
  const cap = old.length + Math.max(1, growRows | 0) * ROW_CAP;
  const c = abc.book("ULOG", path, cap);     // sparse file, all IDLE, wm 0
  if (old.length) {
    c.set(old, 0);                           // restore survivors into DATA
    c.buffer.watermark = old.length;
  }
  //  seed monotonic guard + tail from the survivors' last row.
  let tail = 0n;
  if (old.length) { c.rewind(); while (c.next()) tail = c.time; c._lastTs = tail; }
  return { c: c, tail: tail };
}

//  Trim the booked file to its live write head and drop the mapping pin.
function _trim(c) { abc.close(c); }

//  JSQUE-020: appendInPlace + feedRows retired with core/job.js (their sole
//  callers).  _book/_trim stay as the crash-safe booked-file primitives.

//  --- REVERSE SEEK WRAPPERS (JSQUE-003; JSQUE-020 dropped seekBack) --------

//  Expose a RO ULOG with its whole length visible, run `fn(log)`, close.  The
//  cursor is held only inside the frame (rule #4).
function _withRO(path, fn) {
  let log;
  try { log = abc.mmap("ULOG", path, "r"); } catch (e) { return undefined; }
  log.buffer.watermark = log.byteLength;
  return fn(log);
}

//  Read the row currently under a positioned cursor into a plain object.
function _row(log) {
  return { offset: log.offset, ts: log.time, verb: log.verb, uri: log.uri };
}

//  prevRow(path, offset): the row immediately preceding `offset` (its start is
//  before `offset`), or undefined at the head.  A forward next() from 0 stops
//  at the last row that starts strictly before `offset`.
function prevRow(path, offset) {
  return _withRO(path, function (log) {
    if (offset == null || offset <= 0) return undefined;
    let prev;
    log.rewind();
    while (log.next() && log.offset < offset) prev = _row(log);
    return prev;
  });
}

module.exports = { each: each, drain: drain,
                   write: write, append: append, _stage: _stage,
                   _book: _book, _trim: _trim,
                   prevRow: prevRow,
                   nowAfter: nowAfter, buildUlog: buildUlog,
                   ronToMs: ronToMs, ronStepMs: ronStepMs, CLOCKBAD: CLOCKBAD };
