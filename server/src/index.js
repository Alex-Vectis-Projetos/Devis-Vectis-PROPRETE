'use strict';

const { loadConfig, assertRunnable } = require('./config');
const { deriveKeys } = require('./security');
const { openDatabase, migrate, syncAdmins } = require('./db');
const { GmailMailer } = require('./mailer');
const { PreviewMailer } = require('./stats-preview');
const { buildApp } = require('./app');
const { startRetentionJob } = require('./stats-retention');

async function main() {
  const config = loadConfig();
  assertRunnable(config);
  const keys = deriveKeys(config.sessionSecret);

  const db = openDatabase(config.dbPath);
  const version = migrate(db);
  syncAdmins(db, config.adminEmails);

  // PREVIEW_MODE (demonstration site): no Gmail, no network mail. Refused in production by assertRunnable.
  const mailer = config.previewMode ? new PreviewMailer() : new GmailMailer({ db, config, keys });
  await mailer.init();

  const { app, auth } = await buildApp({ config, db, mailer, keys });
  app.log.info(
    {
      schema: version,
      admins: config.adminEmails.length,
      mailConfigured: mailer.configured(),
      mailConnected: mailer.ready(),
      mailAccount: mailer.account(),
      mailSender: config.mailSender || null,
      quoteRecipient: config.quoteRecipient,
    },
    'starting devis-vectis-api'
  );
  if (mailer.ready() && !mailer.senderMatches()) {
    app.log.warn({ mailAccount: mailer.account(), mailSender: config.mailSender || null }, 'MAIL_SENDER differs from the connected Google account: Gmail will rewrite the From of outgoing mail');
  }

  auth.cleanup();
  const timer = setInterval(() => auth.cleanup(), 60 * 60 * 1000);
  timer.unref();
  // Statistics retention (90 days raw / 25 months daily): roll-up then purge; does nothing while the statistics tables are empty.
  startRetentionJob({ db, log: (o) => app.log.info(o, 'stats retention') });

  await app.listen({ host: config.host, port: config.port });

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // Never print the environment: only the validation problems or the message.
  console.error('devis-vectis-api failed to start:', err.problems ? err.problems.join('; ') : err.message);
  process.exit(1);
});
