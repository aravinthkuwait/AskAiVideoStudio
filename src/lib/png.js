// Generates small synthetic PNG images (used by the SIMULATED provider and
// demo data). No external image library required.
import zlib from 'node:zlib';

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** Diagonal gradient between two RGB colours. */
export function gradientPng(width, height, from = [20, 24, 40], to = [120, 80, 200]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      raw[o++] = Math.round(from[0] + (to[0] - from[0]) * t);
      raw[o++] = Math.round(from[1] + (to[1] - from[1]) * t);
      raw[o++] = Math.round(from[2] + (to[2] - from[2]) * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Deterministic colour pair from a seed string. */
export function seedColors(seed) {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = [(h & 0x3f) + 10, ((h >> 6) & 0x3f) + 10, ((h >> 12) & 0x3f) + 30];
  const b = [((h >> 3) & 0x7f) + 100, ((h >> 9) & 0x7f) + 60, ((h >> 15) & 0x7f) + 120];
  return [a, b];
}
