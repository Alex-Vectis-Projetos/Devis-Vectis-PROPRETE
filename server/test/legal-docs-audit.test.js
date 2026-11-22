'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('VPS audit guide: sections A-G, read-only (no destructive command)', () => {
  const s = rd('deploy/VPS-AUDIT-READONLY.md');
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) assert.match(s, new RegExp('^#+ .*\\b' + k + '[ .)—-]', 'm'), 'section ' + k);
  const cmds = s.split('```').filter((_, i) => i % 2 === 1).join('\n');
  const forbidden = [/\brm\s/, /\bmv\s/, /\bchmod\b/, /\bchown\b/, /\bprune\b/, /docker\s+compose\s+down/, /\bdown\s+-v\b/,
    /systemctl\s+(restart|reload|stop)/, /nginx\s+-s\b/, /\bsed\s+-i/, /\btee\b/, /(^|[^<>|2&])>\s*[\/~]/m, /\bdocker\s+(rm|stop|restart|kill|volume\s+rm)\b/,
    /logrotate\s+(-f|--force)/, /\bcat\s+\/etc\/devis-vectis\/api\.env/];
  for (const re of forbidden) assert.doesNotMatch(cmds, re, String(re));
});

test('retention proposal: three-way distinction, categories, nothing published', () => {
  const s = rd('deploy/RETENTION-PROPOSAL.md');
  assert.match(s, /Obligation légale/); assert.match(s, /Recommandation CNIL/); assert.match(s, /Proposition/);
  for (const c of ['Devis non convertis', 'Clients et contrats', 'Photographies', 'Gmail', 'Sauvegardes', 'Nginx', 'Docker']) assert.match(s, new RegExp(c));
  assert.match(s, /rien n'est implémenté/i);
  const pol = rd('politique-de-confidentialite.html');
  assert.doesNotMatch(pol, /3 ans|10 ans/);
});

test('CGV survey: topics present, nothing invented, no public CGV claim', () => {
  const s = rd('deploy/CGV-SURVEY.md');
  for (const c of ['Information précontractuelle', 'Prix', 'Paiement', 'Exécution', 'rétractation', 'début d\'exécution', 'Réclamations', 'Médiation']) assert.match(s, new RegExp(c, 'i'), c);
  assert.match(s, /aucune CGV n'existe/i);
  for (const f of ['index.html', 'mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html'])
    assert.doesNotMatch(rd(f), /conditions générales de vente|\bCGV\b/i, f);
});

test('LEGAL-PENDING: blocking vs separable classification and references', () => {
  const s = rd('deploy/LEGAL-PENDING.md');
  assert.match(s, /À traiter en priorité/); assert.match(s, /Peuvent attendre/);
  for (const d of ['VPS-AUDIT-READONLY', 'RETENTION-PROPOSAL', 'CGV-SURVEY']) assert.match(s, new RegExp(d));
});

test('stats activation guide: checklist mapped to tests, admin-only commands, no secret printed, no global Docker command', () => {
  const s = rd('deploy/STATS-ACTIVATION.md');
  for (const k of ['Aucun événement avant le consentement', 'DNT et GPC', 'Aucun suivi nominal', 'quotes.status', 'Retour arrière', 'pseudonymisées']) assert.match(s, new RegExp(k));
  const cmds = s.split('```').filter((_, i) => i % 2 === 1).join('\n');
  assert.match(cmds, /docker compose up -d --no-deps api/);
  assert.doesNotMatch(cmds, /\bcat\s+\/etc\/devis-vectis|printenv\s*$|docker\s+(system|volume|network)\s+(prune|rm)|compose down|\bprune\b|\brm\s+-rf/m);
  assert.doesNotMatch(cmds, /docker (stop|kill|rm)\b/);
  assert.match(rd('deploy/LEGAL-PENDING.md'), /Contact affiché sur le site[^]*hotmail[^]*vectis\.adm@gmail\.com/);
});

test('compose: STATS_ENABLED is set on the api service only; nothing else of the deployment changes', () => {
  const c = rd('docker-compose.yml');
  assert.match(c, /\n {6}STATS_ENABLED: "true"\n/);
  assert.equal((c.match(/STATS_ENABLED/g) || []).length, 1, 'une seule variable');
  assert.match(c, /TRUST_PROXY: 172\.16\.11\.1/);
  assert.match(c, /env_file:\n {6}- \/etc\/devis-vectis\/api\.env/);
  assert.match(c, /devis_vectis_data:\/var\/lib\/devis-vectis/);
  assert.equal((c.match(/^ {2}[a-z]+:\n {4}container_name/gm) || []).length, 1, 'un seul service');
  assert.match(rd('deploy/STATS-ACTIVATION.md'), /## 0\. Activation effectuée \(23\/11\/2026\)/);
});

test('legal representation analysis: exact provisions, documents, alternative; no personal data', () => {
  const s = rd('deploy/LEGAL-REPRESENTATION.md');
  for (const k of ['Art. 1-1, I, 2°', 'Art. 1-1, I, 3°', 'Art. 93-2', '18-81\\.779', 'seul président', 'se présenter en tant que dirigeant', 'Alternative légale']) assert.match(s, new RegExp(k));
  assert.doesNotMatch(s, /passeport|GD939156|FT439910|née? le|Macaé|Muniz|4HJX/i);
});
