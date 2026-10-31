import type { Theme } from './themes';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, UPLOAD_FIELD_NAME } from './constants';
import { SUPPORTED_FORMATS_LABEL } from './image';
import { buildCopyFormats, escapeHtml } from './format';

/** Render the `<link>` tags for a theme's vendor stylesheets. */
function renderVendorStylesheets(theme: Theme): string {
  return theme.stylesheets
    .map((href, index) => {
      const integrity = theme.integrity[index];
      const integrityAttr = integrity ? ` integrity="${escapeHtml(integrity)}"` : '';
      return `  <link rel="stylesheet" href="${escapeHtml(href)}"${integrityAttr} crossorigin="anonymous">`;
    })
    .join('\n');
}

/** Options for {@link renderHome}. */
export interface HomeOptions {
  /** Theme to render the page with. */
  theme: Theme;
  /** All themes, used to populate the switcher. */
  themes: readonly Theme[];
  /** Absolute origin of the request, used in the API example. */
  origin: string;
}

/** Render the upload page. */
export function renderHome({ theme, themes, origin }: HomeOptions): string {
  const themeOptions = themes
    .map(
      (candidate) =>
        `        <option value="${escapeHtml(candidate.id)}"${candidate.id === theme.id ? ' selected' : ''}>${escapeHtml(candidate.label)}</option>`,
    )
    .join('\n');

  const preconnect =
    theme.stylesheets.length > 0
      ? `  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n`
      : '';

  const vendorStylesheets = renderVendorStylesheets(theme);

  return `<!DOCTYPE html>
<html lang="en" data-theme="${escapeHtml(theme.id)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Catbox — free image hosting</title>
  <meta name="description" content="Upload an image and get a permanent link. The cutest free file host you have ever seen.">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
${preconnect}${vendorStylesheets}${vendorStylesheets ? '\n' : ''}  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/themes.css">
</head>
<body>
  <div class="cb-shell">
    <header class="cb-header">
      <div class="cb-brand">
        <svg class="cb-logo" viewBox="0 0 64 64" role="img" aria-label="Catbox logo" focusable="false">
          <path d="M12 18 20 6l12 8h20l-12-8 12-8 8 12v30a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
          <circle cx="25" cy="32" r="3" fill="currentColor"/>
          <circle cx="39" cy="32" r="3" fill="currentColor"/>
          <path d="M25 41h14" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        </svg>
        <div>
          <p class="cb-brand-name">catbox</p>
          <p class="cb-tagline">The cutest free file host you've ever seen.</p>
        </div>
      </div>
      <form class="cb-theme-form" method="get" action="/">
        <label class="cb-theme-label" for="cb-theme">Theme</label>
        <select class="cb-select" id="cb-theme" name="theme" data-theme-select>
${themeOptions}
        </select>
        <noscript><button class="cb-btn" type="submit">Apply</button></noscript>
      </form>
    </header>

    <main>
      <section class="cb-card">
        <h1 class="cb-title">Upload an image</h1>
        <p class="cb-subtitle">Up to ${escapeHtml(MAX_UPLOAD_LABEL)} per file. ${escapeHtml(SUPPORTED_FORMATS_LABEL)} are welcome.</p>

        <form class="cb-upload-form" id="cb-upload-form" method="post" action="/upload" enctype="multipart/form-data" data-max-size="${MAX_UPLOAD_BYTES}" data-field-name="${escapeHtml(UPLOAD_FIELD_NAME)}">
          <label class="cb-dropzone" for="cb-file" data-dropzone>
            <svg class="cb-dropzone-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 16V4m0 0L8 8m4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span class="cb-dropzone-title">Drop an image here</span>
            <span class="cb-dropzone-hint">or click to choose a file</span>
            <input class="cb-file-input" type="file" id="cb-file" name="${escapeHtml(UPLOAD_FIELD_NAME)}" accept="image/*" required>
          </label>

          <button class="cb-btn cb-btn-primary" type="submit" id="cb-submit">Upload</button>
        </form>

        <div class="cb-progress" id="cb-progress" hidden>
          <div class="cb-progress-track" role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" data-progress-bar>
            <div class="cb-progress-bar" data-progress-fill></div>
          </div>
          <p class="cb-progress-label" data-progress-label>Uploading…</p>
        </div>

        <div class="cb-result" id="cb-result" hidden>
          <img class="cb-result-preview" id="cb-preview" alt="Uploaded image preview" hidden>
          <div class="cb-result-body">
            <p class="cb-result-label">Your image is ready</p>
            <a class="cb-result-url" id="cb-result-url" href="#" target="_blank" rel="noopener noreferrer"></a>

            <div class="cb-copy" data-copy-box>
              <div class="cb-copy-tabs nav nav-tabs" role="tablist" aria-label="Copy format">
                <button class="cb-copy-tab nav-link active" type="button" role="tab" id="cb-tab-link" aria-selected="true" aria-controls="cb-copy-panel" data-copy-format="link">Link</button>
                <button class="cb-copy-tab nav-link" type="button" role="tab" id="cb-tab-markdown" aria-selected="false" aria-controls="cb-copy-panel" tabindex="-1" data-copy-format="markdown">Markdown</button>
                <button class="cb-copy-tab nav-link" type="button" role="tab" id="cb-tab-html" aria-selected="false" aria-controls="cb-copy-panel" tabindex="-1" data-copy-format="html">HTML</button>
                <button class="cb-copy-tab nav-link" type="button" role="tab" id="cb-tab-bbcode" aria-selected="false" aria-controls="cb-copy-panel" tabindex="-1" data-copy-format="bbcode">BBCode</button>
              </div>
              <div class="cb-copy-panel input-group" id="cb-copy-panel" role="tabpanel" aria-labelledby="cb-tab-link" tabindex="0">
                <input class="cb-copy-input form-control" type="text" id="cb-copy-input" readonly spellcheck="false" aria-label="Value to copy">
                <button class="cb-copy-button btn btn-primary" type="button" id="cb-copy">Copy</button>
              </div>
              <p class="cb-copy-status" id="cb-copy-status" role="status" aria-live="polite"></p>
            </div>
          </div>
        </div>
      </section>

      <section class="cb-card cb-api">
        <h2 class="cb-heading">API</h2>
        <p class="cb-subtitle">POST an image as <code>${escapeHtml(UPLOAD_FIELD_NAME)}</code> and receive a JSON body with the permanent URL.</p>
        <pre class="cb-code"><code>curl -F "${escapeHtml(UPLOAD_FIELD_NAME)}=@cat.png" ${escapeHtml(origin)}/upload</code></pre>
      </section>
    </main>

    <footer class="cb-footer">
      <p>Catbox runs on Cloudflare Workers and R2.</p>
    </footer>
  </div>

  <!-- Bootstrap compatible modal. The Bootstrap bundle is not loaded, so
       app.js drives the open/close behaviour itself. -->
  <div class="modal fade cb-modal" id="cb-modal" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="cb-modal-title" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title h5" id="cb-modal-title">Upload failed</h2>
          <button type="button" class="btn-close" data-modal-dismiss aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <p class="cb-modal-message" id="cb-modal-message"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-modal-dismiss>Close</button>
        </div>
      </div>
    </div>
  </div>
  <div class="modal-backdrop fade cb-modal-backdrop" id="cb-modal-backdrop"></div>

  <script src="/js/app.js" defer></script>
</body>
</html>
`;
}

/** Render the minimal HTML page shown after a no-JavaScript upload. */
export function renderUploadResult(url: string, name: string, theme: Theme): string {
  const safeUrl = escapeHtml(url);
  const formats = buildCopyFormats(url, name);
  const rows = (['link', 'markdown', 'html', 'bbcode'] as const)
    .map(
      (key) => `        <div class="cb-copy-static">
          <span class="cb-copy-static-label">${key}</span>
          <code class="cb-copy-static-value">${escapeHtml(formats[key])}</code>
        </div>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en" data-theme="${escapeHtml(theme.id)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Catbox — upload complete</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/app.css">
  <link rel="stylesheet" href="/css/themes.css">
</head>
<body>
  <div class="cb-shell">
    <main>
      <section class="cb-card">
        <h1 class="cb-title">Upload complete</h1>
        <p class="cb-subtitle">Your image is ready.</p>
        <p><a class="cb-result-url" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a></p>
        <div class="cb-copy-static-list">
${rows}
        </div>
        <p><a class="cb-btn" href="/">Upload another</a></p>
      </section>
    </main>
  </div>
</body>
</html>
`;
}
