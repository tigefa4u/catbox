/* Catbox — client-side bulk upload queue, copy formats, error modal and
   theme switching. */
(function () {
  'use strict';

  var form = document.getElementById('cb-upload-form');
  var dropzone = document.querySelector('[data-dropzone]');
  var fileInput = document.getElementById('cb-file');
  var submitButton = document.getElementById('cb-submit');
  var submitLabel = submitButton
    ? submitButton.querySelector('[data-submit-label]')
    : null;
  var progress = document.getElementById('cb-progress');
  var progressBar = document.querySelector('[data-progress-bar]');
  var progressFill = document.querySelector('[data-progress-fill]');
  var progressLabel = document.querySelector('[data-progress-label]');

  var queueRoot = document.getElementById('cb-queue');
  var queueSummary = document.getElementById('cb-queue-summary');
  var fileList = document.getElementById('cb-file-list');
  var copyFormatSelect = document.getElementById('cb-copy-format');
  var copyAllButton = document.getElementById('cb-copy-all');
  var clearButton = document.getElementById('cb-clear');
  var copyStatus = document.getElementById('cb-copy-status');

  /* -------------------------------------------------------------- modal */

  var modal = document.getElementById('cb-modal');
  var modalBackdrop = document.getElementById('cb-modal-backdrop');
  var modalMessage = document.getElementById('cb-modal-message');
  var modalTitle = document.getElementById('cb-modal-title');
  var lastFocusedElement = null;

  var maxSize = form ? parseInt(form.dataset.maxSize, 10) || 0 : 0;
  var fieldName = form ? form.dataset.fieldName || 'fileToUpload' : 'fileToUpload';

  /* Two uploads in flight and one start every 550 ms keeps a browser tab
     under the server's 120 uploads/minute limit. */
  var MAX_CONCURRENT = 2;
  var MIN_START_INTERVAL_MS = 550;
  var MAX_ATTEMPTS = 5;
  var MAX_QUEUE_ITEMS = 500;

  var items = [];
  var nextItemId = 1;
  var activeCount = 0;
  var running = false;
  var pausedUntil = 0;
  var rateLimitedUntil = 0;
  var lastStartAt = 0;
  var pumpTimer = null;
  var pauseTicker = null;
  var copyStatusTimer = null;

  /* ------------------------------------------------------------ helpers */

  /* HTML entity escapes, built from code points so the source stays free of
     literal entities. */
  var HTML_ESCAPES = {
    '\u0026': '\u0026amp;',
    '\u003C': '\u0026lt;',
    '\u003E': '\u0026gt;',
    '\u0022': '\u0026quot;',
    '\u0027': '\u0026#39;',
  };

  function escapeHtml(value) {
    return String(value).replace(
      /[\u0026\u003C\u003E\u0022\u0027]/g,
      function (char) {
        return HTML_ESCAPES[char] || char;
      },
    );
  }

  function escapeMarkdownLabel(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Build the four copy representations of an uploaded image.
   * Mirrors `buildCopyFormats` in src/format.ts.
   */
  function buildCopyFormats(url, name) {
    var safeUrl = escapeHtml(url);
    var safeName = escapeHtml(name);
    var label = escapeMarkdownLabel(name);

    return {
      link: url,
      markdown: '![' + label + '](' + url + ')',
      html: '<img src="' + safeUrl + '" alt="' + safeName + '">',
      bbcode: '[img]' + url + '[/img]',
    };
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MiB';
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (err) {
      return null;
    }
  }

  function looksLikeImage(file) {
    return (
      (file.type && file.type.indexOf('image/') === 0) ||
      /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(file.name || '')
    );
  }

  function createPreviewUrl(file) {
    if (typeof URL === 'undefined' || !URL.createObjectURL) return '';
    try {
      return URL.createObjectURL(file);
    } catch (err) {
      return '';
    }
  }

  function revokePreviewUrl(item) {
    if (!item || !item.previewUrl) return;
    try {
      URL.revokeObjectURL(item.previewUrl);
    } catch (err) {
      /* Ignore: the URL is already gone. */
    }
    item.previewUrl = '';
  }

  function countByStatus(status) {
    var count = 0;
    for (var index = 0; index < items.length; index++) {
      if (items[index].status === status) count++;
    }
    return count;
  }

  function nextPendingItem() {
    for (var index = 0; index < items.length; index++) {
      if (items[index].status === 'pending') return items[index];
    }
    return null;
  }

  /* --------------------------------------------------------- modal logic */

  function focusableIn(container) {
    if (!container) return [];

    var selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    return Array.prototype.slice
      .call(container.querySelectorAll(selector))
      .filter(function (element) {
        return element.getClientRects().length > 0;
      });
  }

  function openModal(title, message) {
    if (!modal) return;

    if (modalTitle) modalTitle.textContent = title;
    if (modalMessage) modalMessage.textContent = message;

    lastFocusedElement = document.activeElement;

    // Make the dialog visible first, then flip `show` on the next frame so
    // Bootstrap's fade transition actually runs.
    modal.classList.add('cb-modal-visible');
    if (modalBackdrop) modalBackdrop.classList.add('cb-modal-visible');

    window.requestAnimationFrame(function () {
      modal.classList.add('show');
      if (modalBackdrop) modalBackdrop.classList.add('show');
    });

    modal.setAttribute('aria-hidden', 'false');

    document.body.classList.add('cb-modal-open');

    var focusTargets = focusableIn(modal);
    if (focusTargets.length) {
      focusTargets[0].focus();
    } else if (modal.focus) {
      modal.focus();
    }
  }

  function closeModal() {
    if (!modal || !modal.classList.contains('cb-modal-visible')) return;

    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');

    if (modalBackdrop) modalBackdrop.classList.remove('show');

    document.body.classList.remove('cb-modal-open');

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;

    // Hide the dialog once the fade-out has finished.
    window.setTimeout(function () {
      if (modal.classList.contains('show')) return;
      modal.classList.remove('cb-modal-visible');
      if (modalBackdrop) modalBackdrop.classList.remove('cb-modal-visible');
    }, 200);
  }

  function showError(message, title) {
    openModal(title || 'Upload failed', message);
  }

  if (modal) {
    // Close via the X button and the footer button.
    Array.prototype.slice
      .call(modal.querySelectorAll('[data-modal-dismiss]'))
      .forEach(function (button) {
        button.addEventListener('click', closeModal);
      });

    // Clicking the backdrop closes the dialog.
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', closeModal);
    }

    // Clicking the dimmed area outside the dialog closes it too.
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeModal();
    });

    // Escape closes the dialog.
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && modal.classList.contains('cb-modal-visible')) {
        closeModal();
        return;
      }

      // Keep focus inside the dialog while it is open.
      if (event.key !== 'Tab' || !modal.classList.contains('cb-modal-visible')) {
        return;
      }

      var focusTargets = focusableIn(modal);
      if (!focusTargets.length) return;

      var first = focusTargets[0];
      var last = focusTargets[focusTargets.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  /* ------------------------------------------------------- queue rendering */

  function renderRow(item) {
    var li = document.createElement('li');
    li.className = 'cb-file cb-file-pending';
    li.dataset.id = String(item.id);

    var thumb = document.createElement('img');
    thumb.className = 'cb-file-thumb';
    thumb.alt = '';
    thumb.decoding = 'async';
    thumb.loading = 'lazy';
    thumb.src = item.previewUrl || '/favicon.svg';

    var info = document.createElement('div');
    info.className = 'cb-file-info';

    var name = document.createElement('p');
    name.className = 'cb-file-name';
    name.textContent = item.name;
    name.title = item.name;

    var status = document.createElement('p');
    status.className = 'cb-file-status';

    var track = document.createElement('div');
    track.className = 'cb-file-track';
    track.hidden = true;
    var fill = document.createElement('div');
    fill.className = 'cb-file-fill';
    track.appendChild(fill);

    info.appendChild(name);
    info.appendChild(status);
    info.appendChild(track);

    var actions = document.createElement('div');
    actions.className = 'cb-file-actions';

    var open = document.createElement('a');
    open.className = 'cb-file-open';
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Open';
    open.hidden = true;

    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cb-btn cb-btn-sm';
    copy.textContent = 'Copy';
    copy.hidden = true;

    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'cb-btn cb-btn-sm cb-btn-ghost';
    remove.textContent = 'Remove';
    remove.addEventListener('click', function () {
      removeItem(item);
    });

    copy.addEventListener('click', function () {
      copyItem(item, copy);
    });

    actions.appendChild(open);
    actions.appendChild(copy);
    actions.appendChild(remove);

    li.appendChild(thumb);
    li.appendChild(info);
    li.appendChild(actions);

    fileList.appendChild(li);

    item.el = {
      li: li,
      thumb: thumb,
      name: name,
      status: status,
      track: track,
      fill: fill,
      open: open,
      copy: copy,
      remove: remove,
    };

    updateRow(item);
  }

  function updateRow(item) {
    var el = item.el;
    if (!el) return;

    el.li.className = 'cb-file cb-file-' + item.status;
    el.li.setAttribute('aria-busy', item.status === 'uploading' ? 'true' : 'false');

    if (item.status === 'done') {
      el.thumb.src = item.url;
      el.status.textContent = 'Uploaded · ' + formatBytes(item.size);
      el.track.hidden = true;
      el.fill.style.width = '100%';
      el.open.href = item.url;
      el.open.hidden = false;
      el.copy.hidden = false;
      el.remove.hidden = true;
      return;
    }

    if (item.status === 'uploading') {
      el.status.textContent = 'Uploading… ' + Math.round(item.progress * 100) + '%';
      el.track.hidden = false;
      el.fill.style.width = item.progress * 100 + '%';
      el.open.hidden = true;
      el.copy.hidden = true;
      el.remove.hidden = true;
      return;
    }

    if (item.status === 'error') {
      el.status.textContent = item.error || 'Upload failed.';
      el.fill.style.width = '0%';
      el.open.hidden = true;
      el.copy.hidden = true;
      el.remove.hidden = false;
    } else {
      el.status.textContent = item.note || 'Ready to upload';
      el.fill.style.width = '0%';
      el.open.hidden = true;
      el.copy.hidden = true;
      el.remove.hidden = false;
    }

    el.track.hidden = true;
  }

  function updateRowProgress(item) {
    if (!item.el || item.status !== 'uploading') return;
    item.el.status.textContent = 'Uploading… ' + Math.round(item.progress * 100) + '%';
    item.el.fill.style.width = item.progress * 100 + '%';
  }

  function updateControls() {
    var pending = countByStatus('pending');
    var done = countByStatus('done');
    var failed = countByStatus('error');

    if (submitButton) {
      submitButton.disabled = running || pending === 0;
      if (submitLabel) {
        submitLabel.textContent = running
          ? 'Uploading…'
          : pending > 0
            ? 'Upload ' + plural(pending, 'image', 'images')
            : 'Upload';
      }
    }

    if (copyAllButton) copyAllButton.disabled = done === 0;
    if (clearButton) clearButton.disabled = done + failed === 0;
    if (queueRoot) queueRoot.hidden = items.length === 0;
  }

  function updateSummary() {
    if (!queueSummary) return;

    if (items.length === 0) {
      queueSummary.textContent = '';
      return;
    }

    var done = countByStatus('done');
    var failed = countByStatus('error');
    var pending = countByStatus('pending');
    var paused = Date.now() < pausedUntil;

    if (running && paused) {
      var retrySeconds = Math.ceil((pausedUntil - Date.now()) / 1000);
      queueSummary.textContent =
        Date.now() < rateLimitedUntil
          ? 'Rate limited — retrying in ' + retrySeconds + 's…'
          : 'Retrying in ' + retrySeconds + 's…';
      return;
    }

    if (running) {
      queueSummary.textContent =
        'Uploading ' +
        plural(done, 'image', 'images') +
        ' of ' +
        Math.max(0, items.length - failed) +
        '…';
      return;
    }

    var parts = [];
    if (pending > 0) parts.push(plural(pending, 'image', 'images') + ' ready');
    if (done > 0) parts.push(done + ' uploaded');
    if (failed > 0) parts.push(failed + ' failed');
    queueSummary.textContent = parts.length ? parts.join(' · ') + '.' : '';
  }

  function updateOverallProgress() {
    var totalBytes = 0;
    var loadedBytes = 0;
    var eligible = 0;
    var done = 0;

    for (var index = 0; index < items.length; index++) {
      var item = items[index];
      if (item.status === 'error') continue;

      eligible++;
      totalBytes += item.size;
      if (item.status === 'done') {
        loadedBytes += item.size;
        done++;
      } else if (item.status === 'uploading') {
        loadedBytes += item.size * item.progress;
      }
    }

    var percent =
      totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0;
    if (progressFill) progressFill.style.width = percent + '%';
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(percent));

    var paused = Date.now() < pausedUntil;
    var show = running && (activeCount > 0 || countByStatus('pending') > 0);
    if (progress) progress.hidden = !show;

    if (progressLabel && show) {
      if (paused) {
        var pauseSeconds = Math.ceil((pausedUntil - Date.now()) / 1000);
        progressLabel.textContent =
          Date.now() < rateLimitedUntil
            ? 'Rate limited — retrying in ' + pauseSeconds + 's…'
            : 'Retrying in ' + pauseSeconds + 's…';
      } else {
        progressLabel.textContent =
          'Uploaded ' + done + ' of ' + eligible + ' — ' + percent + '%';
      }
    }
  }

  /* ---------------------------------------------------------- queue input */

  function addFiles(list) {
    if (!list || !list.length) return;

    var remaining = MAX_QUEUE_ITEMS - items.length;
    if (remaining <= 0) {
      showError(
        'The queue is limited to ' +
          MAX_QUEUE_ITEMS +
          ' images. Clear finished uploads before adding more.',
        'Queue full',
      );
      return;
    }

    for (var index = 0; index < list.length && index < remaining; index++) {
      var file = list[index];
      if (!file) continue;

      var item = {
        id: nextItemId++,
        file: file,
        name: file.name || 'image',
        size: typeof file.size === 'number' ? file.size : 0,
        status: 'pending',
        progress: 0,
        attempts: 0,
        url: '',
        error: '',
        note: '',
        previewUrl: '',
        xhr: null,
        el: null,
      };

      if (!file.size) {
        item.status = 'error';
        item.error = 'The file is empty.';
      } else if (!looksLikeImage(file)) {
        item.status = 'error';
        item.error = 'Unsupported file type.';
      } else if (maxSize > 0 && file.size > maxSize) {
        item.status = 'error';
        item.error = 'Too large (max ' + formatBytes(maxSize) + ').';
      } else {
        item.previewUrl = createPreviewUrl(file);
      }

      items.push(item);
      renderRow(item);
    }

    if (fileInput) fileInput.value = '';
    if (queueRoot) queueRoot.hidden = false;

    updateControls();
    updateSummary();
    updateOverallProgress();

    if (list.length > remaining) {
      showError(
        'Only the first ' +
          remaining +
          ' files were added. The queue is limited to ' +
          MAX_QUEUE_ITEMS +
          ' images.',
        'Queue full',
      );
    }
  }

  function removeItem(item) {
    if (!item || item.status === 'uploading') return;

    revokePreviewUrl(item);

    if (item.el && item.el.li.parentNode) {
      item.el.li.parentNode.removeChild(item.el.li);
    }

    var index = items.indexOf(item);
    if (index !== -1) items.splice(index, 1);

    if (queueRoot) queueRoot.hidden = items.length === 0;
    updateControls();
    updateSummary();
    updateOverallProgress();

    if (running && activeCount === 0 && countByStatus('pending') === 0) {
      running = false;
      updateControls();
      updateSummary();
      updateOverallProgress();
    }
  }

  function clearFinished() {
    for (var index = items.length - 1; index >= 0; index--) {
      var item = items[index];
      if (item.status !== 'done' && item.status !== 'error') continue;

      revokePreviewUrl(item);
      if (item.el && item.el.li.parentNode) {
        item.el.li.parentNode.removeChild(item.el.li);
      }
      items.splice(index, 1);
    }

    if (queueRoot) queueRoot.hidden = items.length === 0;
    updateControls();
    updateSummary();
    updateOverallProgress();
    setCopyStatus('');
  }

  /* -------------------------------------------------------------- uploads */

  function startUploads() {
    if (running) return;

    if (countByStatus('pending') === 0) {
      showError('Choose at least one image to upload.', 'Nothing to upload');
      return;
    }

    running = true;
    lastStartAt = 0;
    updateControls();
    updateSummary();
    updateOverallProgress();
    pump();
  }

  function schedulePump(delay) {
    if (pumpTimer) return;
    pumpTimer = window.setTimeout(function () {
      pumpTimer = null;
      pump();
    }, Math.max(0, delay));
  }

  function startPauseTicker() {
    if (pauseTicker) return;
    pauseTicker = window.setInterval(function () {
      if (!running || Date.now() >= pausedUntil) {
        window.clearInterval(pauseTicker);
        pauseTicker = null;
      }
      updateSummary();
      updateOverallProgress();
    }, 1000);
  }

  function pump() {
    if (pumpTimer) {
      window.clearTimeout(pumpTimer);
      pumpTimer = null;
    }

    if (!running) return;
    if (activeCount >= MAX_CONCURRENT) return;

    var now = Date.now();
    if (now < pausedUntil) {
      startPauseTicker();
      schedulePump(pausedUntil - now);
      return;
    }

    var next = nextPendingItem();
    if (!next) {
      if (activeCount === 0) {
        running = false;
        updateControls();
        updateSummary();
        updateOverallProgress();
      }
      return;
    }

    var wait = lastStartAt + MIN_START_INTERVAL_MS - now;
    if (wait > 0) {
      schedulePump(wait);
      return;
    }

    lastStartAt = now;
    activeCount++;
    next.status = 'uploading';
    next.progress = 0;
    next.note = '';
    updateRow(next);
    updateControls();
    updateSummary();
    updateOverallProgress();
    sendItem(next);
  }

  function retryDelay(item, xhr, baseMs) {
    var header = xhr ? xhr.getResponseHeader('Retry-After') : null;
    var seconds = parseInt(header, 10);
    if (!isNaN(seconds) && seconds > 0) return Math.min(seconds * 1000, 120000);
    if (baseMs > 0) return baseMs;
    return Math.min(30000, 1000 * Math.pow(2, Math.min(item.attempts, 4)));
  }

  function retryLater(item, delay, message, rateLimited) {
    item.attempts++;

    if (item.attempts > MAX_ATTEMPTS) {
      failItem(item, message + ' Gave up after ' + MAX_ATTEMPTS + ' attempts.');
      return;
    }

    item.status = 'pending';
    item.progress = 0;
    item.error = '';
    item.note = 'Waiting to retry…';

    if (delay > 0) {
      var retryAt = Date.now() + delay;
      pausedUntil = Math.max(pausedUntil, retryAt);
      if (rateLimited) rateLimitedUntil = Math.max(rateLimitedUntil, retryAt);
      startPauseTicker();
    }

    completeItem(item);
  }

  function failItem(item, message) {
    item.status = 'error';
    item.error = message;
    item.progress = 0;
    item.note = '';
    completeItem(item);
  }

  function completeItem(item) {
    activeCount = Math.max(0, activeCount - 1);
    updateRow(item);
    updateControls();
    updateSummary();
    updateOverallProgress();
    pump();
  }

  function handleResponse(item, xhr) {
    var body = parseJson(xhr.responseText);

    if (xhr.status >= 200 && xhr.status < 300 && body && body.url) {
      item.status = 'done';
      item.url = body.url;
      item.name = body.name || item.name;
      item.progress = 1;
      item.error = '';
      item.note = '';
      revokePreviewUrl(item);
      completeItem(item);
      return;
    }

    var message =
      body && body.error ? body.error : 'Upload failed (HTTP ' + xhr.status + ').';

    if (xhr.status === 429) {
      retryLater(item, retryDelay(item, xhr, 10000), message, true);
    } else if (xhr.status >= 500 || xhr.status === 0) {
      retryLater(item, retryDelay(item, xhr, 0), message);
    } else {
      failItem(item, message);
    }
  }

  function sendItem(item) {
    var xhr = new XMLHttpRequest();
    item.xhr = xhr;
    xhr.open('POST', '/upload');
    xhr.setRequestHeader('Accept', 'application/json');

    xhr.upload.addEventListener('progress', function (event) {
      if (!event.lengthComputable) return;
      item.progress = event.total > 0 ? event.loaded / event.total : 0;
      updateRowProgress(item);
      updateOverallProgress();
    });

    xhr.addEventListener('load', function () {
      item.xhr = null;
      handleResponse(item, xhr);
    });

    xhr.addEventListener('error', function () {
      item.xhr = null;
      retryLater(item, retryDelay(item, null, 0), 'Network error while uploading.');
    });

    xhr.addEventListener('abort', function () {
      item.xhr = null;
      failItem(item, 'Upload cancelled.');
    });

    var data = new FormData();
    data.append(fieldName, item.file);
    xhr.send(data);
  }

  /* ---------------------------------------------------------------- copy */

  function copyFormat() {
    var value = copyFormatSelect ? copyFormatSelect.value : 'link';
    return value === 'markdown' || value === 'html' || value === 'bbcode'
      ? value
      : 'link';
  }

  function copyFormatLabel() {
    var labels = {
      link: 'a link',
      markdown: 'Markdown',
      html: 'HTML',
      bbcode: 'BBCode',
    };
    return labels[copyFormat()] || 'a link';
  }

  function formattedValue(item) {
    var formats = buildCopyFormats(item.url, item.name);
    return formats[copyFormat()] || item.url;
  }

  function setCopyStatus(message) {
    if (!copyStatus) return;
    copyStatus.textContent = message;

    if (copyStatusTimer) window.clearTimeout(copyStatusTimer);
    if (!message) {
      copyStatusTimer = null;
      return;
    }

    copyStatusTimer = window.setTimeout(function () {
      copyStatus.textContent = '';
      copyStatusTimer = null;
    }, 5000);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    // Fallback for browsers without the async clipboard API.
    return new Promise(function (resolve, reject) {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, text.length);

      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }

      document.body.removeChild(textarea);
      if (ok) resolve();
      else reject(new Error('Clipboard unavailable'));
    });
  }

  function copyItem(item, button) {
    if (item.status !== 'done' || !item.url) return;

    copyToClipboard(formattedValue(item)).then(
      function () {
        button.textContent = 'Copied';
        window.setTimeout(function () {
          button.textContent = 'Copy';
        }, 1500);
        setCopyStatus('Copied ' + item.name + ' as ' + copyFormatLabel() + '.');
      },
      function () {
        setCopyStatus('Could not copy automatically. Select the link and copy it manually.');
      },
    );
  }

  function copyAll() {
    var done = [];
    for (var index = 0; index < items.length; index++) {
      if (items[index].status === 'done' && items[index].url) done.push(items[index]);
    }
    if (!done.length) return;

    var format = copyFormat();
    var text = done
      .map(function (item) {
        var formats = buildCopyFormats(item.url, item.name);
        return formats[format] || item.url;
      })
      .join('\n');

    copyToClipboard(text).then(
      function () {
        if (copyAllButton) {
          copyAllButton.textContent = 'Copied';
          window.setTimeout(function () {
            copyAllButton.textContent = 'Copy all';
          }, 1500);
        }
        setCopyStatus(
          'Copied ' + plural(done.length, 'link', 'links') + ' as ' + copyFormatLabel() + '.',
        );
      },
      function () {
        setCopyStatus('Could not copy automatically. Select the links and copy them manually.');
      },
    );
  }

  /* ------------------------------------------------------ input listeners */

  // Progressive enhancement: the markup keeps the single-file form working
  // without JavaScript, and the queue and multi-select are added here.
  if (fileInput) {
    fileInput.multiple = true;
    fileInput.required = false;

    var dropzoneTitle = document.querySelector('.cb-dropzone-title');
    var dropzoneHint = document.querySelector('.cb-dropzone-hint');
    if (dropzoneTitle) dropzoneTitle.textContent = 'Drop images here';
    if (dropzoneHint) dropzoneHint.textContent = 'or click to choose one or more';

    fileInput.addEventListener('change', function () {
      addFiles(fileInput.files);
    });
  }

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      startUploads();
    });
  }

  if (dropzone) {
    ['dragenter', 'dragover'].forEach(function (type) {
      dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.add('is-dragging');
      });
    });

    ['dragleave', 'dragend'].forEach(function (type) {
      dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        event.stopPropagation();
        dropzone.classList.remove('is-dragging');
      });
    });

    dropzone.addEventListener('drop', function (event) {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.remove('is-dragging');

      var files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      addFiles(files);
    });
  }

  if (copyAllButton) copyAllButton.addEventListener('click', copyAll);
  if (clearButton) clearButton.addEventListener('click', clearFinished);

  /* Theme switching: persist the choice, then load the canonical URL so the
     server renders the matching stylesheets (the Bootstrap theme pulls in a
     vendor CSS file). */
  var themeSelect = document.querySelector('[data-theme-select]');
  if (themeSelect) {
    themeSelect.addEventListener('change', function () {
      document.cookie =
        'catbox_theme=' +
        encodeURIComponent(themeSelect.value) +
        '; path=/; max-age=31536000; samesite=lax';
      window.location.assign('/');
    });
  }

  updateControls();
  updateSummary();
})();
