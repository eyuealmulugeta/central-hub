// v0.24.0: light or dark, before the page is drawn. "auto" (the default) follows the device; My settings can fix it.
(function () {
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function apply() {
    var t = 'auto';
    try { t = localStorage.getItem('sf:theme') || 'auto'; } catch (e) { /* no storage: follow the device */ }
    document.documentElement.setAttribute('data-theme', t === 'dark' || (t === 'auto' && mq && mq.matches) ? 'dark' : 'light');
  }
  apply();
  if (mq && mq.addEventListener) mq.addEventListener('change', apply);
  window.applyTheme = apply;
})();
