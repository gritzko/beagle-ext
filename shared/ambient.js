// JAB-004: read the render mode / force flag off the global `be`.  Every verb is
// plain-args now (no ctx), so `be` is always minted before a verb runs.

function format() { return (globalThis.be && be.format) || "plain"; }

function force() { return !!(globalThis.be && be.force); }

//  GET-049: the run's start ts — be.now (minted per verb invocation, loop.js)
//  is the ONE source for a verb's row ts AND its file mtime stamps; a direct
//  (loop-less) call samples fresh.
function now() { return (globalThis.be && be.now) || ron.now(); }

module.exports = { format, force, now };
