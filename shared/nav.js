//  shared/nav.js — URI-011: the nav-authority helper.  Every projector runs its
//  hunk banner + click-target URIs through navUri() so they carry the FULL nav
//  address (`//name/path`) — the pager stays scoped and answers "where am I".
"use strict";

//  The current nav authority (`//name` of the scoped tree) off the `be` global;
//  "" for the launch tree / no nav → navUri is byte-identical to `scheme:path`.
function authority() { return (typeof be !== "undefined" && be.authority) || ""; }

//  Compose `<scheme>://<auth>/<path>?<query>#<fragment>` — `path` is repo-relative
//  (no leading '/').  URI-013: build via URI.make with be.authority INJECTED; the
//  authority slot is fed VERBATIM (abc/URI.c URIutf8Feed; `.authority`/`URI.make`
//  carry their own `//`, cf. js/test/uri.js), and URI.make does NOT insert the `/`
//  between authority and path — so when an authority is present, root the path
//  (`/`+path).  `query`/`fragment` are OPTIONAL (undefined omits them) so callers
//  compose `?rev`/`#frag` HERE, never by concatenating onto the returned string.
//  Empty authority → undefined slot (plain `scheme:path`); a scheme-only make (no
//  auth/path/query/frag) returns falsy → `scheme:`.
function navUri(scheme, path, query, fragment) {
  const a = authority();                                   // "//name" or ""
  const auth = a || undefined;                             // fed verbatim (keeps `//`)
  let p = path || undefined;
  if (auth !== undefined && p) p = "/" + p;                // authority ⇒ rooted path
  return URI.make(scheme, auth, p, query, fragment) || (scheme + ":");
}

//  URI-011: inject the current nav authority into a BAKED `scheme:<path>?…` hunk
//  URI — the C weave/graf bakes `diff:`/`cat:` click-targets with NO authority, so
//  a click from a `//ULOG` view loses the scope (empty output).  `be.authority`
//  set → `diff:file?a..b` becomes `diff://ULOG/file?a..b`; no authority (launch
//  tree) → UNCHANGED (byte-parity); an already-authoritative `scheme://…` is left.
function navAuthorize(bakedUri) {
  const a = authority();
  if (!a || !bakedUri) return bakedUri;
  //  URI-013: parse the baked URI instead of hand-splitting on the first ':'.
  const u = uri._parse(bakedUri);
  if (!u.scheme) return bakedUri;                       // no scheme → leave as-is
  if (u.authority !== undefined) return bakedUri;       // idempotent: already scoped
  //  `a` (`//name`) is the authority slot fed VERBATIM; URI.make owns no
  //  authority↔path `/`, so root the path (when present) — byte-identical to the old
  //  `<scheme>: + a + (rest[0] not ?/# ? "/" : "") + rest`.
  const p = u.path ? "/" + u.path : u.path;
  return URI.make(u.scheme, a, p, u.query, u.fragment) || bakedUri;
}

module.exports = { authority: authority, navUri: navUri, navAuthorize: navAuthorize };
