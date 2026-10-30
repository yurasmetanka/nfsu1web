// DXT1 (BC1) blocks rewritten as ASTC 4x4 blocks, for a GPU without texture-compression-bc that has ASTC (Apple's:
// iPhones, iPads).  Unpacked to BGRA8 (dxt.ts) a DXT1 texture takes 8x its size; as ASTC 4x4 it takes 2x, and a
// phone's memory is what runs out (free roam: 159 MB of opaque DXT1 unpacked, ~40 MB as ASTC).
//
// A DXT1 block is two RGB565 colours and a 2-bit index per texel.  ASTC can say the same in one partition: colour
// endpoint mode 8 (LDR RGB direct) at 8 bits a value keeps both colours exactly (expanded to 8 bits as BC1 does), and
// the weights pick the points between them:
//   four colours (c0 > c1): weights of 2 bits, 0 21 43 64 of 64, against BC1's thirds: at most 1.3 of 255 off;
//   three colours (c0 <= c1): trit weights, 0 32 64 of 64: the midpoint exactly.
// The fourth index of a three-colour block is transparent black, which one plane cannot give: such a block goes into
// a texture unpacked instead (dxt1HasPunch, the encoder's choice at a texture's first upload), or, met in a later
// level of a texture already ASTC, into a dual-plane block (endpoint mode 12, RGBA at 7 bits, alpha its own plane):
// the alpha is right, the colour under a transparent texel the darker endpoint, not black.
//
// Layout (Khronos Data Format spec, ASTC): bits 0-10 the block mode, 11-12 partitions - 1, 13-16 the endpoint mode,
// then the endpoint values from bit 17 up; the weights from bit 127 down (bit i of their sequence at bit 127 - i), a
// dual-plane block's colour component selector just below them.
//   0x042: a 4x4 grid of 2-bit weights, one plane          0x051: a 4x4 grid of trit weights, one plane
//   0x451: 0x051 with two planes (32 weights, interleaved: plane 0 then plane 1 for each texel)
// The endpoint range is not stored: the decoder takes the largest whose values fit in the bits the weights leave
// (8 bits for 6 values in both one-plane modes; 7 bits for the 8 of the dual-plane one: 128 - 17 - 2 - 52 = 57).
const C5 = new Uint8Array(32), C6 = new Uint8Array(64);
for (let i = 0; i < 32; i++) C5[i] = (i << 3) | (i >> 2);
for (let i = 0; i < 64; i++) C6[i] = (i << 2) | (i >> 4);

/** trit quintuples (t0 + 3 t1 + 9 t2 + 27 t3 + 81 t4) to their 8-bit packing, from the spec's decoding */
const TRITS = new Uint8Array(243);
{
  const seen = new Uint8Array(243);
  for (let T = 255; T >= 0; T--) {         // downwards: the smallest packing wins (a short last group needs it)
    const b = (i: number, n = 1) => (T >> i) & ((1 << n) - 1);
    let C: number, t3: number, t4: number;
    if (b(2, 3) === 7) { C = b(5, 3) << 2 | b(0, 2); t4 = 2; t3 = 2; }
    else { C = b(0, 5); if (b(5, 2) === 3) { t4 = 2; t3 = b(7); } else { t4 = b(7); t3 = b(5, 2); } }
    let t0: number, t1: number, t2: number;
    const c = (i: number, n = 1) => (C >> i) & ((1 << n) - 1);
    if (c(0, 2) === 3) { t2 = 2; t1 = c(4); t0 = c(3) << 1 | (c(2) & ~c(3) & 1); }
    else if (c(2, 2) === 3) { t2 = 2; t1 = 2; t0 = c(0, 2); }
    else { t2 = c(4); t1 = c(2, 2); t0 = c(1) << 1 | (c(0) & ~c(1) & 1); }
    const k = t0 + 3 * t1 + 9 * t2 + 27 * t3 + 81 * t4;
    TRITS[k] = T; seen[k] = 1;
  }
  if (seen.indexOf(0) >= 0) throw new Error('astc: trit table incomplete');
}

// a block being built: four 32-bit words, low bits first
const blk = new Uint32Array(4), wts = new Uint8Array(32);
function put(pos: number, n: number, v: number) {
  for (let i = 0; i < n; i++, pos++) if ((v >>> i) & 1) blk[pos >> 5] |= 1 << (pos & 31);
}
/** the weights' bits from the top down: 2 bits each, or trits packed 5 to 8 bits (a short last group, its bits only) */
function putWeights(n: number, trits: boolean) {
  let pos = 127;
  const top = (v: number, bits: number) => { for (let i = 0; i < bits; i++, pos--) if ((v >> i) & 1) blk[pos >> 5] |= 1 << (pos & 31); };
  if (!trits) { for (let i = 0; i < n; i++) top(wts[i], 2); return pos; }
  for (let g = 0; g < n; g += 5) {
    const t = (i: number) => g + i < n ? wts[g + i] : 0;
    const k = t(0) + 3 * t(1) + 9 * t(2) + 27 * t(3) + 81 * t(4);
    top(TRITS[k], [0, 2, 4, 5, 7, 8][Math.min(5, n - g)]);
  }
  return pos;
}

function rev32(x: number): number {
  x = (x >>> 1 & 0x55555555) | (x & 0x55555555) << 1;
  x = (x >>> 2 & 0x33333333) | (x & 0x33333333) << 2;
  x = (x >>> 4 & 0x0F0F0F0F) | (x & 0x0F0F0F0F) << 4;
  x = (x >>> 8 & 0x00FF00FF) | (x & 0x00FF00FF) << 8;
  return x >>> 16 | x << 16;
}

/** whether any block of a DXT1 level (bw x bh blocks, pitch bytes a row of blocks) has a transparent texel */
export function dxt1HasPunch(src: Uint8Array, off: number, pitch: number, bw: number, bh: number): boolean {
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const b = off + by * pitch + bx * 8;
      if ((src[b] | src[b + 1] << 8) > (src[b + 2] | src[b + 3] << 8)) continue;
      const idx = (src[b + 4] | src[b + 5] << 8 | src[b + 6] << 16 | src[b + 7] << 24) >>> 0;
      // a 2-bit index 3: both bits set
      if ((idx & (idx >>> 1) & 0x55555555) !== 0) return true;
    }
  }
  return false;
}

const W3 = [0, 2, 1, 0];   // a three-colour block's codes to trit weights: c0 = 0, c1 = 2, the midpoint 1
/** an 8-bit value at 7 bits, as the decoder unquantizes it (v << 1 | v >> 6) */
const q7 = (c: number) => (c & ~1) | (c >> 7);

/** One DXT1 level (bw x bh blocks, pitch bytes a row of blocks) as ASTC 4x4 blocks, 16 bytes each, bw * 16 bytes a
 *  row; into the start of `into` when that has room, else into a new array.  punch counts the blocks that needed two
 *  planes (a transparent texel). */
export function dxt1ToAstc(src: Uint8Array, off: number, pitch: number, bw: number, bh: number, into?: Uint8Array,
  punch?: { blocks: number }): Uint8Array {
  const n = bw * bh * 16, out = into && into.length >= n ? into.subarray(0, n) : new Uint8Array(n);
  const o32 = new Uint32Array(out.buffer, out.byteOffset, n >> 2);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const b = off + by * pitch + bx * 8;
      const c0 = src[b] | src[b + 1] << 8, c1 = src[b + 2] | src[b + 3] << 8;
      const idx = (src[b + 4] | src[b + 5] << 8 | src[b + 6] << 16 | src[b + 7] << 24) >>> 0;
      let r0 = C5[c0 >> 11], g0 = C6[(c0 >> 5) & 63], b0 = C5[c0 & 31];
      let r1 = C5[c1 >> 11], g1 = C6[(c1 >> 5) & 63], b1 = C5[c1 & 31];
      const four = c0 > c1, holes = !four && (idx & (idx >>> 1) & 0x55555555) !== 0;
      // a dual-plane block's endpoints at 7 bits: the decoder compares (and gives) what they unquantize to
      if (holes) { r0 = q7(r0); g0 = q7(g0); b0 = q7(b0); r1 = q7(r1); g1 = q7(g1); b1 = q7(b1); }
      // the decoder wants the second endpoint's sum the larger (else it swaps them and blends blue in): swap here,
      // and turn the weights round
      const swap = r1 + g1 + b1 < r0 + g0 + b0;
      if (swap) { let x = r0; r0 = r1; r1 = x; x = g0; g0 = g1; g1 = x; x = b0; b0 = b1; b1 = x; }
      const o = (by * bw + bx) * 4;
      if (!holes) {
        // the weights' sequence, lowest bit first (at most 32 bits: the top word of the block, its bits reversed)
        let ws: number;
        if (four) {
          // codes 0 1 2 3 to weights 0 3 1 2, all 16 at once: high bit the code's low bit, low bit the two bits' xor
          const lo = idx & 0x55555555, hi = (idx >>> 1) & 0x55555555;
          ws = swap ? ~(lo << 1 | (lo ^ hi)) : lo << 1 | (lo ^ hi);
        } else {
          for (let i = 0; i < 16; i++) { const w = W3[(idx >>> 2 * i) & 3]; wts[i] = swap ? 2 - w : w; }
          const g = (i: number) => TRITS[wts[i] + 3 * wts[i + 1] + 9 * wts[i + 2] + 27 * wts[i + 3] + 81 * wts[i + 4]];
          ws = g(0) | g(5) << 8 | g(10) << 16 | TRITS[wts[15]] << 24;
        }
        // block mode, one partition, endpoint mode 8, then r0 r1 g0 g1 b0 b1 at 8 bits from bit 17
        o32[o] = (four ? 0x042 : 0x051) | 8 << 13 | r0 << 17 | r1 << 25;
        o32[o + 1] = r1 >> 7 | g0 << 1 | g1 << 9 | b0 << 17 | b1 << 25;
        o32[o + 2] = b1 >> 7;
        o32[o + 3] = rev32(ws);
        continue;
      }
      // alpha 255 at the first endpoint, 0 at the second; a transparent texel takes the first's colour (the darker)
      blk.fill(0);
      for (let i = 0; i < 16; i++) {
        const k = (idx >>> 2 * i) & 3, w = W3[k];
        wts[2 * i] = k === 3 ? 0 : swap ? 2 - w : w;
        wts[2 * i + 1] = k === 3 ? 2 : 0;
      }
      put(0, 11, 0x451); put(13, 4, 12);
      const v = [r0, r1, g0, g1, b0, b1, 255, 0];
      for (let i = 0; i < 8; i++) put(17 + 7 * i, 7, v[i] >> 1);   // q7 values: >> 1 is their 7 bits
      const below = putWeights(32, true);
      put(below - 1, 2, 3);                  // the second plane is alpha
      if (punch) punch.blocks++;
      o32[o] = blk[0]; o32[o + 1] = blk[1]; o32[o + 2] = blk[2]; o32[o + 3] = blk[3];
    }
  }
  return out;
}
