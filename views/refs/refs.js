//  refs.js — smoke extension (JS-029), JSQUE-002 handler form.  Reports the
//  repo's current branch + baseline sha.  Converted from a file-scope `main();`
//  one-shot to `module.exports = handle(row, ctx)`: args come from the ROW (the
//  worktree path in row.uri), not process.argv/io.cwd; output goes via ctx.out
//  (a no-op stub today; JSQUE-005's emit sink drops in).  No process.exit.
"use strict";

//  Sibling libs resolve via __dirname (require.cpp passes the module's own dir),
//  NOT process.argv[1] — under the resident loop argv[1] is loop.js, so the old
//  `here = process.argv[1]` idiom would scan the wrong dir (JSQUE-002).
const be = require(__dirname + "/../../core/discover.js");   // JSQUE-016: be.js -> core/
const wtlog = require(__dirname + "/../../shared/wtlog.js");
//  JAB-003: TRUE-hunk output via the shared columnar→hunk adapter (ctx.sink),
//  retiring the io.log fd-1 bypass for this view.
const hunkrows = require("../../shared/hunkrows.js");

//  handle(row, ctx): row.uri is the worktree path to inspect (empty -> the
//  loop's cwd via be.find()).  A trivial leaf verb: no fan-out, returns nothing.
module.exports = function handle(row, ctx) {
  const wt = (row && row.uri) ? row.uri : undefined;
  const repo = (ctx && ctx.repo) ? ctx.repo : be.find(wt);
  const log = wtlog.open(repo);

  const cur = log.curTip();
  const base = log.baselineTip();
  const bnd = log.boundaries();
  //  DIS-053: trunk/no-branch is the bare `?` sigil, never a literal
  //  `?trunk` — byte-match C `be head` (graf/LOG.c trunk label is `?`).
  const branch = cur.branch || "";

  //  JAB-003: emit the report as ONE TRUE hunk at the canonical `refs:` uri;
  //  each raw() line appends its own "\n" (retiring the io.log fd-1 bypass).
  if (ctx && ctx.sink) {
    const out = hunkrows(ctx.sink, "refs:");
    out.raw("project:  " + (repo.project || "(unnamed)"));
    out.raw("wt:       " + repo.wt);
    out.raw("store:    " + repo.storePath);
    out.raw("be:       " + repo.bePath);
    out.raw("branch:   ?" + branch);
    out.raw("cur:      " + (cur.sha || "(none)"));
    out.raw("baseline: " + (base.sha || "(none)"));
    out.raw("rows:     " + log.rows.length);
    out.raw("boundary: pd="    + (bnd.pd    == null ? "-" : ron.encode(bnd.pd))
                    + " patch=" + (bnd.patch == null ? "-" : ron.encode(bnd.patch)));
    out.done();
  }
};
