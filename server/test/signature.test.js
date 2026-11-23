'use strict';
// Assinatura « AS Verified » : marca d'água fixe, globale, 100 % CSS — ne doit jamais gêner la navigation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const PAGES = ['index.html', 'mentions-legales.html', 'qui-sommes-nous.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html'];

test('signature: chaque page publique charge la même feuille de style, une seule fois', () => {
  for (const f of PAGES) {
    const n = (read(f).match(/<link rel="stylesheet" href="assets\/as-verified\.css">/g) || []).length;
    assert.equal(n, 1, f);
  }
});

test('signature: fixe, coin bas-droit, jamais interactive, sans scrollbar horizontale, masquée à l\'impression', () => {
  const css = read('assets/as-verified.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /body::after\{[^}]*position:fixed/);
  assert.match(css, /body::after\{[^}]*pointer-events:none/);
  assert.match(css, /body::after\{[^}]*right:max\(/);
  assert.match(css, /body::after\{[^}]*bottom:calc\(/);
  assert.match(css, /url\("as-verified\.png"\)/);
  assert.ok(!/z-index:\s*(?:[5-9]\d|\d{3,})/.test(css), 'sous le z-index des fenêtres, visionneuse et panneau cookies');
  assert.match(css, /@media print\{body::after\{display:none\}\}/);
  assert.match(css, /body\.v-editing::after/, 'monte au-dessus du dock admin');
  assert.ok(!/@import|http/.test(css), 'aucune ressource externe');
});

test('signature: PNG réel avec canal alpha (fond transparent), sans script ajouté', () => {
  const b = fs.readFileSync(path.join(root, 'assets/as-verified.png'));
  assert.equal(b.subarray(1, 4).toString(), 'PNG');
  assert.equal(b[25], 6, 'RGBA');
  assert.ok(b.length < 150 * 1024, 'léger');
  const html = PAGES.map(read).join('\n');
  assert.ok(!/as-verified\.(js)/.test(html));
});
