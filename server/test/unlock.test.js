'use strict';

// B1: the unlock command documented in deploy/README-AUTH.md is executed for real (minus `sudo -u`),
// against a temporary database and environment file, to prove it works and lifts a suspension.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const readme = fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'README-AUTH.md'), 'utf8');
const serverDir = path.join(__dirname, '..');

let sqliteAvailable = true;
try { require.resolve('better-sqlite3'); } catch (_) { sqliteAvailable = false; }

function documentedCommand() {
  const m = readme.match(/^sudo -u devis-vectis-api bash -c '([^']+)'$/m);
  assert.ok(m, 'README documents `sudo -u devis-vectis-api bash -c \'…\'`');
  return m[1];
}

test('README unlock command reads api.env inside the service account shell, not in a $(…) outside sudo', () => {
  assert.doesNotMatch(readme, /sudo -u [^\n]*\$\(\s*grep[^\n]*api\.env/);
  const inner = documentedCommand();
  assert.match(inner, /set -a; \. \/etc\/devis-vectis\/api\.env; set \+a;/);
  assert.match(inner, /node scripts\/unlock-admin\.js$/);
});

test('documented unlock command really lifts a 24h suspension', { skip: sqliteAvailable ? false : 'better-sqlite3 not installed in this environment' }, () => {
  const { AuthService } = require('../src/auth');
  const { deriveKeys } = require('../src/security');
  const { openDatabase, migrate, syncAdmins } = require('../src/db');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unlock-'));
  const envFile = path.join(dir, 'api.env');
  const dbPath = path.join(dir, 'devis.db');
  const secret = 'unlock-test-secret-unlock-test-secret-0123456789';
  fs.writeFileSync(envFile, [
    '# commentaire comme dans le vrai fichier',
    'NODE_ENV=production', 'HOST=127.0.0.1', 'PORT=3100', 'PUBLIC_ORIGIN=http://localhost',
    'COOKIE_SECURE=false', `DB_PATH=${dbPath}`, 'ADMIN_EMAILS=admin@example.test', `SESSION_SECRET=${secret}`, '',
  ].join('\n'));

  // Seed: administrator exists and the daily failure counter is at its limit (= suspended).
  const config = require('../src/config').loadConfig({ ADMIN_EMAILS: 'admin@example.test', SESSION_SECRET: secret, COOKIE_SECURE: 'false', PUBLIC_ORIGIN: 'http://localhost' });
  const db = openDatabase(dbPath);
  migrate(db);
  syncAdmins(db, config.adminEmails);
  const auth = new AuthService({ db, config, keys: deriveKeys(secret), mailer: { ready: () => false } });
  db.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)').run(auth.failKey('admin@example.test'), Date.now(), config.limits.failPerAdmin.limit);
  assert.equal(auth.peek(auth.failKey('admin@example.test'), config.limits.failPerAdmin).blocked, true);
  db.close();

  const inner = documentedCommand()
    .replace('/etc/devis-vectis/api.env', envFile)
    .replace('/opt/devis-vectis/server', serverDir);
  // Run from an unrelated directory and with a hostile environment: only what the command sources must matter.
  const res = spawnSync('bash', ['-c', inner], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir }, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /suspension lifted/);
  assert.doesNotMatch(res.stdout + res.stderr, new RegExp(secret));

  const db2 = openDatabase(dbPath);
  const auth2 = new AuthService({ db: db2, config, keys: deriveKeys(secret), mailer: { ready: () => false } });
  assert.equal(auth2.peek(auth2.failKey('admin@example.test'), config.limits.failPerAdmin).blocked, false);
  assert.ok(db2.prepare("SELECT 1 FROM auth_events WHERE type='admin_unlocked_by_operator'").get());
  db2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unlock refuses an unknown address and prints no secret', { skip: sqliteAvailable ? false : 'better-sqlite3 not installed in this environment' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unlock2-'));
  const secret = 'unlock-test-secret-unlock-test-secret-0123456789';
  const env = { PATH: process.env.PATH, HOME: dir, ADMIN_EMAILS: 'admin@example.test', SESSION_SECRET: secret, COOKIE_SECURE: 'false',
    PUBLIC_ORIGIN: 'http://localhost', DB_PATH: path.join(dir, 'x.db') };
  const res = spawnSync('node', [path.join(serverDir, 'scripts', 'unlock-admin.js'), 'stranger@example.test'], { env, encoding: 'utf8' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /unknown administrator address/);
  assert.doesNotMatch(res.stdout + res.stderr, new RegExp(secret));
  fs.rmSync(dir, { recursive: true, force: true });
});
