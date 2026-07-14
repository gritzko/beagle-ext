//  sha1s.js — STREAMING SHA-1 (GET-044).  The JABC `sha1()` global is one-shot
//  (whole buffer) and io.mmap truncates past 2^31-1 bytes, so a multi-GB wire
//  pack can neither be heap-hashed nor mmap-hashed; this pure-JS incremental
//  hasher feeds 64-byte blocks as the bytes stream (constant memory).
//
//    open() -> { feed(u8), close() -> Uint8Array(20) }
//
//  Verified block-for-block against the native sha1() (test/wire_stream.js).

"use strict";

function open() {
  let h0 = 0x67452301 | 0, h1 = 0xEFCDAB89 | 0, h2 = 0x98BADCFE | 0,
      h3 = 0x10325476 | 0, h4 = 0xC3D2E1F0 | 0;
  const tail = new Uint8Array(64);      // partial trailing block
  let tlen = 0;
  let lo = 0, hi = 0;                   // total byte length, 64-bit split
  const w = new Int32Array(80);

  function block(p, o) {
    for (let i = 0; i < 16; i++, o += 4)
      w[i] = (p[o] << 24) | (p[o + 1] << 16) | (p[o + 2] << 8) | p[o + 3];
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 20; i++) {
      const t = (((a << 5) | (a >>> 27)) + ((b & c) | (~b & d)) + e + w[i] + 0x5A827999) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    for (let i = 20; i < 40; i++) {
      const t = (((a << 5) | (a >>> 27)) + (b ^ c ^ d) + e + w[i] + 0x6ED9EBA1) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    for (let i = 40; i < 60; i++) {
      const t = (((a << 5) | (a >>> 27)) + ((b & c) | (b & d) | (c & d)) + e + w[i] + 0x8F1BBCDC) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    for (let i = 60; i < 80; i++) {
      const t = (((a << 5) | (a >>> 27)) + (b ^ c ^ d) + e + w[i] + 0xCA62C1D6) | 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }

  function feed(u8) {
    let off = 0;
    const n = u8.length;
    lo = (lo + n) >>> 0;
    if (lo < n) hi++;                       // carry (mod 2^32 wrap)
    hi += Math.floor(n / 0x100000000);      // n itself may exceed 2^32? (no, but safe)
    if (tlen) {
      const need = 64 - tlen;
      const take = n < need ? n : need;
      tail.set(u8.subarray(0, take), tlen); tlen += take; off = take;
      if (tlen < 64) return;
      block(tail, 0); tlen = 0;
    }
    while (off + 64 <= n) { block(u8, off); off += 64; }
    if (off < n) { tail.set(u8.subarray(off), 0); tlen = n - off; }
  }

  function close() {
    //  Pad: 0x80, zeros to 56 mod 64, then the 64-bit big-endian BIT length.
    const bitsLo = (lo << 3) >>> 0;
    const bitsHi = ((hi << 3) | (lo >>> 29)) >>> 0;
    const pad = new Uint8Array(((tlen < 56) ? 64 : 128));
    pad.set(tail.subarray(0, tlen), 0);
    pad[tlen] = 0x80;
    const end = pad.length;
    pad[end - 8] = bitsHi >>> 24; pad[end - 7] = (bitsHi >>> 16) & 0xff;
    pad[end - 6] = (bitsHi >>> 8) & 0xff; pad[end - 5] = bitsHi & 0xff;
    pad[end - 4] = bitsLo >>> 24; pad[end - 3] = (bitsLo >>> 16) & 0xff;
    pad[end - 2] = (bitsLo >>> 8) & 0xff; pad[end - 1] = bitsLo & 0xff;
    block(pad, 0);
    if (end === 128) block(pad, 64);
    const out = new Uint8Array(20);
    const hs = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 5; i++) {
      out[i * 4] = hs[i] >>> 24; out[i * 4 + 1] = (hs[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (hs[i] >>> 8) & 0xff; out[i * 4 + 3] = hs[i] & 0xff;
    }
    return out;
  }

  return { feed: feed, close: close };
}

module.exports = { open: open };
