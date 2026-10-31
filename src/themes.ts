/**
 * Theme registry.
 *
 * A theme is a set of CSS custom properties plus optional vendor stylesheets.
 * The Worker renders the markup with the active theme already applied, so the
 * first paint is correct and no flash-of-wrong-theme occurs.
 */

/** Theme identifier persisted in the `catbox_theme` cookie. */
export type ThemeId = 'classic' | 'dark' | 'bootstrap';

export interface Theme {
  /** Stable identifier, also used in the cookie and the `?theme=` query. */
  id: ThemeId;
  /** Human readable name shown in the theme switcher. */
  label: string;
  /** Short description shown under the label. */
  description: string;
  /** Vendor stylesheets that must be loaded for this theme. */
  stylesheets: string[];
  /** `integrity` hashes for the vendor stylesheets, in the same order. */
  integrity: string[];
}

/**
 * Bootstrap 5.3.3 stylesheet, pinned with a Subresource Integrity hash so a
 * compromised CDN cannot inject styles into the page.
 */
const BOOTSTRAP_CSS =
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';

const BOOTSTRAP_SRI =
  'sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH';

export const THEMES: readonly Theme[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'The original Catbox look.',
    stylesheets: [],
    integrity: [],
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Late night, low light.',
    stylesheets: [],
    integrity: [],
  },
  {
    id: 'bootstrap',
    label: 'Bootstrap',
    description: 'Powered by Bootstrap 5.',
    stylesheets: [BOOTSTRAP_CSS],
    integrity: [BOOTSTRAP_SRI],
  },
] as const;

export const DEFAULT_THEME: ThemeId = 'classic';

export const THEME_COOKIE = 'catbox_theme';

/** Narrow an arbitrary string to a known theme id. */
export function isThemeId(value: string | undefined | null): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

/** Look up a theme by id, falling back to the default theme. */
export function getTheme(id: string | undefined | null): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0]!;
}
