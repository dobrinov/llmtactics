// Logos for the tools people name, found by the analysis script
// (`npm run analyse`) and stored in the table tool_logos. A tool without one
// keeps its two letters (lib/tour.js).
//
// Where a logo comes from, in order:
// 1. Simple Icons (CC0 brand glyphs): a brand whose title or alias is the tool's
//    name, or one of its aliases in data/tools.json. The glyph is drawn here,
//    in white or near-black on the brand's colour, so the file served is ours.
// 2. For a known tool whose link is its own site (not a code host), or one in
//    SITE_FOR below: the icon
//    the site names for itself (apple-touch-icon, then the largest icon), or
//    its /favicon.ico. Only PNG, ICO, JPEG, WebP and GIF are kept: never SVG,
//    since a page on this site could open it.
import { knownTool } from './shape.js';

export const SIMPLE_ICONS = 'https://cdn.jsdelivr.net/npm/simple-icons@16.38.1';
// Tools whose Simple Icons brand goes by another name.
const SIMPLE_ICON_FOR = {
  gemini: 'googlegemini', 'gemini cli': 'googlegemini',
  // Parts of Claude take Claude's logo.
  'claude artifacts': 'claude', 'claude design': 'claude',
  // Parts of macOS take Apple's.
  'terminal.app': 'apple',
};
// Tools whose link is a repository, or that are not in data/tools.json, and
// whose maker's site has the right icon.
const SITE_FOR = {
  'codex cli': 'https://openai.com', 'gemini cli': 'https://gemini.google.com', slack: 'https://slack.com',
  'vs code': 'https://code.visualstudio.com', 'visual studio code': 'https://code.visualstudio.com',
  meshy: 'https://www.meshy.ai', 'agent-browser': 'https://vercel.com',
  't3 code': 'https://t3.codes',
};
// Tools with no site of their own whose repository keeps a logo image.
const IMAGE_FOR = {
  diffity: 'https://raw.githubusercontent.com/nilbuild/diffity/main/.github/logo.png',
};

// A tool named by a description instead of a product ("a browser diff
// viewer", "an in-house deploy script") has no logo: the site draws a line
// icon (lib/icons.js) for what it does, by the first matching word, or keeps
// its letters if none matches.
const GENERIC = [
  [/\b(diff|review)/i, 'diff'],
  [/\b(bot|assistant|agent)\b/i, 'bot'],
  [/\bbrowser/i, 'globe'],
  [/\b(deploy|release|ship)/i, 'rocket'],
  [/\b(analytic|metric|dashboard|monitor)/i, 'chart'],
  [/\b(3d|asset|image|design)/i, 'cube'],
  [/\b(shar|host|file|storage|upload)/i, 'cloud'],
  [/\b(terminal|shell|cli|script)\b/i, 'terminal'],
  [/\b(plugin|skill|extension|connector|integration)/i, 'plug'],
];
export function genericIcon(name) {
  if (!/^(a|an|the|our|my|some)\s/i.test(String(name))) return null;
  return GENERIC.find(([re]) => re.test(name))?.[1] ?? null;
}

// An MCP server or connector for another product ("Figma MCP", "Slack
// connector"): the product's name, or null. It gets the product's logo, and
// the site marks it with a small MCP badge (lib/tour.js).
export function connectorBase(name) {
  const m = String(name).trim().match(/^(.+?)\s+(?:mcp(?:\s+(?:server|connector))?|connector)$/i);
  if (!m || /^(a|an|the|our|my|some|mcp)\b/i.test(m[1])) return null;
  return m[1];
}
// Links to these hosts are a repository or a listing: their icon is the host's, not the tool's.
const CODE_HOSTS = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|npmjs\.com|pypi\.org|crates\.io|duckduckgo\.com)$/i;
const MAX_IMAGE = 256 * 1024;
const MAX_PAGE = 1024 * 1024;
const TIMEOUT_MS = 8000;
// A raster icon smaller than this looks blurred in the largest avatar.
const MIN_SIDE = 32;

// title and aliases, lower case → { slug, hex }
export function simpleIconIndex(data) {
  const index = new Map();
  for (const icon of Array.isArray(data) ? data : []) {
    if (!icon?.slug || !/^[0-9a-f]{6}$/i.test(icon.hex ?? '')) continue;
    for (const name of [icon.title, ...(icon.aliases?.aka ?? [])]) {
      if (typeof name === 'string' && !index.has(name.toLowerCase())) index.set(name.toLowerCase(), { slug: icon.slug, hex: icon.hex });
    }
  }
  return index;
}

// Path data only: commands, numbers, separators. Anything else is refused.
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]{1,20000}$/;

// The glyph on a square of the brand's colour; the avatar's round frame crops it.
export function brandSvg(pathData, hex) {
  if (!PATH_DATA.test(pathData)) throw new Error('unexpected path data');
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error('unexpected colour');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#${hex.toUpperCase()}"/><path transform="translate(6 6) scale(.5)" fill="${light ? '#111827' : '#FFFFFF'}" d="${pathData}"/></svg>`;
}

// What kind of image the bytes are, from their first bytes; null if not one we keep.
export function imageType(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const at = (i, ...xs) => xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  return null;
}

// The width of a PNG (from its header), or of the largest image in an ICO; null if unknown.
export function imageSide(buf, type) {
  const b = Buffer.from(buf);
  if (type === 'image/png' && b.length >= 24) return Math.min(b.readUInt32BE(16), b.readUInt32BE(20));
  if (type === 'image/x-icon' && b.length >= 6) {
    let best = 0;
    for (let i = 0; i < b.readUInt16LE(4) && 6 + i * 16 + 16 <= b.length; i++) best = Math.max(best, b[6 + i * 16] || 256);
    return best;
  }
  return null;
}

// The icons a page names for itself, best first: apple-touch-icon, then icons by size.
export function iconLinks(page, baseUrl) {
  const found = [];
  for (const tag of String(page).match(/<link\b[^>]*>/gi) ?? []) {
    const attr = (n) => tag.match(new RegExp(`\\b${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v !== undefined);
    const rel = (attr('rel') ?? '').toLowerCase().split(/\s+/);
    const href = attr('href');
    if (!href || !rel.some((r) => r === 'icon' || r === 'apple-touch-icon' || r === 'apple-touch-icon-precomposed')) continue;
    if (/\.svg(\?|$)/i.test(href) || /svg/i.test(attr('type') ?? '')) continue;
    let url;
    try { url = new URL(href.replace(/&amp;/g, '&'), baseUrl); } catch { continue; }
    if (url.protocol !== 'https:') continue;
    const sizes = (attr('sizes') ?? '').match(/\d+/g)?.map(Number) ?? [];
    const side = rel.some((r) => r.startsWith('apple')) ? Math.max(180, ...sizes) : Math.max(16, ...sizes);
    found.push({ url: url.href, side });
  }
  return found.sort((a, b) => b.side - a.side).map((f) => f.url).filter((u, i, all) => all.indexOf(u) === i);
}

async function get(url, max, fetchImpl) {
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'llmtactics-logos/1' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length')) > max) throw new Error('too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error('too large');
  return { buf, url: res.url || url };
}

// The Simple Icons data, once per run.
export async function loadSimpleIcons(fetchImpl = fetch) {
  const { buf } = await get(`${SIMPLE_ICONS}/data/simple-icons.json`, 8 * 1024 * 1024, fetchImpl);
  return simpleIconIndex(JSON.parse(buf.toString('utf8')));
}

// A logo for one tool name: { content_type, body, source }, or null.
export async function findLogo(name, { icons, fetchImpl = fetch } = {}) {
  const base = connectorBase(name);
  if (base) {
    const logo = await findLogo(base, { icons, fetchImpl });
    return logo && { ...logo, source: `mcp:${logo.source}` };
  }
  const known = knownTool(name);
  const names = [name, ...(known ? [known.name, ...known.aliases] : [])].map((n) => n.toLowerCase());
  const brand = names.map((n) => (SIMPLE_ICON_FOR[n] ? { slug: SIMPLE_ICON_FOR[n] } : icons?.get(n))).find(Boolean);
  if (brand) {
    try {
      const { buf } = await get(`${SIMPLE_ICONS}/icons/${encodeURIComponent(brand.slug)}.svg`, MAX_IMAGE, fetchImpl);
      const d = buf.toString('utf8').match(/<path\b[^>]*\bd="([^"]+)"/)?.[1];
      const hex = brand.hex ?? [...(icons?.values() ?? [])].find((i) => i.slug === brand.slug)?.hex;
      if (d && hex) return { content_type: 'image/svg+xml', body: Buffer.from(brandSvg(d, hex)), source: `simple-icons:${brand.slug}` };
    } catch { /* try the site */ }
  }
  const image = names.map((n) => IMAGE_FOR[n]).find(Boolean);
  if (image) {
    try {
      const { buf } = await get(image, MAX_IMAGE, fetchImpl);
      const type = imageType(buf);
      if (type) return { content_type: type, body: buf, source: image };
    } catch { /* try the site */ }
  }
  const siteUrl = names.map((n) => SITE_FOR[n]).find(Boolean) ?? known?.url;
  if (!siteUrl) return null;
  let site;
  try { site = new URL(siteUrl); } catch { return null; }
  if (site.protocol !== 'https:' || CODE_HOSTS.test(site.hostname)) return null;
  let candidates = [];
  try {
    const { buf, url } = await get(site.href, MAX_PAGE, fetchImpl);
    candidates = iconLinks(buf.toString('utf8'), url);
  } catch { /* the site may still have /favicon.ico */ }
  candidates.push(new URL('/favicon.ico', site).href);
  for (const url of candidates) {
    try {
      const { buf } = await get(url, MAX_IMAGE, fetchImpl);
      const type = imageType(buf);
      if (!type) continue;
      const side = imageSide(buf, type);
      if (side !== null && side < MIN_SIDE) continue;
      return { content_type: type, body: buf, source: url };
    } catch { /* next candidate */ }
  }
  return null;
}
