// The site's line icons, as SVG strings to pass to raw(). All are decorative
// (aria-hidden): the text beside them, or the control's label, says what they do.
const PATHS = {
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
};
const SIZES = { left: 20, right: 20, arrow: 18, back: 18, close: 12, search: 16 };

export const icon = (name, size = SIZES[name]) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${name === 'close' ? 2.5 : 2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;

// Each icon at its usual size.
export const ICON = Object.fromEntries(Object.keys(PATHS).map((name) => [name, icon(name)]));
