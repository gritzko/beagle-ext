// JAB-004: read the render mode / force flag off the global `be`.  Every verb is
// plain-args now (no ctx), so `be` is always minted before a verb runs.

function format() { return (globalThis.be && be.format) || "plain"; }

function force() { return !!(globalThis.be && be.force); }

module.exports = { format, force };
