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

test('policy: audience measurement is listed with consent as legal basis; logs are covered; no duration is invented', () => {
  assert.match(policy, /Mesure d’audience du site[^]*Votre consentement \(art\. 6\.1\.a RGPD/);
  assert.ok(!/Intérêt légitime : mesure d’audience/.test(policy), 'plus de base « intérêt légitime » pour la mesure');
  assert.match(policy, /Journaux du serveur web \(Nginx\) et des conteneurs \(Docker\)/);
  assert.match(policy, /La requête de mesure d’audience n’est pas enregistrée dans le journal d’accès/);
  assert.match(audience, /Sauvegardes :<\/strong> les sauvegardes de la base contiennent le secret du jour/);
  assert.match(policy, /<h2>9\. Responsabilités de VECTIS<\/h2>/);
  // la route de collecte est bien exclue du journal d'accès Nginx dans le dépôt (déjà appliqué en production)
  assert.match(read('deploy/nginx-devis-vectis-api.conf'), /location = \/api\/stats\/e \{[^}]*access_log off;/);
});

test('policy: the consent mechanism described is the one implemented (equal choice, six months, DNT/GPC win, withdrawal on the cookies page)', () => {
  assert.match(audience, /repose sur <strong>votre consentement<\/strong>[^]*aucun événement n’est envoyé/);
  assert.match(audience, /« Tout accepter », « Tout refuser » et « Personnaliser mes choix », trois boutons de même style et de même taille/);
  assert.match(audience, /désactivée par défaut\) puis de « Confirmer mes choix »/);
  assert.match(audience, /vectis_stats_consent/);
  assert.match(audience, /conservé six mois, puis il vous est redemandé/);
  assert.match(audience, /Ce signal l’emporte sur un consentement antérieur/);
  assert.match(audience, /href="gestion-des-cookies\.html"/);
  const c = read('stats-consent.js');
  assert.match(c, /var KEY = 'vectis_stats_consent'/);
  assert.match(c, /var TTL = 183 \* 24 \* 3600 \* 1000/);
  assert.match(c, /if \(blocked\(\)\) return 'denied'/);
  assert.match(audience, /aucun panneau n’est affiché/);
  assert.match(audience, /n’identifie pas les visiteurs/);
});

test('cookies page: consistent with audience measurement (no cookie, consent first, choice stored only on click, DNT/GPC)', () => {
  const t = text(cookies);
  assert.ok(!/n’utilise aucun outil de mesure d’audience/.test(t), 'ancienne affirmation devenue fausse');
  assert.ok(!/Il n’affiche donc pas de bandeau|aucun réglage de cookies n’est proposé/i.test(t), 'anciennes affirmations devenues fausses');
  assert.match(t, /sans cookie/);
  assert.match(t, /qu’avec votre accord/);
  assert.match(t, /vectis_stats_consent/);
  assert.match(t, /DNT/); assert.match(t, /GPC/);
  assert.match(cookies, /href="politique-de-confidentialite\.html#audience"/);
  const m = text(mentions);
  assert.ok(!/n’utilise ni cookie publicitaire ni outil de mesure d’audience/.test(m));
  assert.match(m, /qu’avec votre accord/);
});

test('index.html footer: Qui sommes-nous ? (own page), Mentions, Politique, Cookies, Contact — all resolve; institutional block removed from the home page', () => {
  const bar = index.split('<div class="wrap legal">')[1].split('</div>')[0];
  const links = [...bar.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(links.slice(0, 5), [
    ['Qui sommes-nous ?', 'qui-sommes-nous.html'],
    ['Mentions légales', 'mentions-legales.html'],
    ['Politique de confidentialité', 'politique-de-confidentialite.html'],
    ['Gestion des cookies', 'gestion-des-cookies.html'],
    ['Contact', '#contact'],
  ]);
  assert.ok(!/class="wrap who"|id="qui-sommes-nous"|f-who/.test(index), 'le grand bloc institutionnel n’est plus sur la page d’accueil');
  assert.ok(!/\.who\b/.test(index));
  assert.match(index, /<section class="sect" id="contact"/);
  assert.ok(!/<button type="button" data-soon>/.test(index));
  for (const [, h] of links) if (!h.startsWith('#')) assert.ok(fs.existsSync(path.join(root, h)), h);
});

test('Qui sommes-nous (own page): cleaning company for individuals and professionals; no other activity, no invented claim, no President', () => {
  const who = read('qui-sommes-nous.html');
  assert.match(who, /<title>Qui sommes-nous \? — VECTIS<\/title>/);
  assert.ok(!/noindex/.test(who), 'page institutionnelle indexable');
  const main = who.split('<main')[1].split('</main>')[0];
  const t = text(main);
  for (const s of ['entreprise de nettoyage', 'particuliers', 'professionnels', 'Résidences et logements', 'Bureaux', 'Commerces et boutiques', 'Cabinets médicaux et bureaux médicaux', 'Pharmacies', 'Installations professionnelles', 'Qualité', 'Organisation', 'Confiance', 'Propositions personnalisées', 'Alex Da Silva De Souza', 'associé unique', 'responsable de la gestion administrative', 'représentant par délégation']) assert.ok(t.includes(s), 'manque : ' + s);
  assert.ok(!/véhicule|automobile|auto\b|mécanique|conseil|consulting|consultoria/i.test(t), 'aucune activité hors nettoyage');
  assert.ok(!/Lucia|FATIMA|Lúcia|Présidente|Président/i.test(t), 'la Présidente n’est pas présentée ici');
  assert.ok(!/certifi|iso ?\d|label|garanti|\b\d+ ans\b|depuis \d{4}|années? d’expérience|\b\d+ (clients|salariés|employés|collaborateurs|agents)\b|leader|n° ?1|meilleur/i.test(t), 'aucune certification, ancienneté, chiffre ou superlatif non documenté');
  assert.ok(!/Alex[^.]{0,80}(Président|dirigeant|gérant|représentant légal)/.test(t), 'Alex jamais présenté comme dirigeant');
  assert.ok(!/passeport|née? le|Rio Das Ostras|Muniz|Brésil/i.test(who));
  assert.match(who, /href="mentions-legales\.html"/);
  assert.match(who, /href="index\.html#devis"/);
  assert.match(who, /href="tel:\+33780251128"/);
  assert.ok(!/<script/.test(who), 'page statique : le contenu administrable ne peut pas la modifier');
  assert.ok(!/api\/site\/content|__siteContent/.test(who));
});

test('home contact block: confirmed phone and e-mail by default, never a placeholder; admin content still wins when it is set', () => {
  assert.match(index, /<span>Téléphone : <a href="tel:\+33780251128">\+33 7 80 25 11 28<\/a><\/span>/);
  assert.match(index, /<span>E-mail : <a href="mailto:vectis\.adm@gmail\.com">vectis\.adm@gmail\.com<\/a><\/span>/);
  assert.match(index, /var CONTACT_DEF=\{siren:'107 463 358',phone:'\+33 7 80 25 11 28',email:'vectis\.adm@gmail\.com'\}/);
  assert.match(index, /if\(!c\[k\]\)c\[k\]=CONTACT_DEF\[k\]/, 'seulement quand le champ est vide');
  assert.ok(!/à renseigner/.test(index));
});

test('mentions légales: hosting names Hostinger VPS only, no invented legal entity, address or phone', () => {
  const h = mentions.split('<h2>3. Hébergement</h2>')[1].split('<h2>4.')[0];
  assert.match(h, /Hostinger — Serveur privé virtuel \(VPS\)/);
  assert.ok(!/UAB|Ltd|Limited|Kaunas|Vilnius|Lituanie|Chypre|Cyprus|Lithuania|\+\d{2,3} ?\d/.test(h), 'rien d’inventé sur l’entité Hostinger');
  const kbis = mentions.split('<h2>2.')[0];
  assert.match(kbis, /Directeur de la publication<\/dt><dd>Alex SOUZA/);
});

test('no public page claims an exemption from consent or anonymisation; the CNIL assessment exists and records the consent decision', () => {
  for (const [f, h] of [['politique', policy], ['cookies', cookies], ['mentions', mentions]]) {
    const t = text(h).replace(/ne se prévaut d’aucune dispense de consentement/, '');
    assert.ok(!/dispens|exempt/i.test(t), f + ' : aucune affirmation de dispense de consentement');
  }
  assert.match(cookies, /ne se prévaut d’aucune dispense de consentement/);
  const doc = read('deploy/PRIVACY-CNIL-ASSESSMENT.md');
  assert.match(doc, /ne peut pas être démontrée/);
  assert.match(doc, /Voie A[^]*Voie B/);
  assert.match(doc, /Décision du 22\/11\/2026/);
  for (const w of ['art. 82', '6.1.f', 'pseudonymis', 'anonymes', 'entonnoir']) assert.ok(doc.includes(w), 'manque dans l’analyse : ' + w);
});

test('LEGAL-PENDING.md: no marker left in the pages; every one of the 27 former markers has a status; open obligations are named', () => {
  const doc = read('deploy/LEGAL-PENDING.md');
  const rows = doc.match(/^\| [MPC]\d+ \|[^\n]*\| (R|O|C|N) \| (Résolu|Retiré|Ouvert) \|/gm) || [];
  assert.equal(rows.length, 27);
  for (const f of ['index.html', 'qui-sommes-nous.html', 'mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html']) assert.ok(!/À COMPLÉTER/.test(read(f)), f);
  assert.match(doc, /\| M10 \|[^\n]*\| O \| Retiré \|[^\n]*n'est donc pas opérationnelle/);
  assert.match(doc, /Total 27/);
  assert.match(doc, /Obligations qui restent ouvertes malgré l'absence de marqueur public/);
  assert.match(doc, /Représentante légale et directrice de la publication/);
  assert.match(doc, /M8 \|[^\n]*assets[^\n]*created_by/);
});

test('no page declares overall legal compliance, nor an unproven protection; unproven wording stays out of the public pages', () => {
  for (const [f, h] of [['mentions', mentions], ['politique', policy], ['cookies', cookies], ['qui-sommes-nous', read('qui-sommes-nous.html')]]) {
    const t = text(h).replace(/Aucune mesure ne garantit une sécurité absolue\./, '');
    assert.ok(!/(en|pleine|totale|entière) conformité|conforme (à|au|aux) (la |l’|toute )?(réglementation|loi|RGPD|CNIL)|conformes? (au |aux )?RGPD|certifié|validé par la CNIL|garantit? (une )?(sécurité|protection)|données (sont |restent )?anonym|statistiques anonymes/i.test(t), f + ' : affirmation juridique non prouvée');
    assert.match(h, /Dernière mise à jour|VECTIS — entreprise de nettoyage/);
  }
});

test('LEGAL-PENDING.md: mediation is obligatory, not operational, and names nobody', () => {
  const doc = read('deploy/LEGAL-PENDING.md');
  assert.match(doc, /\| M10 \|/);
  assert.match(doc, /la médiation n'est donc pas opérationnelle/);
}
);
