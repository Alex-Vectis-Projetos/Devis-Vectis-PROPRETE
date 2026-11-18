'use strict';

// Polices hébergées localement : aucune requête vers Google Fonts, fichiers présents et valides, licence incluse.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('index.html: no Google Fonts reference (no third-party font request)', () => {
  for (const f of ['index.html', 'admin-inline.js', 'admin-panel.js']) {
    const t = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(t), f + ' ne référence plus Google Fonts');
  }
  assert.match(html, /<link rel="stylesheet" href="fonts\/fonts\.css">/);
  assert.match(html, /<link rel="preload" href="fonts\/montserrat-latin\.woff" as="font" type="font\/woff" crossorigin>/);
});

test('fonts/: WOFF files are valid, fonts.css declares both faces, OFL licence shipped', () => {
  for (const f of ['montserrat-latin.woff', 'montserrat-italic-latin.woff']) {
    const b = fs.readFileSync(path.join(root, 'fonts', f));
    assert.equal(b.subarray(0, 4).toString('latin1'), 'wOFF', f + ' : signature WOFF');
    assert.ok(b.length > 20000 && b.length < 400000, f + ' : taille plausible ' + b.length);
  }
  const css = fs.readFileSync(path.join(root, 'fonts', 'fonts.css'), 'utf8');
  assert.equal((css.match(/@font-face/g) || []).length, 2);
  assert.match(css, /font-family:'Montserrat';font-style:normal;font-weight:400 800;font-display:swap;src:url\(montserrat-latin\.woff\)/);
  assert.match(css, /font-style:italic;font-weight:500 600/);
  assert.ok(!/https?:\/\//.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'aucune URL externe dans les règles');
  assert.match(fs.readFileSync(path.join(root, 'fonts', 'OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/);
});
