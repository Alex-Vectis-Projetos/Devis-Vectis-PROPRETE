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

test('category library: unique ids, 27 categories (25 spec + agences, regies), icons known to the server', () => {
  assert.equal(panel.LIBRARY.length, 27);
  assert.equal(new Set(panel.LIBRARY.map((l) => l[0])).size, 27);
  // Agences / Régies immobilières : identifiants stables, nom officiel français, icônes déjà connues du serveur, masquées par défaut
  const byId = Object.fromEntries(panel.LIBRARY.map((l) => [l[0], l]));
  assert.deepEqual(byId.agences, ['agences', 'Agences immobilières', 'i-key', false]);
  assert.deepEqual(byId.regies, ['regies', 'Régies immobilières', 'i-doc', false]);
  // un nouvel élément de la liste garde l'identifiant stable de la liste (pas un slug du nom) : ligne ajoutée dans editCategory/model.onchange
  assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'admin-inline.js'), 'utf8'), /if \(isNew && !ex\) w\.id = l\[0\];/);
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
  assert.match(inline, /\^\(hero\|perk\|placesTitle\)/);
  // Step 3: the lower public section (« Nos domaines d’activité ») has no independent editing: its title is excluded both from the editable marks and from the click-to-edit lookup
  assert.equal((inline.match(/hero\|perk\|placesTitle/g) || []).length, 2);
  // gear: only the palette section is mounted from the dock, and the legacy session block is hidden in that sheet
  assert.match(html, /openSheet\(\['palette'\]/);
  assert.match(html, /\.adm\[data-sheet="1"\] #admPanel>\.sess/);
  // navigation: category (its establishments) → one establishment editor; new category added from the area itself, no separate add-category form
  assert.ok(!/function addCategory/.test(inline));
  for (const fn of ['editCategory', 'editPlace']) assert.match(inline, new RegExp('function ' + fn + '\\('));
  // category editing is INTEGRATED in the intervention areas: a click on a category opens that category's panel; no separate dock menu
  assert.match(inline, /t\.closest\('\.dom'\)[^\n]*editCategory\(d, d\.dataset\.cat\)/);
  // the lower section (« Nos domaines d’activité ») is a PUBLIC presentation only: no editor, no editable marker, no « + Catégorie »
  assert.ok(!/#gal \.card|#realisations|#gal/.test(inline), 'admin script never touches the public gallery');
  assert.match(html, /<h2 class="sect-title" id="t-real">[^]*?Nos domaines d’activité<\/h2>/);
  assert.match(html, /<a href="#realisations">Nos domaines d’activité<\/a>/);
  assert.ok(!/Nos lieux d’intervention/.test(html), 'old lower-section title removed (header, menu and footer)');
  assert.equal((inline.match(/data-act': 'add-cat'/g) || []).length, 1, 'a single « + Catégorie » (upper section)');
  // establishment editor: category is inherited and READ-ONLY (no select, never changed)
  const plEd = inline.slice(inline.indexOf('function editPlace('), inline.indexOf('/* ---------- contact'));
  assert.ok(!/h\('select'/.test(plEd) && /readonly: true/.test(plEd));
  // the only assignment to w.category pins it to the ORIGINAL category id (never read from the form)
  assert.deepEqual(plEd.match(/w\.category = [^;]+;/g), ['w.category = isNew ? cid : existing.category;']);
  // official category names are derived from the ID (never from an establishment name), in the editors, the duplicate message and the public page
  assert.match(inline, /function catName\(c\)/);
  assert.match(plEd, /catLabel = cat\.id \? catName\(cat\)/);
  assert.match(inline, /err\('« ' \+ catName\(ex\) \+ ' » est déjà affichée\.'\)/);
  assert.match(inline, /norm\(catName\(x\)\) === norm\(w\.label\)/);
  assert.match(inline, /if \(!isNew\) w\.label = catName\(w\)/);
  assert.match(html, /label:OFFICIAL_CAT\[x\.id\]\|\|x\.label/);
  const lib = [...require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'admin-panel.js'), 'utf8').match(/var LIBRARY = \[[\s\S]*?\n  \];/)[0].matchAll(/\['([a-z0-9_-]+)', '([^']+)', '[^']+', (?:true|false)\]/g)].map((m) => [m[1], m[2]]);
  const off = html.match(/var OFFICIAL_CAT=\{([^}]*)\}/)[1];
  const map = Object.fromEntries([...off.matchAll(/([a-z0-9_-]+):'([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.ok(lib.length >= 24);
  assert.deepEqual(map, Object.fromEntries(lib), 'OFFICIAL_CAT (public page) must equal the administration LIBRARY');
  // Step 2: the list of establishments uses a pencil (same editor) and a trash icon; ONE deletion function, record only (assets never touched)
  assert.match(inline, /function iconBtn\(icon, label, fn, cls\)/);
  assert.match(inline, /iconBtn\('i-pencil', 'Modifier ' \+ nm, function \(\) \{ goPlace\(p\.id\); \}\)/);
  assert.match(inline, /iconBtn\('i-trash', 'Supprimer ' \+ nm/);
  assert.ok(!/btn\('Modifier', 'sm', function \(\) \{ goPlace/.test(inline), 'no textual Modifier button left in the list');
  assert.match(inline, /function removePlace\(pid\) \{ mutate\('places', function \(d\) \{ d\.items = d\.items\.filter\(function \(p\) \{ return p\.id !== pid; \}\); \}\); \}/);
  assert.equal((inline.match(/d\.items = d\.items\.filter\(function \(p\) \{ return p\.id !== /g) || []).length, 1, 'a single place-deletion implementation');
  assert.match(inline, /if \(!isNew\) removePlace\(w\.id\);/);
  assert.ok(!/assets/.test(inline.slice(inline.indexOf('function removePlace'), inline.indexOf('function removePlace') + 700)), 'removePlace never touches assets');
  // dock symbols: — and X, full names kept as accessible labels
  assert.match(html, /<button type="button" id="vMin" aria-label="Minimiser" title="Minimiser">—<\/button>/);
  assert.match(html, /<button type="button" id="vEnd" aria-label="Terminer" title="Terminer">X<\/button>/);
  assert.match(inline, /act === 'add-cat'\) editCategory\(a, null\)/);
  assert.ok(!/function sampleNotice|Photo d’exemple intégrée|function categoryList|categories: function/.test(inline));
  assert.ok(!/id="vCats"|id="vPrice"|#vCats|#vPrice/.test(html), 'no Catégories / Tarifs button in the admin dock');
  // admin dock = green indicator + gear + minimise + end, nothing else
  const dock = html.slice(html.indexOf('id="vdock"'), html.indexOf('</div>', html.indexOf('id="vdock"')));
  assert.deepEqual([...dock.matchAll(/<button[^>]*id="(\w+)"/g)].map(m => m[1]), ['vGear', 'vMin', 'vEnd']);
  assert.match(dock, /class="vdot"/);
  assert.ok(!/Édition<\/span>|class="vl"/.test(dock));
  assert.match(html, /\$\('#vGear'\)\.addEventListener\('click', ?function\(\)\{openSheet\(\['palette'\],'Apparence'\)\}\)|\$\('#vGear'\)\.addEventListener\('click',function\(\)\{openSheet\(\['palette'\],'Apparence'\)\}\)/);
  // category editor: no Titre / Sous-titre fields, icon without its name, category chosen from the existing list
  const catEd = inline.slice(inline.indexOf('function editCategory('), inline.indexOf('function editPlace('));
  assert.ok(catEd.length > 500 && !/field\('Titre'|field\('Sous-titre|text: 'Sous-titre'|personnalisée'/.test(catEd), 'no title / subtitle / custom-name field in the category editor');
  assert.match(inline, /iconOnly: true/);
  for (const label of ['Catégorie correspondante', 'Catégorie de l’établissement', 'Monter la catégorie', '+ NOUVEL ÉTABLISSEMENT', '← Retour', 'Remplacer cette photo']) assert.ok(inline.includes(label), label);
  assert.ok(!inline.includes('AJOUTER UN AUTRE ÉTABLISSEMENT'), 'the in-panel “add another” flow is replaced');
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
  // gallery: ONE entry per category; a selected category shows only its own establishments (related by category id);
  // built-in sample photos are only a fallback for a category that has no real establishment
  assert.match(html, /function catProjects\(id\)/);
  assert.match(html, /CATEGORIES\.forEach\(function\(c\)\{var l=catProjects\(c\.id\);if\(l\.length\)list\.push\(\{_cat:c,first:l\[0\]\}\)\}\)/);
  assert.match(html, /if\(b\.dataset\.cat\)\{activeCat=b\.dataset\.cat;renderDomains\(\);renderGallery\(\);return\}/);
  // banner: the reserved container keeps a FIXED ratio whatever the uploaded file (framing is applied inside it)
  assert.ok(!/--banner-ar/.test(html));
  assert.match(html, /\.hero-art\{[^}]*aspect-ratio:2110\/690/);
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
  // a NEW establishment starts empty (never pre-filled with the category title, which made a second one look like a duplicate);
  // uniqueness is checked inside the same category only; public card shows category then name
  assert.match(inline, /title: '', description: '', photos: \[\], mainPhoto: null, active: true/);
  assert.ok(!/title: w\.label/.test(inline));
  assert.match(inline, /p\.category === w\.category && p\.id !== w\.id && norm\(p\.title\) === norm\(t\)/);
  assert.ok(!/oldLabel/.test(inline), 'renaming a category never rewrites establishment names');
  assert.match(html, /function capHtml\(p\)/);
  assert.match(html, /class="cap-cat"/);
});

test('image frames + gallery viewer: reusable framing, fixed containers, per-photo captions, thumbnails', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = fs.readFileSync(path.join(root, 'admin-inline.js'), 'utf8');
  // reserved spaces: logos have a fixed box and never size themselves from the file
  assert.match(html, /\.brand\{[^}]*overflow:hidden/);
  assert.match(html, /\.brand img\{[^}]*object-fit:contain/);
  assert.match(html, /\.badge-frame/);
  assert.match(html, /\.foot-frame/);
  // one reusable framing function used by banner, logos and cards
  assert.match(html, /function applyFrame\(/);
  assert.match(html, /window\.vectisApplyFrame=applyFrame/);
  assert.match(inline, /function framePicker\(/);
  assert.match(inline, /fit: 'contain'/);
  // admin: per-photo captions keyed by photo id, moved on replace, dropped on removal
  assert.match(inline, /w\.captions\[j\.assetId\] = w\.captions\[old\]/);
  assert.match(inline, /delete w\.captions\[pid\]/);
  assert.match(inline, /Aperçu de la galerie/);
  // public viewer: thumbnails, selected state, arrows share one state, caption per photo with legacy fallback
  assert.match(html, /id="lbThumbs"/);
  assert.match(html, /aria-selected/);
  assert.match(html, /p\.captions\[ids\[k\]\]/);
  assert.match(html, /it\.cap\|\|p\.desc/);
});

test('viewer main photo is shown whole (contain, fills the stage box) and banner zoom floor is full coverage', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = fs.readFileSync(path.join(root, 'admin-inline.js'), 'utf8');
  assert.match(html, /\.lb \.lb-stage img\{position:absolute;inset:0;width:100%;height:100%;[^}]*object-fit:contain/);
  assert.match(html, /\.lb-th img\{[^}]*object-fit:cover/);            // thumbnails unchanged
  assert.match(html, /\.card img\{[^}]*object-fit:cover/);              // cards unchanged
  assert.match(inline, /type: 'range', min: '1', max: '4', step: '0\.01'/);
  assert.match(inline, /Réduction maximale atteinte/);
});

test('footer MR PROP promo: fourth zone, original images untouched, editable from the visual editor', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const inline = fs.readFileSync(path.join(root, 'admin-inline.js'), 'utf8');
  // three existing zones kept, a fourth added after them
  const foot = html.slice(html.indexOf('<footer class="site-footer">'), html.indexOf('</footer>'));
  const order = ['id="f-about"', 'id="f-contact"', 'id="f-nav"', 'id="f-promo"'].map((k) => foot.indexOf(k));
  assert.ok(order.every((n) => n > 0) && order.every((n, i) => i === 0 || n > order[i - 1]));
  assert.match(html, /\.foot\{display:grid;grid-template-columns:1\.2fr 1fr 1fr 1\.3fr/);
  assert.match(foot, /<a class="promo-link" id="promoUrl" href="https:\/\/mrprop\.fr" target="_blank" rel="noopener noreferrer">www\.mrprop\.fr<\/a>/);
  assert.match(html, /\.promo-img img\{[^}]*object-fit:contain/);
  // images shipped byte-for-byte as static files (not recreated, not recompressed)
  for (const f of ['mrprop-logo.jpg', 'mrprop-qr.png']) {
    assert.ok(fs.statSync(path.join(root, 'assets', f)).size > 100000, f);
    assert.ok(foot.includes('assets/' + f), f);
  }
  const sig = (f) => fs.readFileSync(path.join(root, 'assets', f)).subarray(0, 4).toString('hex');
  assert.equal(sig('mrprop-qr.png'), '89504e47');
  assert.equal(sig('mrprop-logo.jpg').slice(0, 4), 'ffd8');
  // no frame around the promo; QR alone under the title; logo moved to the bottom legal row, between legal links and copyright
  assert.match(html, /\.promo-card\{--pm:1;width:min\(100%,calc\(300px\*var\(--pm\)\)\);margin:0 auto\}/);
  assert.ok(!/\.promo-card\{[^}]*(border|background|box-shadow|padding)/.test(html));
  assert.equal((foot.match(/id="promoQr"/g) || []).length, 1);
  assert.ok(foot.indexOf('class="legal-brand"') > foot.indexOf('data-soon') && foot.indexOf('class="legal-brand"') < foot.indexOf('class="co"'));
  assert.match(html, /\.foot\{align-items:start\}/);
  assert.match(html, /\.foot-promo h3\{text-align:center\}/);   // title on the same axis as QR + address
  assert.match(inline, /\.legal-brand/);
  // public applier + admin editor (same editor, same publish flow, no new panel)
  assert.match(html, /function applyPromo\(p\)/);
  assert.match(inline, /function editPromo\(el\)/);
  assert.match(inline, /t\.closest\('#promo'\)/);
  assert.match(inline, /upload\(file, IMG, raw\)/);
  assert.match(inline, /mutate\('brand'/);
});

test('footer logo: the artwork edge (not the image box) is aligned with the VECTIS title and tagline; custom framing is respected', () => {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /function alignFootLogo\(im\)/);
  assert.match(html, /if\(custom\)return;/);                         // explicit framing chosen in the editor wins
  assert.match(html, /if\(img\.classList\.contains\('foot-logo'\)\)alignFootLogo\(img\)/);
  assert.match(html, /\.foot-frame\{display:block;height:46px;width:calc\(46px\*4\.097\);margin-bottom:10px;overflow:hidden\}/); // size and spacing unchanged
});
