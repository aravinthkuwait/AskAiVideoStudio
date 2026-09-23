// Content sniffing by magic bytes. Client-supplied MIME types and extensions
// are never trusted; they must AGREE with the detected type.
export const IMAGE_TYPES = {
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

const EXT_TO_KIND = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' };

export function sniffImage(head) {
  if (!head || head.length < 12) return null;
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Validate that sniffed content, declared MIME and filename extension agree. */
export function checkImage(head, declaredMime, filename) {
  const kind = sniffImage(head);
  if (!kind) return { ok: false, reason: 'File content is not a supported image (PNG, JPEG or WebP).' };
  const ext = String(filename || '').toLowerCase().split('.').pop();
  if (filename && filename.includes('.') && EXT_TO_KIND[ext] !== kind) {
    return { ok: false, reason: 'File extension does not match the image content.' };
  }
  const mime = String(declaredMime || '').split(';')[0].trim().toLowerCase();
  if (mime && mime !== 'application/octet-stream' && mime !== IMAGE_TYPES[kind].mime && !(kind === 'jpeg' && mime === 'image/jpg')) {
    return { ok: false, reason: 'Declared file type does not match the image content.' };
  }
  return { ok: true, kind, ...IMAGE_TYPES[kind] };
}

/** Parse width/height from PNG / JPEG / WebP header bytes when possible. */
export function imageSize(buf, kind) {
  try {
    if (kind === 'png' && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (kind === 'webp' && buf.length >= 30) {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    }
    if (kind === 'jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
  } catch { /* unknown */ }
  return { width: null, height: null };
}
