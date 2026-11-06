'use strict';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function parseBool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * Reads and validates the runtime configuration.
 * Secrets come only from the environment (/etc/devis-vectis/api.env), never from the repository.
 */
function loadConfig(env = process.env) {
  const cookieSecure = parseBool(env.COOKIE_SECURE, true);
  const adminEmails = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const config = {
    nodeEnv: env.NODE_ENV || 'development',
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 3100),
    publicOrigin: String(env.PUBLIC_ORIGIN || 'https://devis.mrprop.fr').replace(/\/+$/, ''),
    dbPath: env.DB_PATH || '/var/lib/devis-vectis/devis.db',
    sessionSecret: env.SESSION_SECRET || '',
    adminEmails,
    mailSender: String(env.MAIL_SENDER || adminEmails[0] || '').toLowerCase(),
    cookieSecure,
    cookieName: cookieSecure ? '__Host-vectis_admin' : 'vectis_admin',
    msClientId: env.MS_CLIENT_ID || '',
    msTenant: env.MS_TENANT || 'consumers',
    trustProxy: env.TRUST_PROXY || '127.0.0.1',
    // Authentication policy
    codeTtlMs: 10 * MIN,
    codeMaxAttempts: 5,
    codeResendCooldownMs: 30 * 1000,
    sessionTtlMs: 8 * HOUR,
    limits: {
      requestPerIp: { limit: 10, windowMs: HOUR },
      requestPerEmail: { limit: 5, windowMs: 30 * MIN },
      verifyPerIp: { limit: 30, windowMs: 15 * MIN },
      verifyPerEmail: { limit: 15, windowMs: 15 * MIN },
      mailConnectPerIp: { limit: 6, windowMs: HOUR },
    },
  };
  return config;
}

/** Throws if the configuration is unsafe to run with. Used at startup, not by unit tests. */
function assertRunnable(config) {
  const problems = [];
  if (config.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  if (config.adminEmails.length === 0) problems.push('ADMIN_EMAILS must list at least one address');
  if (!/^https?:\/\//.test(config.publicOrigin)) problems.push('PUBLIC_ORIGIN must be an http(s) origin');
  if (config.cookieSecure && !config.publicOrigin.startsWith('https://')) {
    problems.push('COOKIE_SECURE requires an https PUBLIC_ORIGIN');
  }
  if (config.host !== '127.0.0.1' && config.host !== '::1') {
    problems.push('HOST must be loopback: the API is reachable only through Nginx');
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) problems.push('PORT is invalid');
  if (problems.length) {
    const err = new Error('Invalid configuration: ' + problems.join('; '));
    err.problems = problems;
    throw err;
  }
}

module.exports = { loadConfig, assertRunnable, MIN, HOUR };
