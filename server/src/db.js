'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * The code below uses only exec/prepare/run/get/all with positional parameters,
 * so it behaves identically on better-sqlite3 (production) and node:sqlite (fallback used by local tests).
 */

function openDatabase(file) {
  const Database = require('better-sqlite3');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

/** Runs fn inside an immediate transaction (write lock taken up front). */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {
      /* the original error matters more */
    }
    throw err;
  }
}

const MIGRATIONS = [
  // 1: administrator authentication
  `
  CREATE TABLE admins (
    email      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE login_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL REFERENCES admins(email) ON DELETE CASCADE,
    code_hash   TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    consumed_at INTEGER,
    ip_hash     TEXT
  );
  CREATE INDEX idx_login_codes_email ON login_codes(email, id);

  CREATE TABLE sessions (
    id_hash    TEXT PRIMARY KEY,
    email      TEXT    NOT NULL REFERENCES admins(email) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    ip_hash    TEXT
  );
  CREATE INDEX idx_sessions_email ON sessions(email);

  CREATE TABLE auth_events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      INTEGER NOT NULL,
    type    TEXT    NOT NULL,
    subject TEXT,
    ip_hash TEXT,
    detail  TEXT
  );
  CREATE INDEX idx_auth_events_at ON auth_events(at);

  CREATE TABLE rate_limits (
    key          TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count        INTEGER NOT NULL
  );

  CREATE TABLE kv (
    key        TEXT PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // 2: editable site content (administration panel). Purely additive: nothing is seeded, no existing table is touched.
  `
  CREATE TABLE site_content (
    section    TEXT PRIMARY KEY,
    value      TEXT    NOT NULL,
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    updated_by TEXT
  );

  CREATE TABLE assets (
    id         TEXT PRIMARY KEY,
    mime       TEXT    NOT NULL,
    bytes      INTEGER NOT NULL,
    sha256     TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT
  );
  CREATE INDEX idx_assets_sha ON assets(sha256);
  `,
];

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db.prepare('PRAGMA user_version').get().user_version;
}

/** Makes the admins table match ADMIN_EMAILS. Removed administrators lose their sessions (cascade). */
function syncAdmins(db, emails, now = Date.now()) {
  transaction(db, () => {
    const insert = db.prepare('INSERT OR IGNORE INTO admins (email, created_at) VALUES (?, ?)');
    for (const email of emails) insert.run(email, now);
    const existing = db.prepare('SELECT email FROM admins').all();
    const del = db.prepare('DELETE FROM admins WHERE email = ?');
    for (const row of existing) if (!emails.includes(row.email)) del.run(row.email);
  });
}

module.exports = { openDatabase, transaction, migrate, syncAdmins, MIGRATIONS };
