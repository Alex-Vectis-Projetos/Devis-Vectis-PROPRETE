'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig } = require('../src/config');
const { deriveKeys } = require('../src/security');
const { migrate, syncAdmins } = require('../src/db');

const ADMIN = 'admin@example.test';
const SETUP_TOKEN = 'setup-token-setup-token-0123456789';
const SECRET = 'test-secret-test-secret-test-secret-0123456789';

function memoryDb() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    return db;
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    return db;
  }
}

function testConfig(extra = {}) {
  return {
    ...loadConfig({
      ADMIN_EMAILS: ADMIN,
      SESSION_SECRET: SECRET,
      PUBLIC_ORIGIN: 'https://devis.test',
      COOKIE_SECURE: 'false',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      MAIL_SENDER: ADMIN,
      MAIL_SETUP_TOKEN: SETUP_TOKEN,
    }),
    uploadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'vectis-uploads-')),
    ...extra,
  };
}

class FakeMailer {
  constructor({ ready = true } = {}) {
    this.sent = [];
    this.isReady = ready;
    this.fail = false;
  }
  configured() { return true; }
  ready() { return this.isReady; }
  async sendLoginCode(msg) {
    if (this.fail) throw Object.assign(new Error('boom'), { code: 'gmail_send_failed_500' });
    this.sent.push(msg);
  }
  lastCode() { return this.sent.length ? this.sent[this.sent.length - 1].code : null; }
}

function setup({ now, config, mailer } = {}) {
  const cfg = config || testConfig();
  const db = memoryDb();
  migrate(db);
  syncAdmins(db, cfg.adminEmails);
  const keys = deriveKeys(cfg.sessionSecret);
  return { cfg, db, keys, mailer: mailer || new FakeMailer(), now };
}

module.exports = { ADMIN, SETUP_TOKEN, SECRET, memoryDb, testConfig, FakeMailer, setup };
