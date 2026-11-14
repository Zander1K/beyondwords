// SHA-256 in plain TypeScript (FIPS 180-4), for checking the access password without keeping it
// in the source in plain text. The Web Crypto version (`crypto.subtle`) only exists in secure
// contexts (HTTPS or localhost); this one works anywhere, such as the dev server opened over
// plain HTTP from a phone on the network. Checked against Node's own SHA-256 in the tests.

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** The first `count` primes. */
function primes(count: number): number[] {
  const out: number[] = [];
  for (let n = 2; out.length < count; n++) {
    if (out.every((p) => n % p !== 0)) out.push(n);
  }
  return out;
}

/** The first 32 bits of the fractional part of x. */
const frac32 = (x: number) => Math.floor((x - Math.floor(x)) * 2 ** 32) >>> 0;

// Round constants: fractional parts of the cube roots of the first 64 primes.
const K = primes(64).map((p) => frac32(Math.cbrt(p)));
// Initial hash: fractional parts of the square roots of the first 8 primes.
const H0 = primes(8).map((p) => frac32(Math.sqrt(p)));

/** SHA-256 of the UTF-8 bytes of `text`, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(padded.length - 4, bits >>> 0);

  const h = Uint32Array.from(H0);
  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block + t * 4);
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15] ?? 0;
      const b = w[t - 2] ?? 0;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const add = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = ((h[i] ?? 0) + (add[i] ?? 0)) >>> 0;
  }
  return Array.from(h, (v) => v.toString(16).padStart(8, "0")).join("");
}
