/**
 * CRC-32 (IEEE 802.3) over a byte array — used for ZIP local/central headers.
 * Table-based, zero-dependency.
 */

const TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * `previous` chains one call into the next: `crc32(b, crc32(a))` is
 * `crc32(concat(a, b))`. The reader digests a package entry by entry that way
 * rather than building one buffer of every part, which for a deck carrying
 * embedded images would be a copy of the whole file. Default `0` is the
 * unchained call the zip headers make, so their behaviour is untouched.
 */
export function crc32(bytes: Uint8Array, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    crc = TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
