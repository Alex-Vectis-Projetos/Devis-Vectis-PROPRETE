'use strict';

// Dry-run tool for the schema migration (scripts/verify-migration.js) and the forward-only behaviour of migrate().
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { MIGRATIONS, migrate } = require('../src/db');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-migration.js');

function openFile(file) {
  try { const D = require('better-sqlite3'); return new D(file); } catch (_) { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(file); }
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vectis-mig-'));

/** A database as production has it before this release: migrations 1 to 4 applied, with data in every table. */
function populated(dir, { versions = 4 } = {}) {
  const file = path.join(dir, 'devis.db');
  const db = openFile(file);
  db.exec('PRAGMA foreign_keys = ON');
  for (let v = 0; v < versions; v++) { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); }
  const now = 1_700_000_000_000;
  db.exec(`
    INSERT INTO admins (email, created_at) VALUES ('a@example.test', ${now}), ('b@example.test', ${now});
    INSERT INTO login_codes (email, code_hash, created_at, expires_at) VALUES ('a@example.test', 'h', ${now}, ${now + 600000});
    INSERT INTO sessions (id_hash, email, created_at, expires_at) VALUES ('s1', 'a@example.test', ${now}, ${now + 1000});
    INSERT INTO auth_events (at, type, subject, ip_hash) VALUES (${now}, 'login_success', 'a@example.test', 'iphash');
    INSERT INTO rate_limits (key, window_start, count) VALUES ('estimate:x', ${now}, 3);
    INSERT INTO kv (key, value, updated_at) VALUES ('k', 'v', ${now});
    INSERT INTO site_content (section, value, version, updated_at, updated_by) VALUES ('texts', '{"a":1}', 2, ${now}, 'a@example.test');
    INSERT INTO assets (id, mime, bytes, sha256, created_at, created_by) VALUES ('${'a'.repeat(32)}', 'image/png', 10, 'sha', ${now}, 'a@example.test');
    INSERT INTO quotes (id, submission_id, status, payload, photo_count, created_at, sent_at) VALUES
      ('q1', 'sub1', 'sent', '{"x":1}', 1, ${now}, ${now + 1}), ('q2', 'sub2', 'received', '{"y":2}', 0, ${now}, NULL), ('q3', 'sub3', 'mail_failed', '{}', 0, ${now}, NULL);
    INSERT INTO quote_photos (quote_id, idx, prop, name, mime, bytes, file) VALUES ('q1', 0, 0, 'p.png', 'image/png', 10, 'f.png');
  `);
  db.close();
  return file;
}
const run = (file) => spawnSync(process.execPath, [SCRIPT, file], { encoding: 'utf8' });

test('migration list: 5 forward-only steps, the last one only adds the statistics tables', () => {
  assert.equal(MIGRATIONS.length, 5);
  assert.doesNotMatch(MIGRATIONS[4], /\b(DROP|ALTER|DELETE|UPDATE|INSERT)\b/i, 'migration 5 never touches existing data or tables');
  assert.deepEqual([...MIGRATIONS[4].matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]), ['stats_events', 'stats_daily']);
});

test('dry-run on a populated v4 database: nothing lost or changed, new tables empty, idempotent, source untouched', () => {
  const dir = tmp();
  const file = populated(dir);
  const before = sha(file);
  const r = run(file);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /user_version=4 integrity_check=ok/);
  assert.match(r.stdout, /user_version 4 -> 5/);
  assert.match(r.stdout, /stats_events \(0 ligne/);
  assert.match(r.stdout, /stats_daily \(0 ligne/);
  assert.match(r.stdout, /quotes: 3 ligne/);
  assert.match(r.stdout, /idempotent/);
  assert.match(r.stdout, /RESULTAT : OK/);
  assert.equal(sha(file), before, 'the source file is byte-identical afterwards');
  assert.deepEqual(fs.readdirSync(dir), ['devis.db'], 'no leftover file next to the source');
  assert.ok(!fs.readdirSync(os.tmpdir()).some((d) => d.startsWith('vectis-migcheck-')), 'temporary copy removed');
});

test('dry-run on a database already at v5 changes nothing', () => {
  const dir = tmp();
  const file = populated(dir, { versions: 5 });
  const r = run(file);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /user_version 5 -> 5/);
  assert.match(r.stdout, /tables ajoutées : aucune/);
});

test('dry-run reports a failing migration, proves it was rolled back, and still never touches the source', () => {
  const dir = tmp();
  const file = populated(dir);
  const db = openFile(file);
  db.exec('CREATE TABLE stats_events (x INTEGER)');   // conflicts with migration 5 → CREATE TABLE fails
  db.close();
  const before = sha(file);
  const r = run(file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /RESULTAT : ECHEC/);
  assert.match(r.stdout, /migrate\(\) failed/);
  assert.doesNotMatch(r.stdout, /partial schema|left user_version/, 'the failed migration is fully rolled back');
  assert.equal(sha(file), before);
});

test('dry-run refuses a missing file, a -wal companion and a corrupt file', () => {
  const dir = tmp();
  assert.equal(run(path.join(dir, 'nope.db')).status, 1);
  assert.equal(run(path.join(dir, 'devis.db-wal')).status, 2);
  const bad = path.join(dir, 'bad.db');
  fs.writeFileSync(bad, 'this is not a database at all');
  const r = run(bad);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /ECHEC|error|not a database/i);
});

test('rollback of the code is safe: a database at a higher schema version is left untouched by migrate()', () => {
  const dir = tmp();
  const file = populated(dir, { versions: 5 });
  const db = openFile(file);
  const schema = () => JSON.stringify(db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all());
  const s0 = schema();
  db.exec('PRAGMA user_version = 6');                      // a future schema, as an older release would see after a newer one ran
  assert.equal(migrate(db), 6);                            // forward-only loop: nothing to do, no error
  assert.equal(schema(), s0);
  db.close();
});
