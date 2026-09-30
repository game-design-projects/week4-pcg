// Every character the game can draw is in a font it ships with: no emoji,
// no symbol or Chinese character left to whatever fonts the player's system
// happens to have. (tools/build_fonts.py rebuilds the fonts and the list.)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('every non-ASCII character in the game is covered by the bundled fonts', () => {
  const covered = new Set(fs.readFileSync(path.join(root, 'assets/fonts/charset.txt'), 'utf8').trim());
  const files = [...walk(path.join(root, 'src')).filter((f) => f.endsWith('.js') && !f.endsWith('atlas.js')), path.join(root, 'index.html'), path.join(root, 'styles.css')];
  const missing = new Map();
  for (const f of files) {
    for (const ch of fs.readFileSync(f, 'utf8')) {
      const cp = ch.codePointAt(0);
      if (cp <= 0x7e || ch === '\n' || ch === '\r' || ch === '\t') continue;
      if (!covered.has(ch)) missing.set(ch, path.relative(root, f));
    }
  }
  assert.equal(missing.size, 0, `not in the bundled fonts (run tools/build_fonts.py): ${[...missing].map(([c, f]) => `${c} U+${c.codePointAt(0).toString(16)} in ${f}`).join(', ')}`);
});

test('the page loads only bundled fonts, nothing from the network', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/);
  assert.doesNotMatch(html, /(src|href)="https?:/, 'no scripts, styles or fonts from the network');
  const css = fs.readFileSync(path.join(root, 'assets/fonts/fonts.css'), 'utf8');
  for (const [, file] of css.matchAll(/url\('([^']+)'\)/g)) assert.ok(fs.existsSync(path.join(root, 'assets/fonts', file)), file);
});
