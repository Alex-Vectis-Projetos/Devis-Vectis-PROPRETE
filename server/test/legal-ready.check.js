'use strict';
// Garde de publication (hors `npm test`) : échoue si une page publique contient encore un marqueur ou un avertissement interne.
// Usage : node server/test/legal-ready.check.js
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const BAD = [/\[À COMPLÉTER[^\]]*\]/g, /\[À (SER )?PREENCHER[^\]]*\]/gi, /class="(todo|lg-banner)"/g, /à renseigner/gi, /ne doit pas être publiée/gi];
let pending = 0;
for (const f of ['index.html', 'qui-sommes-nous.html', 'mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html']) {
  const t = fs.readFileSync(path.join(root, f), 'utf8');
  let n = 0;
  for (const re of BAD) { const m = t.match(re) || []; n += m.length; m.forEach((x) => console.log('   ' + f + ' : ' + x)); }
  pending += n;
  console.log(f + ' : ' + n + ' marqueur(s) public(s)');
}
if (pending) { console.error('\nNON PUBLIABLE : ' + pending + ' marqueur(s) public(s).'); process.exit(1); }
console.log('OK : aucun marqueur ni avertissement interne dans les pages publiques.');
