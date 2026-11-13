/**
 * Tiny QR code encoder for the share link (pure, no dependencies, no network).
 * Byte mode, error correction L or M, versions 1 to 6 (up to 106 bytes at M),
 * which is plenty for "https://<host>/?room=ABCD". Follows the structure of
 * Project Nayuki's reference encoder (MIT): function patterns, Reed-Solomon
 * blocks, zigzag placement, best of 8 masks by the standard penalty rules.
 */

export type Ecc = 'L' | 'M';

/** [ecc codewords per block, number of blocks] for versions 1..6. */
const BLOCKS: Record<Ecc, [number, number][]> = {
  L: [[7, 1], [10, 1], [15, 1], [20, 1], [26, 1], [18, 2]],
  M: [[10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4]],
};
const FORMAT_BITS: Record<Ecc, number> = { L: 1, M: 0 };
const MAX_VERSION = 6;

const rawCodewords = (ver: number): number => [26, 44, 70, 100, 134, 172][ver - 1];
const dataCodewords = (ver: number, ecc: Ecc): number => {
  const [e, b] = BLOCKS[ecc][ver - 1];
  return rawCodewords(ver) - e * b;
};

export interface QrCode {
  size: number;
  version: number;
  /** modules[y * size + x]: true = dark. */
  modules: Uint8Array;
}

export function encodeQr(text: string, ecc: Ecc = 'M'): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= MAX_VERSION; v++) {
    // mode (4) + count (8) + data
    if (4 + 8 + bytes.length * 8 <= dataCodewords(v, ecc) * 8) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('QR: text too long');

  // ---- Bit stream ----
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(version, ecc) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }

  const codewords = addEccAndInterleave(data, version, ecc);

  // ---- Modules ----
  const size = version * 4 + 17;
  const modules = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  const set = (x: number, y: number, dark: boolean) => {
    modules[y * size + x] = dark ? 1 : 0;
    fn[y * size + x] = 1;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  if (version >= 2) {
    const c = size - 7; // the single alignment pattern of versions 2..6
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = (mask: number) => {
    const d = (FORMAT_BITS[ecc] << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((f >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true); // dark module
  };
  drawFormat(0); // reserve the format areas

  // Zigzag placement of the codewords.
  let i = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y * size + x] && i < total) {
          modules[y * size + x] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
  }

  // Best mask.
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(modules, fn, size, m);
    drawFormat(m);
    const score = penalty(modules, size);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
    applyMask(modules, fn, size, m); // XOR again = undo
  }
  applyMask(modules, fn, size, best);
  drawFormat(best);
  return { size, version, modules };
}

function maskBit(m: number, x: number, y: number): boolean {
  switch (m) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(modules: Uint8Array, fn: Uint8Array, size: number, m: number): void {
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) if (!fn[y * size + x] && maskBit(m, x, y)) modules[y * size + x] ^= 1;
}

/** Standard penalty rules 1 (runs), 2 (2x2 blocks), 3 (finder-like) and 4 (balance). */
function penalty(mod: Uint8Array, size: number): number {
  let score = 0;
  const at = (x: number, y: number) => mod[y * size + x];
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        const cur = b < size ? (pass ? at(a, b) : at(b, a)) : -1;
        const prev = pass ? at(a, b - 1) : at(b - 1, a);
        if (cur === prev) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      // Rule 3: 1:1:3:1:1 dark pattern with 4 light modules on a side.
      for (let b = 0; b + 10 < size; b++) {
        let p1 = true;
        let p2 = true;
        const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
        for (let k = 0; k < 11; k++) {
          const v = pass ? at(a, b + k) : at(b + k, a);
          if (v !== A[k]) p1 = false;
          if (v !== A[10 - k]) p2 = false;
        }
        if (p1) score += 40;
        if (p2) score += 40;
      }
    }
  }
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
  let dark = 0;
  for (let k = 0; k < mod.length; k++) dark += mod[k];
  const k = Math.ceil(Math.abs(dark * 20 - mod.length * 10) / mod.length) - 1;
  return score + Math.max(0, k) * 10;
}

// ---- Reed-Solomon over GF(256), polynomial 0x11D ----

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

export function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

function addEccAndInterleave(data: number[], version: number, ecc: Ecc): number[] {
  const [eccLen, numBlocks] = BLOCKS[ecc][version - 1];
  const raw = rawCodewords(version);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const e = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(e));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]);
    });
  return out;
}
