//  shared/lastcommit.js — LIST-001: the bounded first-touch history walk that
//  the `list:` view fuses onto its wt listing.  Walk tip→first-parent newest-
//  first; per commit diff its tree vs the (mainline) parent via changedpaths.
//  changedTrees, map each changed leaf to the IMMEDIATE scope entry it lives
//  under (first path segment), and attribute an as-yet-unseen entry that commit
//  (the NEWEST commit touching it, since we walk newest-first).  A dir entry is
//  attributed the first commit touching ANYTHING beneath it.  Halt when every
//  entry is attributed or a walk ceiling hits — ONE walk, O(history × tree-diff).
//  Rename-follow is OUT (a path appears/disappears only, per the ticket).
"use strict";

const changedpaths = require("./changedpaths.js");
const shalib = require("./util/sha.js");
const dag = require("./dag.js");
const isFullSha = shalib.isFullSha;

//  LIST-001: mirror log.js LOG_MAX_WALK — the cyclic-DAG walk bound.  Entries
//  unattributed within the ceiling render blank (acceptable first cut).
const LIST_MAX_WALK = 1 << 16;

//  First-line commit summary (log.js firstLine twin): skip a leading CR/LF run,
//  take up to the next CR/LF.  `body` is the raw commit-object body string.
function summaryOf(body) {
  if (!body) return "";
  let i = 0;
  while (i < body.length && (body[i] === "\n" || body[i] === "\r")) i++;
  let j = i;
  while (j < body.length && body[j] !== "\n" && body[j] !== "\r") j++;
  return body.slice(i, j);
}

//  The mainline first parent (log.js mainlineParent twin): argmax(commitTs) —
//  the newest parent — so the diff is against the github-like first-parent line.
function mainlineParent(k, parents) {
  if (!parents || !parents.length) return undefined;
  if (parents.length === 1) return isFullSha(parents[0]) ? parents[0] : undefined;
  let best, bestTs = -1n;
  for (const p of parents) {
    if (!isFullSha(p)) continue;
    const ts = dag.commitTs(k, p);
    if (best === undefined || ts > bestTs) { best = p; bestTs = ts; }
  }
  return best;
}

//  The IMMEDIATE scope entry a changed leaf path belongs to: strip `scopePfx`
//  (dir form "" | "sub/"), then the FIRST segment is the entry name.  A path not
//  under the scope → null.  A leaf directly at the scope is that file's name; a
//  leaf deeper down attributes the containing immediate DIR.
function entryOf(scopePfx, leafPath) {
  if (scopePfx && leafPath.indexOf(scopePfx) !== 0) return null;
  const rel = leafPath.slice(scopePfx.length);
  if (!rel) return null;
  const slash = rel.indexOf("/");
  return slash < 0 ? rel : rel.slice(0, slash);
}

//  LIST-001: attribute each name in `entries` (immediate file/dir names, RELATIVE
//  to `scopePfx`) its last-touch commit, walking from `tip`.  Returns a plain map
//  name → { summary, ts, sha }; unattributed names are simply absent (blank age).
//  `cap` overrides the ceiling (tests); default LIST_MAX_WALK.
function lastCommits(k, tip, scopePfx, entries, cap) {
  const want = {};                       // name → 1, entries still unattributed
  for (const n of entries) want[n] = 1;
  let remaining = entries.length;
  const out = {};
  const ceil = cap && cap > 0 ? cap : LIST_MAX_WALK;

  let sha = tip;
  for (let n = 0; n < ceil && remaining > 0; n++) {
    if (!isFullSha(sha)) break;
    const pc = k.parseCommit(sha);
    if (!pc) break;                      // missing/non-commit → walk breaks clean
    const parents = k.commitParents(sha) || [];
    const parent = mainlineParent(k, parents);
    //  Changed leaves of THIS commit vs its mainline parent (a root commit
    //  diffs vs the empty tree → every leaf it introduces).
    const changed = changedpaths.changedCommits(k, parent || "", k, sha);
    if (changed.length) {
      const summary = summaryOf(pc.body || "");
      const ts = dag.commitTs(k, sha);
      for (const leaf of changed) {
        const name = entryOf(scopePfx, leaf);
        if (name == null || !want[name]) continue;   // out of scope / already done
        out[name] = { summary: summary, ts: ts, sha: sha };
        delete want[name]; remaining--;
        if (remaining === 0) break;
      }
    }
    if (!parent) break;                  // root commit → stop
    sha = parent;
  }
  return out;
}

module.exports = { lastCommits: lastCommits, summaryOf: summaryOf,
                   mainlineParent: mainlineParent, entryOf: entryOf,
                   LIST_MAX_WALK: LIST_MAX_WALK };
