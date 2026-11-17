'use strict';

// Pas de « flash » de l'ancienne bannière : l'image d'origine intégrée n'est jamais l'image affichée au premier rendu.
// Contrôles statiques de index.html ; le comportement chargé est vérifié par le harnais d'instrumentation (voir la PR).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const strip = (s) => s.replace(/base64,[A-Za-z0-9+/=]+/g, 'base64,…');
const light = strip(html);

test('hero image: the built-in banner is a fallback value (data-default), not the initial src', () => {
  const m = light.match(/<div class="hero-art"><img ([^>]*)>/);
  assert.ok(m, 'hero-art img present');
  assert.ok(!/\ssrc=/.test(' ' + m[1]), 'no src at first render : aucune image avant de savoir laquelle est la bonne');
  assert.match(m[1], /data-default="data:image\/webp;base64,…"/);
  assert.match(m[1], /data-mobile="data:image\/webp;base64,…"/);
  assert.match(m[1], /\salt=""/, 'no non-empty alt without src (it would render as text)');
  assert.match(m[1], /data-alt="Bannière VECTIS/);
});

test('banner: applyBanner reads its fallback from data-default and sets the alt together with the image', () => {
  assert.match(light, /BDEF=\{d:img\.getAttribute\('data-default'\),m:img\.getAttribute\('data-mobile'\)\}/);
  assert.match(light, /img\.setAttribute\('alt',img\.getAttribute\('data-alt'\)/);
  assert.ok(!/BDEF=\{d:img\.getAttribute\('src'\)/.test(light));
});

test('content request: a single /api/site/content request, started at the very top of the document, consumed by the end-of-page script', () => {
  const head = light.slice(0, light.indexOf('<main>'));
  assert.match(head, /window\.__siteContent=p/);
  assert.match(head, /fetch\('\/api\/site\/content'/);
  assert.match(head, /new Image\(\)/, 'published banner preloaded as soon as its id is known');
  const boot = light.slice(light.indexOf('Aucune image n\'est affichée avant de savoir'));
  assert.match(boot, /window\.__siteContent\|\|Promise\.resolve\(null\)/);
  assert.ok(!/fetch\('\/api\/site\/content'/.test(boot), 'le script de fin ne refait pas la requête');
});

test('banner boot: no default image at startup; default only when the API answered without a published banner; retries when the API fails', () => {
  const boot = light.slice(light.indexOf('Aucune image n\'est affichée avant de savoir'));
  assert.ok(!/^\s*try\{applyBanner\(null\)\}catch\(e\)\{\}\s+\/\*/m.test(boot), 'plus d\'application immédiate de la bannière d\'origine');
  assert.match(boot, /else if\(j&&j\.ok\)\{try\{applyBanner\(null\)\}catch\(e\)\{\}applyPlaces\(null\);renderBuiltin\(\)\}/);
  assert.match(boot, /else if\(tries<2\)setTimeout\(function\(\)\{boot\(window\.__loadSiteContent\(\),tries\+1\)\},4000\*\(tries\+1\)\)/);
  assert.ok(!/setTimeout\(function\(\)\{try\{applyBanner/.test(boot), 'aucun repli temporisé vers l\'ancienne bannière');
});

test('domains + gallery: not rendered from the built-in values at startup; rendered only once content is known (or in explicit degraded mode)', () => {
  assert.ok(!/renderDomains\(\);renderGallery\(\);addProp\(false\);route\(\);/.test(light), 'plus de rendu initial des valeurs intégrées');
  assert.match(light, /<p class="gal-note" hidden>/, 'la note « Photos d\'exemple » est masquée par défaut');
  assert.match(light, /function renderBuiltin\(\)\{var n=\$\('\.gal-note'\);if\(n\)n\.hidden=false;/);
  assert.match(light, /else renderBuiltin\(\);/, 'mode dégradé après la dernière tentative');
});
