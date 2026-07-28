// Pre-paint theme + seed, so a cold load never flashes the wrong palette.
//
// This MUST stay an external file: the backend sends `script-src 'self'`, which
// blocks inline scripts silently (the browser only logs a CSP violation). As an
// inline block this ran nowhere for months — the CSS fallback in tokens.css is
// dark, so light-theme users saw a dark flash on every cold load.
(function () {
  try {
    var t = localStorage.getItem('cue-theme') || 'system';
    var dark =
      t === 'dark' ||
      (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var seed = localStorage.getItem('cue-seed');
    if (seed) document.documentElement.style.setProperty('--seed', seed);
  } catch (e) {
    /* private mode / storage disabled — React applies the theme on mount */
  }
})();
