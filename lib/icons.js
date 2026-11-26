// The site's line icons, as SVG strings to pass to raw(). All are decorative
// (aria-hidden): the text beside them, or the control's label, says what they do.
const PATHS = {
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  // For tools named by a description instead of a product (lib/logos.js genericIcon).
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  diff: '<rect x="3" y="4" width="7.5" height="16" rx="1.5"/><rect x="13.5" y="4" width="7.5" height="16" rx="1.5"/><path d="M5.25 12h3M15.75 12h3M17.25 10.5v3"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4.5V8M9 13v1M15 13v1M2 12.5v2M22 12.5v2"/><circle cx="12" cy="3.5" r="1"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 10.1 4.2 4.2 0 0 0 7 18.5z"/>',
  rocket: '<path d="M5.5 15.5c-1.5 1.3-2 3.5-2 5 1.5 0 3.7-.5 5-2"/><path d="M9 15l-3-3c1-4 4.5-9 13-9 0 8.5-5 12-10 12z"/><circle cx="15" cy="9" r="1.5"/>',
  chart: '<path d="M4 4v16h16"/><path d="M8.5 16v-4M12.5 16V8M16.5 16v-6"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12.5 15h4.5"/>',
};
const SIZES = { left: 20, right: 20, arrow: 18, back: 18, close: 12, search: 16 };

export const icon = (name, size = SIZES[name]) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${name === 'close' ? 2.5 : 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

// Each icon at its usual size.
export const ICON = Object.fromEntries(Object.keys(PATHS).map((name) => [name, icon(name)]));
