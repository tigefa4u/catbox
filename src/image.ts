import { SaxesParser } from 'saxes';

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

/** Canonical uploaded-image keys: seven or eleven characters plus a supported extension. */
export const IMAGE_KEY_PATTERN = /^[a-z0-9]{7,11}\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** Build a storage key (`<id>.<ext>`) for an upload of the given format. */
export function buildImageKey(id: string, format: ImageFormat): string {
  return `${id}.${FORMAT_EXTENSIONS[format]}`;
}

/** Human readable list of the accepted formats. */
export const SUPPORTED_FORMATS_LABEL = 'PNG, JPEG, GIF, WebP, AVIF or SVG';

const PNG_SCAN_LENGTH = 4096;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

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
 * Identify an image format from a size-checked upload. Raster detection
 * recognizes container headers and does not decode or verify image pixels.
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
      const scanEnd = Math.min(head.length, PNG_SCAN_LENGTH);
      const view = new DataView(head.buffer, head.byteOffset, scanEnd);
      let offset = 8;
      while (offset + 12 <= scanEnd) {
        const chunkLen = view.getUint32(offset, false); // PNG stores chunk lengths in big-endian order.
        const next = offset + 12 + chunkLen;
        if (next <= offset || next > scanEnd) break;
        if (chunkLen === 0 && startsWith(head, PNG_IEND, offset + 4)) return 'png';
        offset = next;
      }
      // IEND not in window but IHDR is valid → treat as PNG.
      return 'png';
    }
  }

  // --- JPEG: walk length-prefixed header segments until a frame ---
  if (head.length >= 10 && head[0] === 0xff && head[1] === 0xd8) {
    let offset = 2;
    while (offset < head.length && head[offset] === 0xff) {
      do { offset++; } while (head[offset] === 0xff); // marker fill bytes
      const marker = head[offset++];
      if (marker === 0x01) continue; // TEM has no length field
      if (marker === undefined || marker === 0x00 || (marker >= 0xd0 && marker <= 0xda)) break;
      if (offset + 2 > head.length) break;
      const segLen = (head[offset]! << 8) | head[offset + 1]!;
      if (segLen < 2 || offset + segLen > head.length) break;
      if (JPEG_FRAME_MARKERS.has(marker)) {
        if (segLen < 11) return null;
        const components = head[offset + 7]!;
        return components > 0 && segLen === 8 + 3 * components ? 'jpeg' : null;
      }
      offset += segLen;
    }
    return null;
  }

  // --- GIF: walk extension sub-blocks to the first image descriptor ---
  if ((startsWith(head, GIF87_SIGNATURE) || startsWith(head, GIF89_SIGNATURE)) && head.length >= 13) {
    const colorTableSize = (flags: number) => (flags & 0x80) ? 3 * (2 ** ((flags & 7) + 1)) : 0;
    let offset = 13 + colorTableSize(head[10]!);
    while (offset < head.length) {
      const blockType = head[offset];
      if (blockType === 0x2c) {
        if (offset + 10 > head.length) return null;
        const tableSize = colorTableSize(head[offset + 9]!);
        return offset + 10 + tableSize < head.length ? 'gif' : null;
      }
      if (blockType !== 0x21) return null;
      offset += 2; // extension introducer and label
      for (;;) {
        if (offset >= head.length) return null;
        const subLen = head[offset++]!;
        if (subLen === 0) break;
        if (offset + subLen > head.length) return null;
        offset += subLen;
      }
    }
    return null;
  }

  // --- WebP ---
  if (startsWith(head, RIFF_SIGNATURE) && startsWith(head, WEBP_SIGNATURE, 8)) return 'webp';

  // --- AVIF ---
  if (startsWith(head, FTYP_SIGNATURE, 4)) {
    const brand = readAscii(head, 8);
    if (brand === 'avif' || brand === 'avis') return 'avif';
  }

  // --- SVG: resolve the document root, not a descendant or a declaration in isolation ---
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(head);
    if (!text.trimStart().startsWith('<')) return null;

    let rootIsSvg: boolean | undefined;
    // Saxes checks XML syntax and namespaces without resolving external resources.
    const parser = new SaxesParser({ xmlns: true });
    parser.on('opentag', (tag) => {
      rootIsSvg ??= tag.local === 'svg' && tag.uri === SVG_NAMESPACE;
    });
    parser.write(text).close();
    return rootIsSvg ? 'svg' : null;
  } catch {
    return null; // not UTF-8 or not well-formed XML
  }
}
