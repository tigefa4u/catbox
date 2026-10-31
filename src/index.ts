// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, UPLOAD_FIELD_NAME } from './constants';
import {
  FORMAT_EXTENSIONS,
  FORMAT_MIME_TYPES,
  SNIFF_LENGTH,
  SUPPORTED_FORMATS_LABEL,
  detectImageFormat,
} from './image';
import { DEFAULT_THEME, THEMES, THEME_COOKIE, getTheme, isThemeId } from './themes';
import { renderHome, renderUploadResult } from './ui';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a short, random, URL‑safe identifier.
 * Catbox uses [a-z0-9]{6}; we use 7 characters as requested.
 * Collision probability is negligible (36^7 ≈ 78 billion combinations).
 */
function generateId(length = 7): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  // crypto.getRandomValues is cryptographically secure and available in Workers.
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  let id = '';
  for (const value of randomValues) {
    id += chars.charAt(value % chars.length);
  }
  return id;
}

/** Parses the `catbox_theme` cookie into a known theme id. */
function readThemeCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== THEME_COOKIE) continue;

    const value = decodeURIComponent(rest.join('='));
    return isThemeId(value) ? value : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// App & Middleware
// ---------------------------------------------------------------------------
const app = new Hono<{ Bindings: Env }>();

// Enable CORS for the upload endpoint (public API).
app.use('/upload', cors());

// Security headers for all responses.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

// ---------------------------------------------------------------------------
// Home Endpoint: GET /
// ---------------------------------------------------------------------------
app.get('/', (c) => {
  // ?theme= is a one-shot setter: it stores the choice and redirects to the
  // canonical URL so the cookie stays the single source of truth.
  const requestedTheme = c.req.query('theme');
  if (isThemeId(requestedTheme)) {
    c.header('Set-Cookie', `${THEME_COOKIE}=${requestedTheme}; Path=/; Max-Age=31536000; SameSite=Lax`);
    return c.redirect('/', 302);
  }

  const themeId = readThemeCookie(c.req.header('cookie')) ?? DEFAULT_THEME;
  const theme = getTheme(themeId);
  const html = renderHome({
    theme,
    themes: THEMES,
    origin: new URL(c.req.url).origin,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    // The rendered page varies by theme, so it must not be cached blindly.
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': [
      "default-src 'self'",
      "style-src 'self' https://cdn.jsdelivr.net",
      "script-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };

  return new Response(html, { headers });
});

// ---------------------------------------------------------------------------
// Upload Endpoint: POST /upload
// ---------------------------------------------------------------------------
app.post('/upload', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get(UPLOAD_FIELD_NAME) as File | null;

    // 1. Validate presence of file.
    if (!file) {
      return c.json({ error: `No file provided. Use the "${UPLOAD_FIELD_NAME}" field.` }, 400);
    }

    // 2. Size limit (10 MiB).
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: `File too large. Maximum size is ${MAX_UPLOAD_LABEL}.` }, 413);
    }

    // 3. Sniff the real image format from the magic bytes. The browser
    //    supplied MIME type is only a hint: a file can be renamed to .png or
    //    claim image/png while actually holding something else entirely.
    const head = new Uint8Array(await file.slice(0, SNIFF_LENGTH).arrayBuffer());
    const format = detectImageFormat(head);

    if (!format) {
      return c.json(
        {
          error: `That file is not a valid ${SUPPORTED_FORMATS_LABEL} image.`,
        },
        415,
      );
    }

    // 4. Generate a unique 7-character key with the canonical extension.
    const extension = FORMAT_EXTENSIONS[format];
    const contentType = FORMAT_MIME_TYPES[format];
    const key = `${generateId(7)}${extension}`;

    // 5. Store in R2 with metadata.
    await c.env.IMAGES.put(key, file.stream(), {
      httpMetadata: {
        contentType,
        // Optional: set a long cache‑control for immutable content.
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    // 6. Build the public URL.
    const url = new URL(c.req.url);
    const publicUrl = `${url.origin}/${key}`;

    console.log(
      JSON.stringify({
        message: 'image uploaded',
        key,
        bytes: file.size,
        contentType,
        format,
      }),
    );

    // 7. Return the URL. Browsers posting a plain form get HTML back,
    //    API clients get JSON.
    const accepts = c.req.header('accept') ?? '';
    if (accepts.includes('text/html')) {
      const theme = getTheme(readThemeCookie(c.req.header('cookie')) ?? DEFAULT_THEME);
      return new Response(renderUploadResult(publicUrl, file.name, theme), {
        status: 201,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': [
            "default-src 'self'",
            "style-src 'self' https://cdn.jsdelivr.net",
            "script-src 'self'",
            "img-src 'self' data:",
            "base-uri 'none'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; '),
        },
      });
    }

    return c.json({ url: publicUrl, name: file.name }, 201);
  } catch (err) {
    console.error(
      JSON.stringify({
        message: 'upload failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json({ error: 'Internal server error.' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Serve Endpoint: GET /:filename
// ---------------------------------------------------------------------------
app.get('/:filename', async (c) => {
  const filename = c.req.param('filename');

  // Basic sanity check – prevent directory traversal.
  if (!/^[a-z0-9]{7}\.[a-z0-9]+$/i.test(filename)) {
    return c.text('Not found', 404);
  }

  try {
    const object = await c.env.IMAGES.get(filename);
    if (!object) {
      return c.text('Not found', 404);
    }

    // Stream the object back with appropriate headers.
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    // Aggressive caching for immutable images.
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    // Uploaded files are user supplied. Sandboxing them means an uploaded
    // SVG cannot run scripts or load external resources when opened directly.
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

    return new Response(object.body, { headers });
  } catch (err) {
    console.error(
      JSON.stringify({
        message: 'serve failed',
        filename,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.text('Internal server error', 500);
  }
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export default app;
