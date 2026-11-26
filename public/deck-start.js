// Runs in <head>, before the page is drawn: a slide page opened at a slide's
// link (#setups) is marked so site.css keeps the deck hidden until site.js has
// moved to that slide, and the first slide never flashes first. (CSS :target
// alone is not reliable here: browsers set it late while the page loads.)
if (location.hash.length > 1) document.documentElement.dataset.at = '';
