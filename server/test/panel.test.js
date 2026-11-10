'use strict';

// The administration panel ships presets and a category library. They must satisfy the server's own rules,
// otherwise the panel would offer choices that the API then refuses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const panel = require('../../admin-panel.js');
const { validatePalette, ICONS } = require('../src/content');

test('every palette preset is accepted by the server contrast rules', () => {
  assert.ok(panel.PRESETS.length >= 60);
  assert.equal(new Set(panel.PRESETS.map((p) => p.id)).size, panel.PRESETS.length, 'ids uniques');
  for (const p of panel.PRESETS) assert.doesNotThrow(() => validatePalette({ preset: p.id, colors: p.colors }), p.name);
});

test('the first preset is the original Noir & Or palette of the site', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const v = (n) => html.match(new RegExp('--' + n + ':(#[0-9a-fA-F]{6})'))[1].toLowerCase();
  const c = panel.PRESETS[0].colors;
  assert.equal(panel.PRESETS[0].name, 'Noir & Or');
  assert.equal(c.background, v('ink'));
  assert.equal(c.card, v('panel'));
  assert.equal(c.text, v('text'));
  assert.equal(c.primary, v('gold'));
  assert.equal(c.accent, v('gold-hi'));
  assert.equal(c.secondary, v('gold-deep'));
});

test('client and server agree on unreadable palettes', () => {
  const bad = { ...panel.PRESETS[0].colors, text: '#080808' };
  assert.ok(panel.paletteProblems(bad).length > 0);
  assert.throws(() => validatePalette({ preset: 'x', colors: bad }));
  assert.deepEqual(panel.paletteProblems(panel.PRESETS[0].colors), []);
});

test('category library: unique ids, 25 spec categories, icons known to the server', () => {
  assert.equal(panel.LIBRARY.length, 25);
  assert.equal(new Set(panel.LIBRARY.map((l) => l[0])).size, 25);
  for (const [id, label, icon] of panel.LIBRARY) {
    assert.match(id, /^[a-z0-9][a-z0-9_-]{0,39}$/);
    assert.ok(label.length > 0 && ICONS.includes(icon), id);
  }
});

test('the panel icon list equals the server allow-list', () => {
  assert.deepEqual(panel.ICONS.map((i) => i[0]).sort(), [...ICONS].sort());
});

test('existing site categories keep their ids (13 originals first, active)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\{id:'([a-z]+)',label:'[^']+',icon:'i-[a-z]+'\}/g)].map((m) => m[1]);
  assert.equal(ids.length, 13);
  assert.deepEqual(panel.LIBRARY.slice(0, 13).map((l) => l[0]), ids);
  assert.ok(panel.LIBRARY.slice(0, 13).every((l) => l[3] === true));
});

test('visual editor: indicators removed, key CSS untouched, editor controls only created from JS after a session', () => {
  const { execFileSync } = require('node:child_process');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.ok(!/gh-check|Connexion GitHub|id="pv"|Aperçu V4/.test(html), 'indicateurs visuels retirés');
  // the key rules are byte-identical to the production baseline
  let base = null;
  try { base = execFileSync('git', ['show', 'origin/main:index.html'], { cwd: path.join(__dirname, '..', '..'), maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { /* clone superficiel : comparaison ignorée */ }
  const rules = (t) => t.split('\n').filter((l) => /^\.admin-key/.test(l));
  const keyMarkup = (t) => (t.match(/<button type="button" class="admin-key"[^>]*>.*?<\/button>/) || [''])[0];
  assert.ok(rules(html).length >= 4);
  assert.ok(keyMarkup(html).includes('id="adminKey"'));
  if (base) { assert.deepEqual(rules(html), rules(base)); assert.equal(keyMarkup(html), keyMarkup(base)); }
  // no edit button in the static markup: visitors never receive any
  assert.ok(!/class="vedit"/.test(html));
  assert.match(html, /<div class="vdock" id="vdock" hidden/);
});

test('direct editing: the editor is a separate script, never in the visitor markup, and renders data without innerHTML', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = fs.readFileSync(path.join(root, 'admin-inline.js'), 'utf8');
  assert.ok(!/<script[^>]+admin-inline/.test(html), 'chargé dynamiquement, après authentification seulement');
  assert.ok(!/vedit|✎/.test(html), 'plus de boutons ✎ par section');
  assert.match(html, /sc\.src='\/admin-inline\.js\?v=\d+'/);
  assert.match(html, /sc\.src='\/admin-panel\.js\?v=\d+'/, 'versionné : jamais de vieux script en cache');
  // loader is only reachable from the signed-in path
  const show = html.slice(html.indexOf('function show(){'), html.indexOf('function hide(){'));
  assert.match(show, /if\(!adm\.signed\)return/);
  // injected data is never interpreted as HTML (innerHTML only to restore a saved copy of the page's own markup)
  const uses = inline.split('\n').filter((l) => /innerHTML/.test(l));
  assert.ok(uses.every((l) => /el\.innerHTML = saved|var saved = el\.innerHTML/.test(l)), uses.join('\n'));
  assert.ok(!/insertAdjacentHTML|outerHTML|document\.write|eval\(/.test(inline));
  // every write goes through the existing endpoints with the CSRF header
  assert.match(inline, /\/api\/admin\/site\/content\//);
  assert.match(inline, /X-CSRF-Token/);
  assert.match(inline, /expectedVersion/);
});

test('public texts: every allow-listed key has a target element in the page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const { TEXT_KEYS } = require('../src/content');
  const block = html.slice(html.indexOf('var TXT={'), html.indexOf('window.vectisTextTargets'));
  for (const k of TEXT_KEYS) assert.ok(new RegExp(k + ':').test(block), k);
});

test('banner is one composition; gear sheet shows colours only; categories use one contextual interface', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = fs.readFileSync(path.join(root, 'admin-inline.js'), 'utf8');
  assert.match(html, /\.pg-home \.hero\.has-banner \.hero-art\{[^}]*aspect-ratio/);
  assert.match(html, /hero\.classList\.add\('has-banner'\)/);
  // the whole hero opens the banner editor; logo/tagline/perks are not independent editable elements
  assert.match(inline, /t\.closest\('#accueil'\)/);
  assert.ok(!/closest\('\.hero-logo'\)|closest\('\.hero-art'\)/.test(inline));
  assert.match(inline, /\^\(hero\|perk\)/);
  // gear: only the palette section is mounted from the dock, and the legacy session block is hidden in that sheet
  assert.match(html, /openSheet\(\['palette'\]/);
  assert.match(html, /\.adm\[data-sheet="1"\] #admPanel>\.sess/);
  // one category interface: no separate add-category form, no separate place popover
  assert.ok(!/function addCategory|function editPlace/.test(inline));
  assert.match(inline, /editCategory\(a, null\)/);
  for (const label of ['Catégorie correspondante', 'Sous-titre', 'Monter la catégorie', 'AJOUTER UN AUTRE ÉTABLISSEMENT', 'Remplacer cette photo']) assert.ok(inline.includes(label), label);
});

test('fix pack: glyph icon picker, no independent place registration, banner ratio, upload resize and 413 message', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = fs.readFileSync(path.join(root, 'admin-inline.js'), 'utf8');
  // icons are shown as glyphs (svg <use>), never as a technical-name <select>
  assert.match(inline, /function iconPicker\(/);
  assert.ok(!/function iconSelect|iconSelect\(/.test(inline));
  assert.ok(ICONS.length >= 80);
  for (const i of ICONS) assert.ok(html.includes(`<symbol id="${i}"`), i);
  // the public gallery has no independent place registration
  assert.ok(!/add-place|chooseCategory/.test(inline));
  // places of a hidden category are not shown publicly (gallery filter)
  assert.match(html, /CATEGORIES\.some\(function\(c\)\{return c\.id===p\.category\}\)&&\(!activeCat/);
  // banner: ratio of the single image drives the area, reset when removed
  assert.match(html, /--banner-ar/);
  assert.match(html, /\.has-banner \.hero-art\{[^}]*height:auto/);
  // upload: client-side reduction (aspect kept, EXIF applied) and an explicit 413 message
  assert.match(inline, /function optimize\(/);
  assert.match(inline, /imageOrientation: 'from-image'/);
  assert.match(inline, /status_code === 413/);
  assert.match(inline, /HTTP 413/);
});

test('banner default is ONE image (desktop + mobile variant of the same composition); gallery is presentation only; names sync with the category', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = fs.readFileSync(path.join(root, 'admin-inline.js'), 'utf8');
  // the section is a single banner image from the first paint: no half artwork + live HTML text beside it
  assert.match(html, /<section class="hero has-banner" id="accueil"/);
  assert.match(html, /<div class="hero-art"><img src="data:image\/webp;base64,[^"]+" data-mobile="data:image\/webp;base64,/);
  assert.match(html, /\.has-banner \.hero-copy\{position:absolute;width:1px/); // text kept for screen readers only
  assert.match(html, /var BDEF=null;/);
  assert.match(html, /matchMedia\('\(max-width:760px\)'\)/);
  // a custom image replaces everything; zoom/framing apply to the whole image
  assert.match(html, /var custom=b&&b\.imageId\?url\(b\.imageId\):null;/);
  // editor: framing needs a file (the banner section requires an image), message in French
  assert.match(inline, /Choisissez d’abord un fichier/);
  // public gallery cards are never marked editable and open no editor from the gallery
  assert.ok(!/'\.card'/.test(inline.slice(inline.indexOf("['.site-header .brand'"), inline.indexOf("['.site-header .brand'") + 200)));
  assert.ok(!/editCategory\(c, p\.category/.test(inline));
  // establishment name follows the category title until customised; public card shows category then name
  assert.match(inline, /function setLabel\(v\)/);
  assert.match(inline, /title: w\.label/);
  assert.match(html, /function capHtml\(p\)/);
  assert.match(html, /class="cap-cat"/);
});
