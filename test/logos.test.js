import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandSvg, imageType, imageSide, iconLinks, simpleIconIndex, connectorBase, genericIcon } from '../lib/logos.js';

test('brand glyphs: only path data and a colour get into the SVG', () => {
  const svg = brandSvg('M0 0h24v24H0z', 'D97757');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /fill="#D97757"/);
  assert.throws(() => brandSvg('M0 0"/><script>alert(1)</script>', '000000'));
  assert.throws(() => brandSvg('M0 0z', 'red"/>'));
  // A light brand gets a dark glyph, a dark one a white glyph.
  assert.match(brandSvg('M0 0z', 'FFFFFF'), /fill="#111827"/);
  assert.match(brandSvg('M0 0z', '000000'), /fill="#FFFFFF" d=/);
});

test('images are recognised by their bytes, and SVG is not kept', () => {
  const png = Buffer.alloc(24); png.set([0x89, 0x50, 0x4e, 0x47]); png.writeUInt32BE(180, 16); png.writeUInt32BE(180, 20);
  assert.equal(imageType(png), 'image/png');
  assert.equal(imageSide(png, 'image/png'), 180);
  const ico = Buffer.alloc(22); ico.set([0, 0, 1, 0, 1, 0, 16]);
  assert.equal(imageType(ico), 'image/x-icon');
  assert.equal(imageSide(ico, 'image/x-icon'), 16);
  assert.equal(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(imageType(Buffer.from('<!doctype html>')), null);
});

test('a page\'s icons: apple-touch-icon first, larger first, no SVG, https only', () => {
  const page = `<link rel="icon" href="/favicon-32.png" sizes="32x32">
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link href='/apple.png' rel='apple-touch-icon'>
    <link rel="icon" href="http://insecure.example/x.png" sizes="512x512">
    <link rel="stylesheet" href="/site.css">`;
  assert.deepEqual(iconLinks(page, 'https://tool.example/'), ['https://tool.example/apple.png', 'https://tool.example/favicon-32.png']);
});

test('Simple Icons are found by title and alias, in any case', () => {
  const index = simpleIconIndex([{ title: 'Claude Code', slug: 'claudecode', hex: 'D97757', aliases: { aka: ['CC'] } }, { title: 'Bad', slug: 'bad', hex: 'nope' }]);
  assert.equal(index.get('claude code').slug, 'claudecode');
  assert.equal(index.get('cc').slug, 'claudecode');
  assert.equal(index.has('bad'), false);
});

test('an MCP server or connector for a product takes that product\'s logo', () => {
  assert.equal(connectorBase('Figma MCP'), 'Figma');
  assert.equal(connectorBase('Slack connector'), 'Slack');
  assert.equal(connectorBase('GitHub MCP server'), 'GitHub');
  assert.equal(connectorBase('MCP connectors'), null);
  assert.equal(connectorBase('an internal sharing and hosting connector'), null);
  assert.equal(connectorBase('Claude Code'), null);
});

test('a tool named by a description gets a line icon for what it does', () => {
  assert.equal(genericIcon('a browser diff viewer'), 'diff');
  assert.equal(genericIcon('a browser automation skill'), 'globe');
  assert.equal(genericIcon('an in-house code assistant bot'), 'bot');
  assert.equal(genericIcon('an in-house file sharing service'), 'cloud');
  assert.equal(genericIcon('an in-house deploy script'), 'rocket');
  assert.equal(genericIcon('a web-analytics plugin'), 'chart');
  assert.equal(genericIcon('a thing nobody can place'), null);
  assert.equal(genericIcon('Browserbase'), null);
});
