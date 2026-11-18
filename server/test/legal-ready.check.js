'use strict';
// Garde de publication (hors `npm test`) : échoue tant qu'une page juridique contient un « [À COMPLÉTER … ] ».
// Usage : node server/test/legal-ready.check.js
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
let pending = 0;
for (const f of ['mentions-legales.html', 'politique-de-confidentialite.html', 'gestion-des-cookies.html']) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const m = fs.readFileSync(p, 'utf8').match(/\[À COMPLÉTER[^\]]*\]/g) || [];
  pending += m.length;
  console.log(f + ' : ' + m.length + ' élément(s) en attente');
  m.forEach((x) => console.log('   ' + x));
}
if (pending) { console.error('\nNON PUBLIABLE : ' + pending + ' information(s) en attente.'); process.exit(1); }
console.log('OK : aucune information en attente.');
