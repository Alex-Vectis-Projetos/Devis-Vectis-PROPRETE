'use strict';

const { loadConfig, assertRunnable } = require('./config');
const { deriveKeys } = require('./security');
const { openDatabase, migrate, syncAdmins } = require('./db');
const { GraphMailer } = require('./mailer');
const { buildApp } = require('./app');

async function main() {
  const config = loadConfig();
  assertRunnable(config);
  const keys = deriveKeys(config.sessionSecret);

  const db = openDatabase(config.dbPath);
  const version = migrate(db);
  syncAdmins(db, config.adminEmails);

  const mailer = new GraphMailer({ db, config, keys });
  await mailer.init();

  const { app, auth } = await buildApp({ config, db, mailer, keys });
  app.log.info(
    { schema: version, admins: config.adminEmails.length, mailConfigured: mailer.configured(), mailConnected: mailer.ready() },
    'starting devis-vectis-api'
  );

  auth.cleanup();
  const timer = setInterval(() => auth.cleanup(), 60 * 60 * 1000);
  timer.unref();

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
