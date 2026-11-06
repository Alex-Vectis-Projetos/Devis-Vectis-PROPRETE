'use strict';

// Idempotent: creates or upgrades the SQLite schema and synchronises the administrator list.
// Runs as ExecStartPre of the service, with the service's own user and environment.

const { loadConfig, assertRunnable } = require('../src/config');
const { openDatabase, migrate, syncAdmins } = require('../src/db');

try {
  const config = loadConfig();
  assertRunnable(config);
  const db = openDatabase(config.dbPath);
  const version = migrate(db);
  syncAdmins(db, config.adminEmails);
  const admins = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  console.log(`database ready: schema v${version}, ${admins} administrator(s)`);
  db.close();
} catch (err) {
  console.error('init-db failed:', err.problems ? err.problems.join('; ') : err.message);
  process.exit(1);
}
