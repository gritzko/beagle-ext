//  loop.js — the thin ENTRY shim for the resident dispatch loop (JSQUE-016).
//  The real loop lives in core/loop.js; this root file is the stable entry
//  path the CLI (and the SUT=loop parity harness, `jab be/loop.js <verb>`)
//  invokes.  Keeping the entry at the be/ ROOT means core/loop.js's
//  `process.argv[1]`-derived `_here` resolves to the be/ root (where core/ +
//  shared/ live), and the be-relative `require("core/…")` finds the shard
//  nearest THIS file via the `be -> .` self-symlink.  A pure re-require +
//  self-run; ZERO behaviour of its own.
"use strict";

const loop = require("core/loop.js");

//  Invoked directly (`jab loop.js <verb> …`): drive the CLI entry.  Required
//  as a module (tests): re-export run/cli unchanged.
if (typeof module !== "undefined") module.exports = loop;
if (process.argv[1] && process.argv[1].slice(-"/loop.js".length) === "/loop.js")
  loop.cli(process.argv);
