//  core/resolve.js — hex-hashlet → sha resolution helpers.  JAB-004 retired the
//  resolution-at-entry SEED (seedCtx/seed/classifyArg/pinPath): every verb is a
//  plain-args handler that parses its OWN args now, so the central classifier is
//  gone.  What remains is the shared hex resolver the object/content views
//  (blob/cat/log/size/tree/type) and PUT use to turn a 6..40-hex hashlet prefix
//  into a full sha.  libabc+libdog ONLY.
"use strict";

const shalib    = require("shared/util/sha.js");
const isFullSha = shalib.isFullSha;

//  A 6..40 hex hashlet (short sha) — the `?br#<hashlet>` / `?<hashlet>` form.
function isHexish(s) {
  return !!s && s.length >= 6 && s.length <= 40 && /^[0-9a-f]+$/.test(s);
}

//  KEEPResolveHex twin: a full sha passes through iff the object exists; a
//  short hashlet scans the local tips + remotes for a unique-prefix sha.
function resolveHex(k, hexish) {
  if (isFullSha(hexish)) return k.getObject(hexish) ? hexish : undefined;
  let hit;
  k.eachTip(function (t) { if (!hit && t.sha.indexOf(hexish) === 0) hit = t.sha; });
  if (!hit) k.eachRemote(function (rt) { if (!hit && rt.sha.indexOf(hexish) === 0) hit = rt.sha; });
  return hit;
}

module.exports = { isHexish: isHexish, resolveHex: resolveHex };
