//  shared/argline.js — JAB-004 phase 1: the ONE arg tokenizer feeding both
//  surfaces (CLI + pager `:` line).  A raw command line → { verb, args } for
//  the three call shapes; a verb is a plain name and args are plain JS values.
//  REUSES the JSC `eval` binding for shape 3 ONLY (the explicit `verb(` form);
//  shapes 1/2 never eval — a shape-2 token is a string or a SAFE SCALAR
//  (number/true/false/null), the exact rule the CLI's already-split argv uses.
//
//    parse(line) → { verb, args }
//      1. bare `verb`            → { verb, args: [] }
//      2. `verb a b 'c d'`       → shell-split, args = string|safe-scalar
//      3. `verb("proper", 132)`  → verb immediately followed by `(` ⇒ eval the
//                                   JS arg list, args = real JS values
//    scalar(tok) → the shape-2 coercion of ONE already-split argv token: a JSON
//      number shape → Number, exact `true`/`false`/`null` → the value, else the
//      verbatim string.  The CLI hands its shell-split argv through this so both
//      surfaces agree on a bare token's type.  NO eval.
"use strict";

//  JAB-004: a leading verb NAME `[A-Za-z][A-Za-z0-9]*` + optional `!` (GET's
//  `get!`).  The char after the name picks the shape: `(` ⇒ 3, else 1/2.
const VERB_RE = /^([a-zA-Z][a-zA-Z0-9]*!?)/;

//  JAB-004: SAFE-SCALAR coercion for ONE shape-2 token, no eval — JSON-number →
//  Number, exact true/false/null → value, else a verbatim string.
const NUM_RE = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/;
function scalar(s) {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (NUM_RE.test(s)) return Number(s);
  return s;
}

//  JAB-004: shell-split honouring single/double quotes — a quoted run stays ONE
//  token (quotes stripped), `\` escapes; no glob, no `$` expansion.
function shellSplit(s) {
  const out = [];
  let cur = "", q = 0, has = false;             // q: 0 | 39 (') | 34 (")
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === 39) { if (c === "'") q = 0; else cur += c; continue; }
    if (q === 34) {
      if (c === '"') q = 0;
      else if (c === "\\" && i + 1 < s.length) { cur += s[++i]; }
      else cur += c;
      continue;
    }
    if (c === "'") { q = 39; has = true; continue; }
    if (c === '"') { q = 34; has = true; continue; }
    if (c === "\\" && i + 1 < s.length) { cur += s[++i]; has = true; continue; }
    if (c === " " || c === "\t") { if (has) { out.push(cur); cur = ""; has = false; } continue; }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return { toks: out, quoted: q, split: markQuoted(s) };
}

//  JAB-004: per-token flag — was it from a QUOTED run?  A quoted token is always
//  a verbatim string, never a scalar (`post '132'` ⇒ the string, not 132).
function markQuoted(s) {
  const flags = [];
  let has = false, wasQ = false, q = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q === 39) { if (c === "'") q = 0; else {} has = true; continue; }
    if (q === 34) {
      if (c === '"') q = 0; else if (c === "\\" && i + 1 < s.length) i++;
      has = true; continue;
    }
    if (c === "'") { q = 39; wasQ = true; has = true; continue; }
    if (c === '"') { q = 34; wasQ = true; has = true; continue; }
    if (c === "\\" && i + 1 < s.length) { i++; has = true; continue; }
    if (c === " " || c === "\t") { if (has) { flags.push(wasQ); has = false; wasQ = false; } continue; }
    has = true;
  }
  if (has) flags.push(wasQ);
  return flags;
}

//  JAB-004: parse the explicit `verb(a, b, …)` shape — eval the JS arg list to
//  REAL values (shape-gated, per JAB-003); depth-cap + try/catch → verbatim tail.
function evalCall(verb, rest) {
  //  Balance to the MATCHING close paren so a trailing `)` inside a string or a
  //  nested call is respected; cap the nesting so pathological input can't spin.
  let depth = 0, end = -1, inStr = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = 0; continue; }
    if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
    if (c === "(") { if (++depth > 64) break; }
    else if (c === ")") { if (--depth === 0) { end = i; break; } }
  }
  if (end < 0) return { verb: verb, args: [rest.slice(1)] };   // unbalanced → string tail
  const inner = rest.slice(1, end);
  let vals;
  try { vals = eval("[" + inner + "]"); }        // user input, shape-3 gated: eval OK
  catch (e) { return { verb: verb, args: [inner] }; }   // backstop: the tail verbatim
  return { verb: verb, args: vals };
}

//  JAB-004: the ONE entry — raw line → { verb, args } for all three shapes.
//  Non-verb input (`scheme:uri`, path, empty) → verb null for URI/view routing.
function parse(line) {
  const s = (line || "").trim();
  if (!s) return { verb: null, args: [] };
  const m = VERB_RE.exec(s);
  if (!m) return { verb: null, args: [] };       // not a bareword — a URI/path
  const verb = m[1];
  const after = s.slice(m[0].length);
  //  A `name:` token (colon right after the name) is a `scheme:uri`, NOT a verb
  //  call — hand it back as verb null so the caller's URI/view routing takes it.
  if (after[0] === ":") return { verb: null, args: [] };
  //  Shape 3: the verb name is IMMEDIATELY followed by `(` (no space) — eval.
  if (after[0] === "(") return evalCall(verb, after);
  //  Shape 1: bare verb (nothing, or only trailing space).
  if (!after.trim()) return { verb: verb, args: [] };
  //  Shape 2: `verb a b 'c d'` — shell-split, coerce each UNQUOTED token; a
  //  QUOTED token stays a verbatim string.
  const sp = shellSplit(after);
  const args = sp.toks.map(function (t, i) {
    return sp.split[i] ? t : scalar(t);
  });
  return { verb: verb, args: args };
}

module.exports = { parse: parse, scalar: scalar, shellSplit: shellSplit };
