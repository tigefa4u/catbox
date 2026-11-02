/* Catbox — apply the browser's color-scheme preference before first paint
   when the page is in auto theme mode. Explicit theme choices are rendered by
   the server and are left untouched. */
(function () {
  'use strict';

  var root = document.documentElement;
  if (root.getAttribute('data-theme-mode') !== 'auto') return;
  if (typeof window.matchMedia !== 'function') return;

  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var bootstrapLink = document.getElementById('cb-bootstrap-css');
  var lightTheme = root.getAttribute('data-auto-light') || 'classic';
  var darkTheme = root.getAttribute('data-auto-dark') || 'bootstrap';

  function apply() {
    var dark = media.matches;
    root.setAttribute('data-theme', dark ? darkTheme : lightTheme);
    root.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
    if (bootstrapLink) {
      bootstrapLink.media = dark ? 'all' : 'not all';
    }
  }

  apply();

  var onChange = function () {
    apply();
  };

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange);
  } else if (typeof media.addListener === 'function') {
    // Safari < 14.
    media.addListener(onChange);
  }
})();
