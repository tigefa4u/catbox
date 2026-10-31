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

    let value: string;
    try {
      value = decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }

    return isThemeId(value) ? value : null;
  }

  return null;
}

/**
 * Maximum size of the multipart envelope: the 10 MiB file plus room for
 * boundaries and part headers. Enforced while the body is read so an
 * oversized request is rejected without first buffering it in the isolate.
 */
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 256 * 1024;

const TOO_LARGE_ERROR = `File too large. Maximum size is ${MAX_UPLOAD_LABEL}.`;

type UploadParseResult =
  | { ok: true; file: File }
  | { ok: false; status: 400 | 413 | 415; error: string };

/**
 * Parse the upload form with a hard byte cap.
 *
 * `request.formData()` reads the whole body before the caller can inspect
 * `file.size`, so a large request would be buffered first and only rejected
 * afterwards. The body is piped through a counting stream instead, keeping
 * the memory cost close to the 10 MiB limit even for chunked requests that
 * omit `Content-Length`.
 */
async function parseUpload(request: Request): Promise<UploadParseResult> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return { ok: false, status: 415, error: 'Expected a multipart/form-data upload.' };
  }

  // Let honest clients fail before any bytes are read.
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
    return { ok: false, status: 413, error: TOO_LARGE_ERROR };
  }

  if (!request.body) {
    return { ok: false, status: 400, error: 'Missing request body.' };
  }

  let received = 0;
  let exceeded = false;
  const boundedBody = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_MULTIPART_BYTES) {
          exceeded = true;
          controller.error(new Error('upload body exceeds limit'));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  let formData: FormData;
  try {
    formData = await new Response(boundedBody, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    return exceeded
      ? { ok: false, status: 413, error: TOO_LARGE_ERROR }
      : { ok: false, status: 400, error: 'Malformed multipart/form-data body.' };
  }

  const file = formData.get(UPLOAD_FIELD_NAME);

  // `FormData.get()` yields a plain string when the client posts a text part
  // under this name instead of a file part, so the value has to be narrowed
  // before it is treated as a file.
  if (!file || typeof file === 'string') {
    return {
      ok: false,
      status: 400,
      error: `No file provided. Use the "${UPLOAD_FIELD_NAME}" field.`,
    };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, status: 413, error: TOO_LARGE_ERROR };
  }

  return { ok: true, file };
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
    // The rendered page varies by theme cookie, so it must not be stored by
    // intermediary caches (Workers Caching is enabled for this Worker).
    'Cache-Control': 'no-store',
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
  // Anonymous uploads are rate limited per client. The binding is
  // approximate and per Cloudflare location; a WAF rule can add a stricter
  // edge-wide limit if needed.
  const rateLimitKey = c.req.header('cf-connecting-ip') ?? 'unknown';
  const { success } = await c.env.UPLOAD_RATE_LIMITER.limit({ key: rateLimitKey });
  if (!success) {
    c.header('Retry-After', '60');
    console.warn(JSON.stringify({ message: 'upload rate limited' }));
    return c.json({ error: 'Too many uploads. Please try again shortly.' }, 429);
  }

  try {
    const parsed = await parseUpload(c.req.raw);
    if (!parsed.ok) {
      return c.json({ error: parsed.error }, parsed.status);
    }

    const { file } = parsed;

    // 1. Sniff the real image format from the magic bytes. The browser
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

    // 2. Generate a unique 7-character key with the canonical extension.
    const extension = FORMAT_EXTENSIONS[format];
    const contentType = FORMAT_MIME_TYPES[format];
    const key = `${generateId(7)}${extension}`;

    // 3. Store in R2 with metadata.
    await c.env.IMAGES.put(key, file.stream(), {
      httpMetadata: {
        contentType,
        // Optional: set a long cache‑control for immutable content.
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    // 4. Build the public URL.
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

    // 5. Return the URL. Browsers posting a plain form get HTML back,
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
