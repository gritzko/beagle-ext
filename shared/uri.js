//  uri.js — the ONE total arg classifier shared by verbs + bro (JAB-005):
//  parse(arg) returns a URI when arg lexes, else the raw string (swallows the
//  native `malformed` throw), so verbs parse on entry and branch on the TYPE.
"use strict";

//  URI is the native (js/uri.cpp) global constructor.  A URI result => use its
//  slots; a string result => free-form text (a message / search prose).
function parse(arg) {
  try { return new URI(arg); } catch (e) { return arg; }
}

module.exports = { parse: parse };
