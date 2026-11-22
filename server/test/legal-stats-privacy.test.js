'use strict';

// Documentation de la mesure d'audience et section institutionnelle : chaque affirmation publique est confrontée au code réel
// (stats.js, stats-retention.js, security) ou aux documents officiels ; rien d'inventé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const policy = read('politique-de-confidentialite.html');
const cookies = read('gestion-des-cookies.html');
const mentions = read('mentions-legales.html');
const index = read('index.html');
const audience = policy.split('<h2 id="audience">')[1].split('<h2>7.')[0];
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('policy: the audience section describes exactly what stats.js collects and stores', () => {
  const stats = require('../src/stats');
  assert.deepEqual(stats.TYPES, ['view', 'category_view', 'gallery_open', 'form_open', 'form_start', 'phone_click', 'email_click']);
  for (const w of ['visite', 'catégorie consultée', 'galerie', 'formulaire de devis', 'début de saisie', 'téléphone', 'e-mail']) assert.ok(audience.includes(w), 'événement non documenté : ' + w);
  assert.equal(stats.SESSION_GAP_MS, 30 * 60 * 1000);
  assert.match(audience, /30 minutes d’inactivité/);
  assert.match(audience, /ne dépasse jamais un jour/);
  assert.match(audience, /HMAC/);
  assert.match(audience, /supprimé le lendemain/);
  assert.match(audience, /aucun identifiant persistant/);
  assert.match(audience, /ne mesure donc pas les visiteurs « nouveaux » ou « récurrents »/);
  assert.match(audience, /DNT/); assert.match(audience, /GPC/);
  assert.match(audience, /Ce n’est pas de l’anonymisation/);
  assert.match(audience, /données à caractère personnel/);
  assert.match(audience, /sauvegardes[^]*secret du jour/i);
  assert.match(audience, /art\. 11 RGPD/);
});

test('policy: code facts behind the statements (IP/UA never persisted, daily salt, DNT/GPC, admins excluded, quotes from the table)', () => {
  const src = read('server/src/stats.js');
  assert.match(src, /sec-gpc/); assert.match(src, /dnt/);
  assert.match(src, /stats:salt:/);
  assert.match(src, /DELETE FROM kv WHERE key LIKE 'stats:salt:%'/);
  assert.match(src, /randomBytes\(32\)/);
  assert.match(src, /'admin'/);
  const insert = src.match(/INSERT OR IGNORE INTO stats_events \(([^)]*)\)/)[1];
  assert.equal(insert.replace(/\s/g, ''), 'at,day,sid,vkey,type,target,device', 'aucune colonne ip / user-agent');
  assert.ok(!/\b(ip|ua|user_agent|agent)\b/.test(insert));
  const rep = read('server/src/stats-report.js');
  assert.match(rep, /SELECT created_at, status FROM quotes/);
});

test('policy: retention figures come from the code (90 days / 25 months) and are stated once, consistently', () => {
  const r = require('../src/stats-retention');
  assert.equal(r.RAW_RETENTION_DAYS, 90);
  assert.equal(r.DAILY_RETENTION_MONTHS, 25);
  assert.match(policy, /90 jours, puis suppression automatique/);
  assert.match(policy, /25 mois, puis suppression automatique/);
});

test('policy: audience measurement is listed with its legal basis; backups, Nginx and Docker logs are covered; durations not provided stay pending', () => {
  assert.match(policy, /Mesure d’audience du site[^]*Intérêt légitime/);
  assert.match(policy, /La requête de mesure d’audience n’y est pas enregistrée/);
  assert.match(policy, /Journal d’erreurs du serveur web et journaux des conteneurs \(Docker\)[^]*À COMPLÉTER/);
  assert.match(audience, /Durée de conservation des sauvegardes : <span class="todo">/);
  assert.match(audience, /État de la mesure d’audience à la date de publication : <span class="todo">/);
  assert.match(policy, /<h2>9\. Responsabilités de VECTIS<\/h2>/);
  // la route de collecte est bien exclue du journal d'accès Nginx dans le dépôt (déjà appliqué en production)
  assert.match(read('deploy/nginx-devis-vectis-api.conf'), /location = \/api\/stats\/e \{[^}]*access_log off;/);
});

test('cookies page: consistent with audience measurement (no cookie, no stored info, DNT/GPC, no false claim of "no audience tool")', () => {
  const t = text(cookies);
  assert.ok(!/n’utilise aucun outil de mesure d’audience/.test(t), 'ancienne affirmation devenue fausse');
  assert.match(t, /sans cookie/);
  assert.match(t, /n’écrit ni ne lit aucune information stockée sur votre appareil/);
  assert.match(t, /DNT/); assert.match(t, /GPC/);
  assert.match(cookies, /href="politique-de-confidentialite\.html#audience"/);
  assert.ok(!/<button|<input|checkbox/i.test(cookies));
  const m = text(mentions);
  assert.ok(!/n’utilise ni cookie publicitaire ni outil de mesure d’audience/.test(m));
  assert.ok(!/n’utilise ni cookie publicitaire ni outil de mesure d’audience/.test(text(policy)));
});

test('index.html footer: Qui sommes-nous ?, Mentions, Politique, Cookies, Contact — all resolve; no placeholder button left', () => {
  const bar = index.split('<div class="wrap legal">')[1].split('</div>')[0];
  const links = [...bar.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(links.slice(0, 5), [
    ['Qui sommes-nous ?', '#qui-sommes-nous'],
    ['Mentions légales', 'mentions-legales.html'],
    ['Politique de confidentialité', 'politique-de-confidentialite.html'],
    ['Gestion des cookies', 'gestion-des-cookies.html'],
    ['Contact', '#contact'],
  ]);
  assert.match(index, /<section class="wrap who" id="qui-sommes-nous"/);
  assert.match(index, /<section class="sect" id="contact"/);
  assert.ok(!/<button type="button" data-soon>/.test(index));
  for (const [, h] of links) if (!h.startsWith('#')) assert.ok(fs.existsSync(path.join(root, h)), h);
});

test('Qui sommes-nous: only facts from the Kbis / statutes / site copy, nothing invented', () => {
  const who = index.split('id="qui-sommes-nous"')[1].split('</section>')[0].replace(/^[^>]*>/, '');
  const t = text(who);
  for (const s of ['SASU', 'RCS de Lyon', 'Vénissieux', 'entreprises', 'bureaux', 'commerces', 'cabinets', 'pharmacies', 'Lúcia De Fátima Da Silva', 'Alex Da Silva De Souza', 'mandataire']) assert.ok(t.includes(s), 'manque : ' + s);
  assert.ok(!/certifi|iso ?\d|label|garanti|\b\d+ ans\b|depuis \d{4}|années? d’expérience|\b\d+ (clients|salariés|employés|collaborateurs|agents)\b|leader|n° ?1|meilleur/i.test(t), 'aucune certification, ancienneté, chiffre ou superlatif non documenté');
  assert.ok(!/Alex[^.]{0,80}(Président|dirigeant|gérant|représentant légal)/.test(t.replace(/n’est pas/g, '')), 'Alex jamais présenté comme dirigeant');
  assert.ok(!/passeport|née? le|Rio Das Ostras|Muniz|Brésil/i.test(who), 'aucune donnée personnelle du Kbis');
  assert.match(who, /href="mentions-legales\.html"/);
});

test('mentions légales: hosting names Hostinger only, no invented legal entity, address or phone', () => {
  const h = mentions.split('<h2>3. Hébergement</h2>')[1].split('<h2>4.')[0];
  assert.match(h, /Hostinger/);
  assert.ok(!/UAB|Ltd|Limited|Kaunas|Vilnius|Lituanie|Chypre|Cyprus|Lithuania|\+\d{2,3} ?\d/.test(h), 'rien d’inventé sur l’entité Hostinger');
  assert.equal((h.match(/class="todo"/g) || []).length, 3);
  const kbis = mentions.split('<h2>2.')[0];
  assert.match(kbis, /Lúcia De Fátima Da Silva, Présidente/);
});
