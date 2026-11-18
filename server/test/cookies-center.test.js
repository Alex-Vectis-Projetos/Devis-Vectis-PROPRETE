'use strict';

// Gestion des cookies : l'audit (aucun cookie/stockage/tiers côté site public) est verrouillé par des tests ; la page décrit exactement cela.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// gestion-des-cookies.html cite ces API dans son texte explicatif ; elle n'a aucun <script> (vérifié plus bas).
test('public site writes no cookie nor web storage (audit lock)', () => {
  for (const f of ['index.html', 'legal/legal.css', 'mentions-legales.html', 'politique-de-confidentialite.html']) {
    const t = read(f);
    assert.ok(!/document\.cookie|localStorage|sessionStorage|indexedDB/.test(t), f + ' : écriture de stockage côté navigateur interdite sans consentement');
  }
});

test('public site loads no third-party resource', () => {
  const t = read('index.html');
  assert.ok(!/<(script|link|img|iframe)[^>]+(src|href)="https?:\/\/(?!mrprop\.fr)/.test(t.replace(/<a [^>]*>/g, '')), 'aucune ressource tierce chargée automatiquement');
  assert.ok(!/google-analytics|googletagmanager|gtag\(|fbq\(|hotjar|matomo|plausible|clarity\.ms/i.test(t));
});

test('the only cookie set by the server is the admin session cookie, set on successful login only', () => {
  const app = read('server/src/app.js');
  const sets = app.match(/setCookie\(/g) || [];
  assert.equal(sets.length, 1);
  assert.match(app, /\/api\/admin\/auth\/verify/);
  assert.match(read('server/src/config.js'), /__Host-vectis_admin/);
});

test('gestion-des-cookies.html: matches the audit, no fake consent controls, linked from the footer', () => {
  const h = read('gestion-des-cookies.html');
  assert.match(h, /<title>Gestion des cookies — VECTIS<\/title>/);
  assert.match(h, /__Host-vectis_admin/);
  assert.match(h, /8 heures/);
  assert.match(h, /aucun cookie/i);
  assert.ok(!/<button|<input|type="checkbox"|Tout accepter|Tout refuser/i.test(h), 'pas de faux réglages : aucun cookie facultatif n’existe');
  assert.ok(!/<script/i.test(h));
  assert.match(read('index.html'), /<a href="gestion-des-cookies\.html">Gestion des cookies<\/a>/);
  assert.ok(!/data-soon/.test(read('index.html')), 'plus aucun bouton provisoire');
  for (const f of ['mentions-legales.html', 'politique-de-confidentialite.html']) assert.match(read(f), /href="gestion-des-cookies\.html"/);
  for (const m of h.matchAll(/href="([^"#]+)"/g)) if (!/^(https?:|mailto:|tel:)/.test(m[1])) assert.ok(fs.existsSync(path.join(root, m[1])), 'lien cassé ' + m[1]);
});
