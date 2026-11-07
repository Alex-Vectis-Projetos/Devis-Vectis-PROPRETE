'use strict';

// Operator tool: lifts the 24h suspension of code login for an administrator.
//   sudo -u devis-vectis-api env $(grep -v '^#' /etc/devis-vectis/api.env | xargs) node scripts/unlock-admin.js <email>
// It only deletes the failure counter and records an audit event. No secret is printed.

const { loadConfig, assertRunnable } = require('../src/config');
const { deriveKeys, normalizeEmail } = require('../src/security');
const { openDatabase, migrate } = require('../src/db');
const { AuthService } = require('../src/auth');

try {
  const config = loadConfig();
  assertRunnable(config);
  const email = normalizeEmail(process.argv[2] || config.adminEmails[0]);
  if (!email || !config.adminEmails.includes(email)) throw new Error('unknown administrator address');
  const db = openDatabase(config.dbPath);
  migrate(db);
  const auth = new AuthService({ db, config, keys: deriveKeys(config.sessionSecret), mailer: { ready: () => false } });
  console.log(auth.unlock(email) ? 'suspension lifted' : 'no suspension was active');
  db.close();
} catch (err) {
  console.error('unlock-admin failed:', err.problems ? err.problems.join('; ') : err.message);
  process.exit(1);
}
