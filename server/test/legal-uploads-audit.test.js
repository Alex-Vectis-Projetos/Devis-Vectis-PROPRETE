'use strict';

// Verrouille les constats de deploy/UPLOADS-AUDIT.md et les affirmations de la politique de confidentialité sur les photographies :
// si le code change (nouvelle destination, suppression, route de lecture), ces tests échouent et la politique doit être revue.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const srcDir = path.join(root, 'server', 'src');
const src = (f) => fs.readFileSync(path.join(srcDir, f), 'utf8');
const policy = read('politique-de-confidentialite.html');
const flat = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('uploads: photo endpoints, validations and storage are exactly those documented', () => {
  const q = src('quotes.js');
  for (const r of ["'/api/quotes'", "'/api/quotes/:id/photos'", "'/api/quotes/:id/finalize'"]) assert.ok(q.includes(r), r);
  assert.match(q, /const IMAGE_MAX = 10 \* 1024 \* 1024/);
  assert.match(q, /const PHOTO_TYPES = \['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(q, /sniff\(body\)/);
  assert.match(q, /tokenOk\(row\.id, req\.headers\['x-quote-token'\]\)/);
  assert.match(q, /mode: 0o700/); assert.match(q, /mode: 0o600/);
  assert.match(q, /path\.join\(config\.uploadDir, 'quotes'\)/);
  assert.match(read('server/src/config.js'), /quoteMaxBytes: Number\(env\.QUOTE_MAX_BYTES \|\| 150 \* 1024 \* 1024\)/);
  assert.match(read('docker-compose.yml'), /devis_vectis_data:\/var\/lib\/devis-vectis/);
  assert.match(read('docker-compose.yml'), /DB_PATH: \/var\/lib\/devis-vectis\/devis\.db/);
});

test('uploads: no route serves or lists the quote photos (only finalize reads them to build the e-mail)', () => {
  const reads = [];
  for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.js'))) {
    const t = src(f);
    for (const m of t.matchAll(/(readFileSync|createReadStream|sendFile)\(([^)]*)\)/g)) reads.push(f + ': ' + m[2].slice(0, 60));
    if (/FROM quote_photos/.test(t)) assert.ok(['quotes.js', 'db.js'].includes(f), 'lecture de quote_photos hors de quotes.js : ' + f);
  }
  const quoteReads = reads.filter((r) => r.startsWith('quotes.js'));
  assert.equal(quoteReads.length, 1, JSON.stringify(quoteReads));
  assert.match(quoteReads[0], /path\.join\(dir, r\.file/);
  // la route publique des images du site n'accepte que des identifiants de la table assets (32 hexadécimaux) : pas de « <id>-<idx> »
  assert.match(src('site.js'), /\/\^\[0-9a-f\]\{32\}\$\/\.test\(id\)/);
  assert.match(src('site.js'), /SELECT mime FROM assets WHERE id = \?/);
  const quoteGets = src('quotes.js').match(/app\.get\(/g) || [];
  assert.equal(quoteGets.length, 0, 'aucune route GET dans quotes.js');
});

test('photo destinations: only Google (Gmail API) outside the server; recipient is VECTIS, never the requester', () => {
  const hosts = new Set();
  for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.js'))) for (const m of src(f).matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) hosts.add(m[1]);
  assert.deepEqual([...hosts].sort(), ['accounts.google.com', 'devis.mrprop.fr', 'gmail.googleapis.com', 'oauth2.googleapis.com', 'openidconnect.googleapis.com', 'www.googleapis.com']);
  const mailer = src('mailer.js');
  assert.match(mailer, /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/);
  assert.match(src('quotes.js'), /to: config\.quoteRecipient/);
  assert.match(src('quotes.js'), /replyTo: q\.contact\.email/);
  assert.ok(!/to:\s*q\.contact/.test(src('quotes.js')), 'aucune copie envoyée au demandeur');
  const pkg = JSON.parse(read('server/package.json'));
  for (const d of Object.keys(pkg.dependencies || {})) assert.ok(!/aws-sdk|@aws|s3|cloudinary|azure|firebase|sentry|datadog|googleapis|sharp|imagekit|twilio|sendgrid|mailgun|nodemailer/i.test(d), 'dépendance susceptible de transmettre des fichiers : ' + d);
});

test('retention: no code deletes quotes, quote photos or their files; the policy says so and invents no duration', () => {
  for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith('.js'))) {
    const t = src(f);
    assert.ok(!/DELETE FROM (quotes|quote_photos)/.test(t), f);
    if (f === 'quotes.js') assert.ok(!/unlinkSync|rmSync|fs\.rm\(|fs\.unlink\(/.test(t), 'quotes.js ne supprime aucun fichier');
  }
  const t = flat(policy);
  assert.match(t, /Aucune suppression automatique n’est en place à ce jour ; vous pouvez demander l’effacement de vos données à tout moment/);
  const row = policy.split('Demandes de devis (base de données) et photographies jointes')[1].split('</tr>')[0];
  assert.ok(!/\b\d+ (an|ans|mois|jours)\b/.test(row), 'aucune durée inventée');
});

test('policy: photo statements match the code (metadata, browser re-encoding thresholds, Gmail attachment, hosting, no other service)', () => {
  const t = flat(policy);
  const idx = read('index.html');
  assert.match(idx, /PHOTO_OPT=\{maxSide:2560,trigger:3200,bytes:2\.5\*1048576,quality:\.86\}/);
  assert.match(t, /plus de 2,5 Mo ou de plus de 3 200 pixels/);
  assert.match(t, /VECTIS ne supprime pas leurs métadonnées à la réception/);
  assert.ok(!/EXIF|supprim[ée]es? (les )?métadonnées automatiquement/i.test(t));
  assert.match(t, /via l’API Gmail, avec les photographies en pièces jointes/);
  assert.match(t, /adressé à VECTIS \(adresse administrative\) et non à vous/);
  assert.match(t, /Hostinger, qui héberge le serveur/);
  assert.match(t, /Aucun autre service externe ne reçoit les photographies/);
  assert.match(t, /Leur envoi exige un jeton propre à chaque demande/);
  assert.match(t, /10 Mo maximum par photo/);
  // pas de garantie non prouvée
  assert.ok(!/chiffr[ée]s? (au repos|sur le disque)|sauvegardes? (chiffr|automatique)|purge automatique|supprimées? après \d|conservées? (pendant )?\d/i.test(t), 'aucune garantie ni durée non prouvée');
});

test('institutional wording: default site texts address individuals and professionals consistently', () => {
  const idx = read('index.html');
  assert.match(idx, /<li><svg class="ic"><use href="#i-check"\/><\/svg>Particuliers et professionnels<\/li>/);
  assert.match(idx, /VECTIS accompagne les particuliers et les professionnels dans l'entretien de leurs locaux : logements,/);
  const who = read('qui-sommes-nous.html');
  assert.match(who, /Nous intervenons chez les <strong>particuliers<\/strong> comme auprès des <strong>professionnels<\/strong>/);
  assert.ok(!/accompagne les professionnels dans/.test(idx));
});

test('mediation: obligation documented as pending and not operational; no mediator anywhere in the public pages', () => {
  const doc = read('deploy/LEGAL-PENDING.md');
  assert.match(doc, /la médiation n'est donc pas opérationnelle/);
  assert.match(doc, /ne déclarent \*\*aucune conformité juridique complète\*\*/);
  for (const f of ['mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html', 'index.html', 'qui-sommes-nous.html']) {
    assert.ok(!/(CM2C|MEDICYS|Médiation (de la consommation )?AME|ANM Conso|FNMJ|mediateur-|médiateur de la consommation (est|:)\s*[A-Z])/.test(read(f)), f);
  }
  assert.ok(!/médiat/i.test(read('mentions-legales.html')), 'aucune médiation affichée tant qu’aucun médiateur n’est contracté');
});

test('audit document exists and lists proven destinations, retention and unproven items', () => {
  const d = read('deploy/UPLOADS-AUDIT.md');
  for (const w of ['## 1. Origine', '## 2. Validations', '## 3. Stockage', '## 4. Accès', '## 5. Destinations', '## 6. Conservation', '**Prouvé', 'Non prouvé', '/var/lib/devis-vectis/uploads', 'gmail.googleapis.com', 'Autre service externe', 'Aucun trouvé', 'aucune suppression']) assert.ok(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(d), 'manque : ' + w);
});
