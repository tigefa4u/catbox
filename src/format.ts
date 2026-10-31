/**
 * Copy formats for an uploaded image.
 *
 * The same four representations are offered in the browser (see
 * `public/js/app.js`) and in the no-JavaScript result page, so the markup
 * and the server render stay in sync.
 */

/** Replacement table for {@link escapeHtml}. */
const HTML_ESCAPES: Record<string, string> = {
  '\u0026': '\u0026amp;',
  '\u003C': '\u0026lt;',
  '\u003E': '\u0026gt;',
  '\u0022': '\u0026quot;',
  '\u0027': '\u0026#39;',
};

/** Escape a value for safe interpolation into HTML text or attributes. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Escape a value so it can be used as a Markdown link label.
 * Brackets would terminate the label early, backslashes escape characters.
 */
export function escapeMarkdownLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The four ways an uploaded image can be copied. */
export interface CopyFormats {
  /** The bare URL. */
  link: string;
  /** A Markdown image. */
  markdown: string;
  /** An HTML image tag. */
  html: string;
  /** A BBCode image tag. */
  bbcode: string;
}

/**
 * Build the copy formats for an uploaded image.
 *
 * @param url Public URL of the uploaded image.
 * @param name Original file name, used as the alt text.
 */
export function buildCopyFormats(url: string, name: string): CopyFormats {
  const safeUrl = escapeHtml(url);
  const safeName = escapeHtml(name);
  const label = escapeMarkdownLabel(name);

  return {
    link: url,
    markdown: `![${label}](${url})`,
    html: `<img src="${safeUrl}" alt="${safeName}">`,
    bbcode: `[img]${url}[/img]`,
  };
}
