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

          <button class="cb-btn cb-btn-primary" type="submit" id="cb-submit">
            <svg class="cb-button-icon" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5"/>
              <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708z"/>
            </svg>
            <span>Upload</span>
          </button>
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
  </div>

  <footer class="cb-footer">
    <div class="cb-footer-inner">
      <div class="cb-footer-about">
        <p>Catbox is an image host powered by Cloudflare Workers and R2.</p>
        <p>© 2026 Catbox. Released under the MIT License.</p>
      </div>
      <div class="cb-footer-meta">
        <a class="cb-footer-link cb-footer-source" href="https://github.com/tigefa4u/catbox" target="_blank" rel="noopener noreferrer">
          <svg class="cb-footer-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/>
          </svg>
          <span>Source on GitHub</span>
        </a>
        <div class="cb-footer-hosted">
          <span>Proudly hosted by</span>
          <a class="cb-footer-link cb-footer-cloudflare" href="https://www.cloudflare.com/" target="_blank" rel="noopener noreferrer">
            <svg class="cb-footer-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727"/>
            </svg>
            <span>Cloudflare</span>
          </a>
        </div>
      </div>
    </div>
  </footer>

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
  // The result page is themed too, so it has to load the theme's vendor
  // stylesheets exactly like renderHome does. Without them the Bootstrap
  // theme silently drops every `--bs-*` variable and every Bootstrap
  // component class on this page.
  const preconnect =
    theme.stylesheets.length > 0
      ? `  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n`
      : '';
  const vendorStylesheets = renderVendorStylesheets(theme);
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
  ${preconnect}${vendorStylesheets}${vendorStylesheets ? '\n' : ''}  <link rel="stylesheet" href="/css/app.css">
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
