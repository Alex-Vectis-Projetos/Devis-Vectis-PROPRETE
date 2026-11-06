'use strict';

const { AuthService } = require('./auth');
const { MailError } = require('./mailer');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const MSG = {
  rateLimited: 'Trop de demandes. Réessayez dans quelques minutes.',
  invalidEmail: 'Adresse e-mail invalide.',
  invalidCode: 'Code invalide ou expiré.',
  badRequest: 'Requête invalide.',
  unauthorized: 'Session expirée. Veuillez vous reconnecter.',
  server: 'Service momentanément indisponible.',
  mailNotConfigured: "La messagerie n'est pas encore configurée sur le serveur.",
};

async function buildApp({ config, db, mailer, keys, now = Date.now, logger = true }) {
  const Fastify = require('fastify');
  const app = Fastify({
    logger:
      logger === true
        ? { level: process.env.LOG_LEVEL || 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] }
        : logger,
    trustProxy: config.trustProxy,
    bodyLimit: 4096,
    // Reject unknown fields instead of silently stripping them.
    ajv: { customOptions: { removeAdditional: false } },
  });
  await app.register(require('@fastify/cookie'));

  const auth = new AuthService({ db, config, keys, mailer, now, log: (o) => app.log.info(o) });
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
  };

  // ---------- global guards ----------

  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');

    if (MUTATING.has(req.method)) {
      // Browsers always send Origin on cross-site and same-origin POSTs. Anything else is refused.
      if (req.headers.origin !== config.publicOrigin) {
        req.log.warn({ event: 'origin_rejected' });
        return reply.code(403).send({ ok: false, error: 'forbidden_origin', message: MSG.badRequest });
      }
      if (!/^application\/json(\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
        return reply.code(415).send({ ok: false, error: 'unsupported_media_type', message: MSG.badRequest });
      }
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err.validation || err.statusCode === 400 || err.code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.code(400).send({ ok: false, error: 'bad_request', message: MSG.badRequest });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ ok: false, error: 'bad_request', message: MSG.badRequest });
    }
    req.log.error({ err: { message: err.message, code: err.code } }, 'unhandled error');
    return reply.code(500).send({ ok: false, error: 'server_error', message: MSG.server });
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ ok: false, error: 'not_found' }));

  // ---------- session helpers ----------

  function currentSession(req) {
    const sid = req.cookies && req.cookies[config.cookieName];
    if (!sid) return null;
    const session = auth.getSession(sid);
    return session ? { sid, ...session } : null;
  }

  /** Protects administrative endpoints. State changing requests also need the CSRF header. */
  async function requireAdmin(req, reply) {
    const session = currentSession(req);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'unauthorized', message: MSG.unauthorized });
    }
    if (MUTATING.has(req.method) && !auth.checkCsrf(session.sid, req.headers['x-csrf-token'])) {
      return reply.code(403).send({ ok: false, error: 'csrf', message: MSG.badRequest });
    }
    req.admin = session;
  }

  const emailBody = {
    type: 'object',
    required: ['email'],
    additionalProperties: false,
    properties: { email: { type: 'string', maxLength: 254 } },
  };
  const verifyBody = {
    type: 'object',
    required: ['email', 'code'],
    additionalProperties: false,
    properties: { email: { type: 'string', maxLength: 254 }, code: { type: 'string', maxLength: 16 } },
  };
  const anyBody = { type: 'object', additionalProperties: false, properties: {} };

  // ---------- public ----------

  app.get('/api/health', async () => {
    db.prepare('SELECT 1 AS ok').get();
    return { ok: true };
  });

  // ---------- administrator authentication ----------

  app.post('/api/admin/auth/request', { schema: { body: emailBody } }, async (req, reply) => {
    const r = auth.requestCode({ email: req.body.email, ip: req.ip });
    if (r.status === 'invalid') return reply.code(400).send({ ok: false, error: 'invalid_email', message: MSG.invalidEmail });
    if (r.status === 'rate_limited') {
      reply.header('Retry-After', String(r.retryAfterSec));
      return reply.code(429).send({ ok: false, error: 'rate_limited', message: MSG.rateLimited });
    }
    return { ok: true, message: r.message };
  });

  app.post('/api/admin/auth/verify', { schema: { body: verifyBody } }, async (req, reply) => {
    const r = auth.verifyCode({ email: req.body.email, code: req.body.code, ip: req.ip });
    if (r.status === 'rate_limited') {
      reply.header('Retry-After', String(r.retryAfterSec));
      return reply.code(429).send({ ok: false, error: 'rate_limited', message: MSG.rateLimited });
    }
    if (r.status !== 'ok') return reply.code(401).send({ ok: false, error: 'invalid_code', message: MSG.invalidCode });
    reply.setCookie(config.cookieName, r.sessionId, { ...cookieOptions, maxAge: Math.floor(config.sessionTtlMs / 1000) });
    return { ok: true, email: r.email, expiresAt: r.expiresAt, csrfToken: r.csrfToken };
  });

  app.get('/api/admin/auth/session', async (req) => {
    const session = currentSession(req);
    if (!session) return { authenticated: false, mailReady: mailer.ready() };
    return { authenticated: true, email: session.email, expiresAt: session.expiresAt, csrfToken: session.csrfToken };
  });

  app.post('/api/admin/auth/logout', { schema: { body: anyBody } }, async (req, reply) => {
    const session = currentSession(req);
    if (session) {
      if (!auth.checkCsrf(session.sid, req.headers['x-csrf-token'])) {
        return reply.code(403).send({ ok: false, error: 'csrf', message: MSG.badRequest });
      }
      auth.logout(session.sid, req.ip);
    }
    reply.clearCookie(config.cookieName, cookieOptions);
    return { ok: true };
  });

  app.get('/api/admin/ping', { preHandler: requireAdmin }, async (req) => ({ ok: true, email: req.admin.email }));

  // ---------- mailbox authorization (Microsoft Graph, one time) ----------

  app.get('/api/mail/status', async () => ({ configured: mailer.configured(), connected: mailer.ready() }));

  /**
   * Open while no mailbox is connected (needed to bootstrap login by e-mail).
   * Once connected, only an authenticated administrator can change it.
   * Only the configured sender account can complete the Microsoft sign-in.
   */
  async function mailConnectGate(req, reply) {
    if (mailer.ready()) return requireAdmin(req, reply);
    return undefined;
  }

  app.post('/api/mail/connect/start', { schema: { body: anyBody }, preHandler: mailConnectGate }, async (req, reply) => {
    const limited = auth.hit('mail:ip:' + auth.ipHash(req.ip), config.limits.mailConnectPerIp);
    if (!limited.allowed) {
      reply.header('Retry-After', String(limited.retryAfterSec));
      return reply.code(429).send({ ok: false, error: 'rate_limited', message: MSG.rateLimited });
    }
    try {
      const flow = await mailer.startDeviceFlow();
      auth.event('mail_connect_started', { ipHash: auth.ipHash(req.ip) });
      return { ok: true, ...flow };
    } catch (err) {
      if (err instanceof MailError && err.code === 'mail_not_configured') {
        return reply.code(503).send({ ok: false, error: err.code, message: MSG.mailNotConfigured });
      }
      req.log.error({ err: { message: err.message, code: err.code } }, 'device flow start failed');
      return reply.code(502).send({ ok: false, error: 'mail_unavailable', message: MSG.server });
    }
  });

  app.post('/api/mail/connect/poll', { schema: { body: anyBody }, preHandler: mailConnectGate }, async (req, reply) => {
    const limited = auth.hit('mailpoll:ip:' + auth.ipHash(req.ip), { limit: 240, windowMs: 3600 * 1000 });
    if (!limited.allowed) {
      reply.header('Retry-After', String(limited.retryAfterSec));
      return reply.code(429).send({ ok: false, error: 'rate_limited', message: MSG.rateLimited });
    }
    try {
      const r = await mailer.pollDeviceFlow();
      if (r.status === 'connected') auth.event('mail_connected', { subject: r.account, ipHash: auth.ipHash(req.ip) });
      if (r.status === 'error') auth.event('mail_connect_failed', { detail: r.reason, ipHash: auth.ipHash(req.ip) });
      return { ok: true, status: r.status, reason: r.reason };
    } catch (err) {
      req.log.error({ err: { message: err.message, code: err.code } }, 'device flow poll failed');
      return reply.code(502).send({ ok: false, error: 'mail_unavailable', message: MSG.server });
    }
  });

  return { app, auth };
}

module.exports = { buildApp, MSG };
