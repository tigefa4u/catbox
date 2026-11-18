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
    // Validate IHDR chunk: 4 bytes length + 4 bytes type + 13 bytes data + 4 bytes CRC.
    // Chunk length at offset 8-11 must be 13 (0x0000000D), type at 12-15 must be IHDR.
    if (head.length >= 33 &&
        (head[8] === 0x00 && head[9] === 0x00 && head[10] === 0x00 && head[11] === 0x0d) &&
        startsWith(head, PNG_IHDR, 12)) return 'png';
  }
  // JPEG: verify SOI (FF D8) + scan segments for SOFx marker (FF C0-C3).
  // Accept any JPEG with valid segment structure, regardless of APP0/JFIF/EXIF.
  if (head.length >= 10 && head[0] === 0xff && head[1] === 0xd8) {
    let offset = 2;
    while (offset < head.length - 1) {
      if (head[offset] !== 0xff) break;
      if (head[offset + 1] === 0x00) { offset += 2; continue; } // stuffing
      const marker = head[offset + 1]!;
      if (marker >= 0xc0 && marker <= 0xc3) return 'jpeg'; // SOF0-SOF3
      if (marker === 0xd9 || marker === 0xd8 || marker === 0xda || marker === 0xac) break;
      if (offset + 3 >= head.length) break;
      const segLen = (head[offset + 2]! << 8) | head[offset + 3]!;
      if (segLen < 2) break;
      offset += 2 + segLen;
    }
  }
  // GIF: parse block sequence after LSD.  Extension blocks (0x21) may appear
  // before the first image descriptor (0x2c).  Scan past them.
  if ((startsWith(head, GIF87_SIGNATURE) || startsWith(head, GIF89_SIGNATURE)) && head.length >= 22) {
    const b10 = head[10]!;
    const hasGCT = (b10 & 0x80) !== 0;
    const gctSize = hasGCT ? Math.pow(2, (b10 & 0x07) + 1) * 3 : 0;
    let offset = 13 + gctSize; // LSD ends at 12, GCT starts at 13
    while (offset < head.length) {
      if (head[offset] === 0x3b) break; // trailer
      if (head[offset] === 0x2c) return 'gif'; // image descriptor
      if (head[offset] === 0x21) {
        // Extension block: skip introducer + label + all sub-blocks.
        offset += 2; // skip introducer (0x21) and label byte
        while (offset < head.length) {
          if (head[offset] === 0x00) { offset++; break; } // terminator → done
          const subLen = head[offset]!;
          offset += 1 + subLen; // skip size + data
        }
      } else {
        break; // unexpected block
      }
    }
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
