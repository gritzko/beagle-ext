//  verbs/dont/dont.js — WORK-001: `dont` — done's wontfix twin (the BE-044
//  reshape): `dont .` / `dont //KEY` moves the work/ wt into `work/done/`
//  (bump on collision) and flips a ticket-named wt's page header to [DONT];
//  `dont KEY` flips the ticket page alone.  All machinery lives in done.js.
"use strict";

const donelib = require("../done/done.js");

function dont() { return donelib._run(arguments, "DONT", "dont"); }
dont.jab = "args";
module.exports = dont;
