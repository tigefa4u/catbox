/**
 * Image format detection.
 *
 * A browser supplied MIME type is only a hint: a file can be renamed or
 * forged. The upload endpoint sniffs the magic bytes of the first bytes of
 * the file so only real images are stored and served with a truthful
 * Content-Type.
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
  png: '.png',
  jpeg: '.jpg',
  gif: '.gif',
  webp: '.webp',
  avif: '.avif',
  svg: '.svg',
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
export const SNIFF_LENGTH = 512;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR = [0x49, 0x48, 0x44, 0x52];  // IHDR chunk type
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
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

  if (startsWith(head, PNG_SIGNATURE)) {
    // Verify IHDR chunk type at offset 12 (4 bytes length + 4 bytes type) and
    // that the file has at least enough bytes for a complete IHDR chunk (13 bytes
    // data + 4 bytes CRC) after the marker — 25 bytes total following IHDR.
    if (startsWith(head, PNG_IHDR, 12) && head.length >= 33) return 'png';
  }
  // JPEG: SOI + APP0 header with JFIF signature, plus a valid SOF0 (Start of Frame) marker.
  // APP0 is 2+4+5+1 = 12 bytes; SOF0 marker + length = 4 bytes minimum.
  if (startsWith(head, JPEG_SIGNATURE) && head.length >= 12) {
    // Verify APP0 marker (FF E0) after SOI
    if (head.length >= 12 && head[3] === 0xff && head[4] === 0xe0 && head[5] === 0x4a && head[6] === 0x46 && head[7] === 0x49 && head[8] === 0x46 && head[9] === 0x00) {
      // Verify SOF0 marker (FF C0) exists within head — ensures valid image structure
      for (let i = 12; i < head.length - 1; i++) {
        if (head[i] === 0xff && head[i + 1] === 0xc0) {
          return 'jpeg';
        }
      }
    }
  }
  // GIF: signature + logical screen descriptor (10 bytes) + image descriptor (10 bytes) + image data.
  // Need at least 20 bytes for a minimal valid GIF with an image block.
  if ((startsWith(head, GIF87_SIGNATURE) || startsWith(head, GIF89_SIGNATURE)) && head.length >= 22) {
    // Validate logical screen descriptor (10 bytes after signature) + image descriptor (0x2c).
    // LSD is at offset 6-15 (after 6-byte signature). Byte 10 = GCT flag + size.
    const b10 = head[10]!;
    const hasGCT = (b10 & 0x80) !== 0;
    const gctSize = hasGCT ? Math.pow(2, (b10 & 0x07) + 1) * 3 : 0;
    const idOffset = 10 + gctSize;
    const imgByte = head[idOffset]!;
    if (idOffset + 10 <= head.length && imgByte === 0x2c) return 'gif';
  }

  // RIFF....WEBP
  if (startsWith(head, RIFF_SIGNATURE) && startsWith(head, WEBP_SIGNATURE, 8)) return 'webp';

  // ....ftypavif / ....ftypavis
  if (startsWith(head, FTYP_SIGNATURE, 4)) {
    const brand = readAscii(head, 8);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }

  // SVG is text: it may start with an XML declaration, a comment or the root
  // element itself. Require the svg root tag with an xmlns attribute pointing
  // to the official SVG namespace.
  const text = new TextDecoder()
    .decode(head.subarray(0, Math.min(head.length, SNIFF_LENGTH)))
    .trimStart()
    .toLowerCase();

  // Find the <svg tag and check if it has the official SVG namespace.
  // Tolerate whitespace around the = sign and between xmlns and =.
  const svgTagMatch = text.match(/<svg[\s>][^>]*>/);
  if (svgTagMatch) {
    const svgTag = svgTagMatch[0];
    // Tolerate whitespace around = and between xmlns and =
    const svgNS = 'http://www.w3.org/2000/svg';
    const hasNs = (svgTag.match(/xmlns\s*=\s*["'](.*?)["']/)?.[1] === svgNS ||
                  svgTag.match(/xmlns:([^'"\s]*)\s*=\s*["'](.*?)["']/)?.[2] === svgNS);
    if (hasNs) return 'svg';
  }

  return null;
}
