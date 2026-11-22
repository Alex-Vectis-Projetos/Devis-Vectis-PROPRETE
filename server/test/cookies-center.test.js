'use strict';

// Gestion des cookies : l'audit (aucun cookie/stockage/tiers côté site public) est verrouillé par des tests ; la page décrit exactement cela.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Le seul script du site public qui écrit dans le navigateur est stats-consent.js, et seulement la clé du choix du visiteur.
test('public site writes no cookie; the only browser storage is the visitor\'s own consent choice, written on click', () => {
  for (const f of ['index.html', 'legal/legal.css', 'mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html', 'qui-sommes-nous.html', 'stats-collect.js', 'legal/consent-panel.js']) {
    const t = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<code>[^<]*<\/code>/g, '');
    assert.ok(!/document\.cookie|sessionStorage|indexedDB|localStorage\.(set|remove)Item/.test(t), f + ' : aucune écriture de stockage hors du module de consentement');
  }
  const c = read('stats-consent.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/document\.cookie|sessionStorage|indexedDB/.test(c));
  assert.equal((c.match(/setItem\(/g) || []).length, 1, 'une seule écriture : le choix');
  assert.match(c, /setItem\(KEY, JSON\.stringify\(\{ v: 1, c: c, t: Date\.now\(\) \}\)\)/);
  assert.match(c, /var KEY = 'vectis_stats_consent'/);
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(c), 'le module de consentement ne fait aucune requête réseau');
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

test('gestion-des-cookies.html: matches the audit, equal Accept/Refuse controls, only local scripts, linked from the footer', () => {
  const h = read('gestion-des-cookies.html');
  assert.match(h, /<title>Gestion des cookies — VECTIS<\/title>/);
  assert.match(h, /__Host-vectis_admin/);
  assert.match(h, /8 heures/);
  assert.match(h, /aucun cookie/i);
  assert.match(h, /id="cNo">Tout refuser<\/button>\s*<button type="button" class="lg-btn" id="cYes">Tout accepter<\/button>/, 'deux boutons de même classe');
  assert.match(h, /id="cAud"/); assert.match(h, /id="cConfirm">Confirmer mes choix<\/button>/);
  assert.match(h, /Fonctionnement du site \(nécessaire\)[^]*Toujours actif/);
  assert.ok(!/<input[^>]*id="cAud"[^>]*checked/.test(h), 'mesure d’audience désactivée par défaut');
  assert.ok(!/\schecked\b/i.test(h), 'aucune case précochée');
  const scripts = [...h.matchAll(/<script[^>]*\ssrc="([^"?]+)/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ['stats-consent.js', 'legal/consent-panel.js']);
  assert.ok(!/<script(?![^>]*\ssrc=)/.test(h), 'aucun script en ligne');
  assert.match(read('index.html'), /<a href="gestion-des-cookies\.html">Gestion des cookies<\/a>/);
  assert.ok(!/data-soon/.test(read('index.html')), 'plus aucun bouton provisoire');
  for (const f of ['mentions-legales.html', 'politique-de-confidentialite.html']) assert.match(read(f), /href="gestion-des-cookies\.html"/);
  for (const m of h.matchAll(/href="([^"#]+)"/g)) if (!/^(https?:|mailto:|tel:)/.test(m[1])) assert.ok(fs.existsSync(path.join(root, m[1])), 'lien cassé ' + m[1]);
  for (const m of h.matchAll(/src="([^"?]+)/g)) assert.ok(fs.existsSync(path.join(root, m[1])), 'script manquant ' + m[1]);
});
