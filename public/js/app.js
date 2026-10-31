/* Catbox — client-side upload handling, copy formats, error modal and
   theme switching. */
(function () {
  'use strict';

  var form = document.getElementById('cb-upload-form');
  var dropzone = document.querySelector('[data-dropzone]');
  var fileInput = document.getElementById('cb-file');
  var submitButton = document.getElementById('cb-submit');
  var progress = document.getElementById('cb-progress');
  var progressBar = document.querySelector('[data-progress-bar]');
  var progressFill = document.querySelector('[data-progress-fill]');
  var progressLabel = document.querySelector('[data-progress-label]');
  var result = document.getElementById('cb-result');
  var resultUrl = document.getElementById('cb-result-url');
  var resultPreview = document.getElementById('cb-preview');

  /* ----------------------------------------------------------- copy box */

  var copyBox = document.querySelector('[data-copy-box]');
  var copyTabs = Array.prototype.slice.call(
    document.querySelectorAll('[data-copy-format]'),
  );
  var copyPanel = document.getElementById('cb-copy-panel');
  var copyInput = document.getElementById('cb-copy-input');
  var copyButton = document.getElementById('cb-copy');
  var copyStatus = document.getElementById('cb-copy-status');
  var activeFormat = 'link';

  /* -------------------------------------------------------------- modal */

  var modal = document.getElementById('cb-modal');
  var modalBackdrop = document.getElementById('cb-modal-backdrop');
  var modalMessage = document.getElementById('cb-modal-message');
  var modalTitle = document.getElementById('cb-modal-title');
  var lastFocusedElement = null;

  var maxSize = form ? parseInt(form.dataset.maxSize, 10) || 0 : 0;
  var fieldName = form ? form.dataset.fieldName || 'fileToUpload' : 'fileToUpload';

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

  /**
   * Every failure — client side validation, a server error response or a
   * network failure — is surfaced in the Bootstrap modal.
   */
  function showError(message, title) {
    if (result) result.hidden = true;
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

  /* ------------------------------------------------------------ progress */

  function setProgress(percent) {
    if (!progress) return;
    progress.hidden = false;
    if (progressFill) progressFill.style.width = percent + '%';
    if (progressBar) {
      progressBar.setAttribute('aria-valuenow', String(Math.round(percent)));
    }
  }

  function hideProgress() {
    if (progress) progress.hidden = true;
    if (progressFill) progressFill.style.width = '0%';
  }

  /* ---------------------------------------------------------- copy logic */

  function setActiveFormat(format) {
    activeFormat = format;

    copyTabs.forEach(function (tab) {
      var isActive = tab.getAttribute('data-copy-format') === format;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
    });

    if (copyPanel) {
      var activeTab = copyTabs.filter(function (tab) {
        return tab.getAttribute('data-copy-format') === format;
      })[0];
      if (activeTab) copyPanel.setAttribute('aria-labelledby', activeTab.id);
    }
  }

  function updateCopyField(formats) {
    if (!copyInput) return;
    copyInput.value = formats[activeFormat] || '';
  }

  function selectFormat(format) {
    setActiveFormat(format);
    if (copyBox && copyBox.dataset.formats) {
      var formats = JSON.parse(copyBox.dataset.formats);
      updateCopyField(formats);
    }
  }

  if (copyTabs.length) {
    copyTabs.forEach(function (tab, index) {
      tab.addEventListener('click', function () {
        selectFormat(tab.getAttribute('data-copy-format'));
      });

      // Arrow key navigation between the tabs.
      tab.addEventListener('keydown', function (event) {
        var next = null;

        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          next = copyTabs[(index + 1) % copyTabs.length];
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          next = copyTabs[(index - 1 + copyTabs.length) % copyTabs.length];
        } else if (event.key === 'Home') {
          next = copyTabs[0];
        } else if (event.key === 'End') {
          next = copyTabs[copyTabs.length - 1];
        }

        if (!next) return;

        event.preventDefault();
        selectFormat(next.getAttribute('data-copy-format'));
        next.focus();
      });
    });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }

    // Fallback for browsers without the async clipboard API.
    return new Promise(function (resolve, reject) {
      if (!copyInput) {
        reject(new Error('Clipboard unavailable'));
        return;
      }

      copyInput.value = text;
      copyInput.focus();
      copyInput.select();
      copyInput.setSelectionRange(0, text.length);

      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }

      if (ok) {
        resolve();
      } else {
        reject(new Error('Clipboard unavailable'));
      }
    });
  }

  if (copyButton) {
    copyButton.addEventListener('click', function () {
      var text = copyInput ? copyInput.value : '';
      if (!text) return;

      copyToClipboard(text).then(
        function () {
          copyButton.textContent = 'Copied';
          if (copyStatus) copyStatus.textContent = 'Copied to clipboard.';

          window.setTimeout(function () {
            copyButton.textContent = 'Copy';
            if (copyStatus) copyStatus.textContent = '';
          }, 1500);
        },
        function () {
          if (copyStatus) {
            copyStatus.textContent =
              'Could not copy automatically. Select the text and copy it manually.';
          }
          if (copyInput) {
            copyInput.focus();
            copyInput.select();
          }
        },
      );
    });
  }

  /* --------------------------------------------------------- upload flow */

  function upload(file) {
    if (result) result.hidden = true;

    if (!file) {
      showError('Please choose an image to upload.', 'Nothing to upload');
      return;
    }

    // A browser supplied MIME type is only a hint. Reject the obvious cases
    // early, then let the server confirm the real format from its magic bytes.
    var looksLikeImage =
      (file.type && file.type.indexOf('image/') === 0) ||
      /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(file.name || '');

    if (!looksLikeImage) {
      showError(
        'That file is not a valid PNG, JPEG, GIF, WebP, AVIF or SVG image.',
        'Unsupported file type',
      );
      return;
    }

    if (maxSize > 0 && file.size > maxSize) {
      showError(
        'That file is too large. The maximum size is 10 MiB.',
        'File too large',
      );
      return;
    }

    var data = new FormData();
    data.append(fieldName, file);

    var request = new XMLHttpRequest();
    request.open('POST', '/upload');

    if (submitButton) submitButton.disabled = true;
    if (progressLabel) progressLabel.textContent = 'Uploading ' + file.name + '…';
    setProgress(0);

    request.upload.addEventListener('progress', function (event) {
      if (!event.lengthComputable) return;

      var percent = (event.loaded / event.total) * 100;
      setProgress(percent);

      if (progressLabel) {
        progressLabel.textContent =
          'Uploading ' +
          file.name +
          '… ' +
          formatBytes(event.loaded) +
          ' of ' +
          formatBytes(event.total);
      }
    });

    request.addEventListener('load', function () {
      if (submitButton) submitButton.disabled = false;
      hideProgress();

      var body = null;
      try {
        body = JSON.parse(request.responseText);
      } catch (err) {
        body = null;
      }

      if (request.status >= 200 && request.status < 300 && body && body.url) {
        showResult(body.url, body.name || file.name);
        return;
      }

      showError(
        (body && body.error) || 'Upload failed. Please try again.',
        request.status >= 500 ? 'Server error' : 'Upload failed',
      );
    });

    request.addEventListener('error', function () {
      if (submitButton) submitButton.disabled = false;
      hideProgress();
      showError(
        'Upload failed. Please check your connection and try again.',
        'Network error',
      );
    });

    request.addEventListener('abort', function () {
      if (submitButton) submitButton.disabled = false;
      hideProgress();
    });

    request.send(data);
  }

  function showResult(url, name) {
    if (!result) return;

    result.hidden = false;

    if (resultUrl) {
      resultUrl.textContent = url;
      resultUrl.href = url;
    }

    if (resultPreview) {
      resultPreview.src = url;
      resultPreview.hidden = false;
    }

    var formats = buildCopyFormats(url, name);

    if (copyBox) {
      copyBox.dataset.formats = JSON.stringify(formats);
    }

    setActiveFormat(activeFormat);
    updateCopyField(formats);
  }

  if (form && fileInput) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      upload(fileInput.files && fileInput.files[0]);
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) {
        upload(fileInput.files[0]);
      }
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

      if (fileInput && typeof DataTransfer !== 'undefined') {
        try {
          var transfer = new DataTransfer();
          transfer.items.add(files[0]);
          fileInput.files = transfer.files;
        } catch (err) {
          /* Assignment is unsupported in some browsers; fall through. */
        }
      }

      upload(files[0]);
    });
  }

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
})();
