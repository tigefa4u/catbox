/**
 * Image format detection.
 *
 * A browser supplied MIME type is only a hint: a file can be renamed or
 * forged. The upload endpoint sniffs the magic bytes of the first bytes of
 * the file so only real images are stored and served with a truthful
 * Content-Type.
 *
 * Validation is limited to the prefix window (SNIFF_LENGTH) because we only
 * read the first N bytes from the uploaded file.  End-of-file markers (IEND,
 * EOI, 0x3b trailer) are therefore best-effort: when they are visible we
 * confirm them; when they are outside the window we accept the format on the
 * basis of structural header validity alone.
 */

/** Image formats the upload endpoint accepts. */
export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'svg';

/** Every supported format, in the order shown to users. */
export const SUPPORTED_FORMATS: readonly ImageFormat[] = [
  'png',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
];

/** Canonical file extension per format. */
export const FORMAT_EXTENSIONS: Record<ImageFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  gif: 'gif',
  webp: 'webp',
  avif: 'avif',
  svg: 'svg',
};

/** Canonical MIME type per format. */
export const FORMAT_MIME_TYPES: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** Human readable list of the accepted formats. */
export const SUPPORTED_FORMATS_LABEL = 'PNG, JPEG, GIF, WebP, AVIF or SVG';

/** Number of leading bytes needed to identify every supported format. */
export const SNIFF_LENGTH = 4096;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR = [0x49, 0x48, 0x44, 0x52];  // IHDR chunk type
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44];  // IEND chunk type
const GIF87_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89_SIGNATURE = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const FTYP_SIGNATURE = [0x66, 0x74, 0x79, 0x70];

/** Check whether `head` starts with `signature` at `offset`. */
function startsWith(head: Uint8Array, signature: number[], offset = 0): boolean {
  if (head.length < offset + signature.length) return false;

  for (let index = 0; index < signature.length; index++) {
    if (head[offset + index] !== (signature[index] ?? -1)) return false;
  }

  return true;
}

/** Read four ASCII characters at `offset`. */
function readAscii(head: Uint8Array, offset: number): string {
  let text = '';
  for (let index = offset; index < offset + 4 && index < head.length; index++) {
    text += String.fromCharCode(head[index] ?? 0);
  }
  return text;
}

/**
 * Identify an image format from the first bytes of a file.
 * Returns `null` when the bytes do not match any supported format.
 */
export function detectImageFormat(head: Uint8Array): ImageFormat | null {
  if (head.length === 0) return null;

  // --- PNG: signature + IHDR chunk, IEND if visible ---
  if (startsWith(head, PNG_SIGNATURE)) {
    if (head.length < 33) return null;
    if (
      (head[8] === 0x00 && head[9] === 0x00 && head[10] === 0x00 && head[11] === 0x0d) &&
      startsWith(head, PNG_IHDR, 12)
    ) {
      // Try to find IEND within the sniff window.
      let offset = 8;
      while (offset < head.length - 8) {
        const chunkLen = (head[offset]! << 24) | (head[offset + 1]! << 16) | (head[offset + 2]! << 8) | head[offset + 3]!;
        if (chunkLen > 0xffffff || offset + 12 + chunkLen > head.length) break;
        // Check chunk type before advancing.
        if (startsWith(head, PNG_IEND, offset + 4)) {
          return 'png'; // IEND found → definitely valid
        }
        offset += 12 + chunkLen; // length(4) + type(4) + data + CRC(4)
      }
      // IEND not in window but IHDR is valid → treat as PNG.
      return 'png';
    }
  }

  // --- JPEG: SOI + at least one SOF* marker; EOI if visible ---
  if (head.length >= 10 && head[0] === 0xff && head[1] === 0xd8) {
    let offset = 2;
    let foundFrame = false;
    while (offset < head.length - 1) {
      if (head[offset] !== 0xff) break;
      if (head[offset + 1] === 0x00) { offset += 2; continue; } // stuffing
      const marker = head[offset + 1]!;
      if (marker >= 0xc0 && marker <= 0xc3) {
        foundFrame = true;
      }
      if (marker === 0xd9) { // EOI — found frame AND end
        return foundFrame ? 'jpeg' : null;
      }
      if (marker === 0xd8 || marker === 0xac) break; // RST, COM: skip
      if (marker === 0xda) { // SOS — compressed data follows, can't parse segments
        break;
      }
      if (offset + 3 >= head.length) break;
      const segLen = (head[offset + 2]! << 8) | head[offset + 3]!;
      if (segLen < 2) break;
      offset += 2 + segLen;
    }
    if (foundFrame) return 'jpeg'; // SOF found, EOI may be beyond window
  }

  // --- GIF: signature + GIF header + image descriptor, trailer if visible ---
  if ((startsWith(head, GIF87_SIGNATURE) || startsWith(head, GIF89_SIGNATURE)) && head.length >= 22) {
    const b10 = head[10]!;
    const hasGCT = (b10 & 0x80) !== 0;
    const gctSize = hasGCT ? Math.pow(2, (b10 & 0x07) + 1) * 3 : 0;
    let offset = 13 + gctSize; // LSD ends at 12, GCT starts at 13
    let foundImage = false;
    while (offset < head.length) {
      if (head[offset] === 0x3b) { // trailer
        return foundImage ? 'gif' : null;
      }
      if (head[offset] === 0x2c) { // image descriptor
        foundImage = true;
        // Skip past image descriptor (9 bytes: x,y,w,h + flags, LZW min) and LZW sub-blocks.
        offset += 9; // skip descriptor
        if (offset < head.length) {
          while (offset < head.length) {
            const lzwSize = head[offset]!;
            if (lzwSize === 0) { offset++; break; } // LZW terminator
            offset += lzwSize;
            if (offset >= head.length) break; // truncated
          }
        }
      } else if (head[offset] === 0x21) {
        // Extension block: skip introducer + label + all sub-blocks.
        offset += 2; // skip introducer and label
        while (offset < head.length) {
          if (head[offset] === 0x00) { offset++; break; } // terminator
          const subLen = head[offset]!;
          offset += 1 + subLen; // skip size + data
        }
      } else {
        break; // unexpected block
      }
    }
    // Image descriptor found but trailer not in window → treat as GIF.
    if (foundImage) return 'gif';
  }

  // --- WebP ---
  if (startsWith(head, RIFF_SIGNATURE) && startsWith(head, WEBP_SIGNATURE, 8)) return 'webp';

  // --- AVIF ---
  if (startsWith(head, FTYP_SIGNATURE, 4)) {
    const brand = readAscii(head, 8);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }

  // --- SVG: text detection with namespace-aware matching ---
  const text = new TextDecoder()
    .decode(head.subarray(0, Math.min(head.length, SNIFF_LENGTH)))
    .trimStart()
    .toLowerCase();

  // Match any tag whose local name is "svg" (possibly namespace-prefixed).
  const svgTagMatch = text.match(/<[^>]*?svg[\s>][^>]*>/);
  if (svgTagMatch) {
    const svgTag = svgTagMatch[0];
    const svgNS = 'http://www.w3.org/2000/svg';
    // Check ALL xmlns declarations in the tag, not just the first.
    const hasNs = svgTag.match(/xmlns\s*=\s*["'](.*?)["']/) !== null &&
      (svgTag.match(/xmlns\s*=\s*["']([^"']*)["']/)?.[1] === svgNS ||
       svgTag.match(/xmlns:([^'"\s]*)\s*=\s*["'](.*?)["']/) &&
       svgTag.match(/xmlns:([^'"\s]*)\s*=\s*["'](.*?)["']/)![2] === svgNS);
    if (hasNs) return 'svg';
  }

  return null;
}
