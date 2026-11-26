// Plausible's queue, so calls made before its script loads are kept. A file, not inline, for the CSP.
window.plausible = window.plausible || function () { (plausible.q = plausible.q || []).push(arguments); };
plausible.init = plausible.init || function (i) { plausible.o = i || {}; };
plausible.init();
