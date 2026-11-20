#!/usr/bin/env node
'use strict';

/**
 * Dry-run of the schema migration on a COPY of a SQLite file. It never modifies the file it is given.
 *
 *   node scripts/verify-migration.js /path/to/backup.db
 *
 * 1. opens the file READ-ONLY and takes a consistent snapshot with VACUUM INTO into a private temporary directory;
 * 2. records, for every existing table, the row count and a checksum of all rows;
 * 3. runs the real migrate() on the snapshot;
 * 4. checks that no existing table lost or changed a row, that new tables are empty, that integrity_check and
 *    foreign_key_check pass, that the schema version is the expected one, and that a second run changes nothing;
 * 5. deletes the snapshot. Exit code 0 = safe, 1 = do not deploy.
 *
 * Meant to be run against the verified pre-deploy backup (see deploy/BACKUP-SQLITE.md), inside the new image:
 *   docker run --rm -v "$BK":/bk:ro --entrypoint node <image> scripts/verify-migration.js /bk/devis-<timestamp>.db
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MIGRATIONS, migrate } = require('../src/db');

function open(file, readonly) {
  try {
    const Database = require('better-sqlite3');
    return readonly ? new Database(file, { readonly: true, fileMustExist: true }) : new Database(file);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    const { DatabaseSync } = require('node:sqlite');   // local development only: production images ship better-sqlite3
    return new DatabaseSync(file, readonly ? { readOnly: true } : {});
  }
}
const one = (db, sql) => db.prepare(sql).get();
const all = (db, sql) => db.prepare(sql).all();

function tables(db) {
  return all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
}
function fingerprint(db, name) {
  const rows = all(db, `SELECT * FROM "${name}"`).map((r) => JSON.stringify(r)).sort();
  const h = crypto.createHash('sha256');
  for (const r of rows) h.update(r).update('\n');
  return { rows: rows.length, sha256: h.digest('hex') };
}
function snapshot(db) {
  const out = {};
  for (const t of tables(db)) out[t] = fingerprint(db, t);
  return out;
}
const schemaHash = (db) => crypto.createHash('sha256').update(JSON.stringify(all(db, 'SELECT type, name, sql FROM sqlite_master ORDER BY type, name'))).digest('hex');

function main() {
  const src = process.argv[2];
  const problems = [];
  const say = (s) => console.log(s);
  if (!src) { console.error('usage: node scripts/verify-migration.js <sqlite file>'); return 2; }
  if (/-(wal|shm)$/.test(src)) { console.error('give the .db file, not its -wal/-shm companion'); return 2; }
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) { console.error('file not found: ' + src); return 1; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vectis-migcheck-'));
  const copy = path.join(dir, 'copy.db');
  let ro = null; let db = null;
  try {
    ro = open(src, true);
    const srcVersion = one(ro, 'PRAGMA user_version').user_version;
    const srcIntegrity = all(ro, 'PRAGMA integrity_check').map((r) => r.integrity_check).join(',');
    say(`source : user_version=${srcVersion} integrity_check=${srcIntegrity}`);
    if (srcIntegrity !== 'ok') problems.push('the source file fails integrity_check');
    ro.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    ro.close(); ro = null;

    db = open(copy, false);
    db.exec('PRAGMA foreign_keys = ON');
    const before = snapshot(db);
    const beforeSchema = schemaHash(db);
    say('tables avant :');
    for (const [t, f] of Object.entries(before)) say(`  ${t}: ${f.rows} ligne(s)`);

    let after = before; let version = srcVersion;
    try {
      version = migrate(db);
    } catch (err) {
      problems.push('migrate() failed: ' + err.message);
      const kept = one(db, 'PRAGMA user_version').user_version;
      if (kept !== srcVersion) problems.push(`failed migration left user_version=${kept} (expected rollback to ${srcVersion})`);
      if (schemaHash(db) !== beforeSchema) problems.push('failed migration left a partial schema (not rolled back)');
    }
    if (!problems.length) {
      after = snapshot(db);
      say(`migration : user_version ${srcVersion} -> ${version} (attendu ${MIGRATIONS.length})`);
      if (version !== MIGRATIONS.length) problems.push(`user_version is ${version}, expected ${MIGRATIONS.length}`);
      for (const [t, f] of Object.entries(before)) {
        if (!after[t]) problems.push(`table ${t} disappeared`);
        else if (after[t].rows !== f.rows || after[t].sha256 !== f.sha256) problems.push(`table ${t} changed (${f.rows} -> ${after[t].rows} rows or different content)`);
      }
      const added = Object.keys(after).filter((t) => !before[t]);
      say('tables ajoutées : ' + (added.length ? added.map((t) => `${t} (${after[t].rows} ligne(s))`).join(', ') : 'aucune'));
      for (const t of added) if (after[t].rows !== 0) problems.push(`new table ${t} is not empty`);
      const integrity = all(db, 'PRAGMA integrity_check').map((r) => r.integrity_check).join(',');
      const fk = all(db, 'PRAGMA foreign_key_check').length;
      say(`après : integrity_check=${integrity} foreign_key_violations=${fk}`);
      if (integrity !== 'ok') problems.push('integrity_check failed after migration');
      if (fk !== 0) problems.push(`${fk} foreign key violation(s) after migration`);
      const s1 = schemaHash(db);
      migrate(db);
      if (schemaHash(db) !== s1 || JSON.stringify(snapshot(db)) !== JSON.stringify(after)) problems.push('a second migrate() changed the database (not idempotent)');
      else say('seconde exécution : aucun changement (idempotent)');
    }
  } catch (err) {
    problems.push('unexpected error: ' + err.message);
  } finally {
    try { if (ro) ro.close(); } catch (_) { /* already closed */ }
    try { if (db) db.close(); } catch (_) { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (problems.length) {
    say('RESULTAT : ECHEC — ne pas déployer');
    for (const p of problems) say('  - ' + p);
    return 1;
  }
  say('RESULTAT : OK — aucune donnée existante perdue ou modifiée (copie jetée, fichier source non modifié)');
  return 0;
}

process.exit(main());
