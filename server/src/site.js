'use strict';

// Public site content + administration endpoints (content sections and uploaded files).
// Authentication, CSRF and Origin checks are the existing ones: this module only adds routes.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { ContentStore, ContentError, SECTIONS } = require('./content');

const IMAGE_MAX = 10 * 1024 * 1024;
const PDF_MAX = 10 * 1024 * 1024;
const CONTENT_BODY_MAX = 64 * 1024;
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

function renderPdfFirstPage(pdf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vectis-pdf-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return new Promise((resolve, reject) => {
    try {
      fs.writeFileSync(path.join(dir, 'in.pdf'), pdf, { mode: 0o600 });
    } catch (e) { cleanup(); return reject(e); }
    // Fixed arguments, no shell, hard timeout: the PDF content never reaches a command line.
    execFile(
      'pdftoppm',
      ['-png', '-singlefile', '-f', '1', '-l', '1', '-scale-to', '1920', 'in.pdf', 'out'],
      { cwd: dir, timeout: 20000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH || '/usr/bin:/bin' } },
      (err) => {
        try {
          if (err) return reject(Object.assign(new Error('pdf_render_failed'), { code: err.code === 'ENOENT' ? 'pdf_unavailable' : 'pdf_render_failed' }));
          const png = fs.readFileSync(path.join(dir, 'out.png'));
          resolve(png);
        } catch (e) {
          reject(Object.assign(new Error('pdf_render_failed'), { code: 'pdf_render_failed' }));
        } finally { cleanup(); }
      }
    );
  });
}

function registerSiteRoutes(app, { config, db, auth, requireAdmin, now = Date.now, msg }) {
  const store = new ContentStore(db, now);
  fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o700 });

  const versions = () => {
    const out = {};
    for (const s of SECTIONS) { const g = store.get(s); if (g) out[s] = g.version; }
    return out;
  };
  const view = () => {
    const content = {};
    for (const s of SECTIONS) { const g = store.get(s); if (g) content[s] = g.value; }
    return content;
  };

  // ---------- public (read only) ----------

  app.get('/api/site/content', async (req, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return { ok: true, content: view() };
  });

  app.get('/api/site/assets/:id', async (req, reply) => {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f]{32}$/.test(id)) return reply.code(404).send({ ok: false, error: 'not_found' });
    const row = db.prepare('SELECT mime FROM assets WHERE id = ?').get(id);
    if (!row || !row.mime.startsWith('image/')) return reply.code(404).send({ ok: false, error: 'not_found' });
    let data;
    try { data = fs.readFileSync(path.join(config.uploadDir, id)); } catch (_) { return reply.code(404).send({ ok: false, error: 'not_found' }); }
    reply
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Content-Disposition', 'inline')
      .type(row.mime);
    return reply.send(data);
  });

  // ---------- administration ----------

  app.get('/api/admin/site/content', { preHandler: requireAdmin }, async () => ({ ok: true, content: view(), versions: versions() }));

  const putSchema = {
    params: { type: 'object', required: ['section'], properties: { section: { type: 'string', maxLength: 30 } } },
    body: {
      type: 'object',
      required: ['value'],
      additionalProperties: false,
      properties: { value: { type: 'object' }, expectedVersion: { type: 'integer', minimum: 0 } },
    },
  };

  app.put('/api/admin/site/content/:section', { schema: putSchema, bodyLimit: CONTENT_BODY_MAX, onRequest: requireAdmin }, async (req, reply) => {
    const section = req.params.section;
    if (!SECTIONS.includes(section)) return reply.code(404).send({ ok: false, error: 'not_found' });
    try {
      const saved = store.save(section, req.body.value, { email: req.admin.email, expectedVersion: req.body.expectedVersion });
      auth.event('site_content_saved', { subject: req.admin.email, detail: section });
      return { ok: true, section, version: saved.version, value: saved.value };
    } catch (err) {
      if (err instanceof ContentError) {
        return reply.code(err.conflict ? 409 : 422).send({ ok: false, error: err.conflict ? 'conflict' : 'invalid_content', field: err.field, message: err.message });
      }
      throw err;
    }
  });

  // Restores the built-in content of one section (the public site falls back to what it shipped with).
  app.delete('/api/admin/site/content/:section', { onRequest: requireAdmin }, async (req, reply) => {
    const section = req.params.section;
    if (!SECTIONS.includes(section)) return reply.code(404).send({ ok: false, error: 'not_found' });
    db.prepare('DELETE FROM site_content WHERE section = ?').run(section);
    auth.event('site_content_reset', { subject: req.admin.email, detail: section });
    return { ok: true, section };
  });

  // Raw binary upload (no multipart dependency). Content type must be one of the accepted ones AND match the file signature.
  app.addContentTypeParser(UPLOAD_TYPES, { parseAs: 'buffer', bodyLimit: IMAGE_MAX + 1024 }, (req, body, done) => done(null, body));

  app.post('/api/admin/site/assets', { onRequest: requireAdmin, bodyLimit: IMAGE_MAX + 1024 }, async (req, reply) => {
    const limited = auth.hit('upload:' + req.admin.email, config.limits.uploadPerAdmin);
    if (!limited.allowed) {
      reply.header('Retry-After', String(limited.retryAfterSec));
      return reply.code(429).send({ ok: false, error: 'rate_limited', message: msg.rateLimited });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ ok: false, error: 'bad_request', message: msg.badRequest });
    const declared = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const real = sniff(body);
    if (!real || real !== declared) {
      return reply.code(415).send({ ok: false, error: 'unsupported_file', message: 'Format de fichier non pris en charge (JPG, PNG, WEBP ou PDF).' });
    }
    if (real === 'application/pdf' && body.length > PDF_MAX) {
      return reply.code(413).send({ ok: false, error: 'too_large', message: 'Fichier trop volumineux (10 Mo maximum).' });
    }

    const save = (buf, mime) => {
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const existing = db.prepare('SELECT id FROM assets WHERE sha256 = ? AND mime = ?').get(sha, mime);
      if (existing && fs.existsSync(path.join(config.uploadDir, existing.id))) return existing.id;
      const id = crypto.randomBytes(16).toString('hex');
      const final = path.join(config.uploadDir, id);
      const tmp = final + '.part';
      fs.writeFileSync(tmp, buf, { mode: 0o600 });
      fs.renameSync(tmp, final);
      db.prepare('INSERT INTO assets (id, mime, bytes, sha256, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(id, mime, buf.length, sha, now(), req.admin.email);
      return id;
    };

    try {
      if (real === 'application/pdf') {
        let png;
        try { png = await renderPdfFirstPage(body); } catch (err) {
          const unavailable = err.code === 'pdf_unavailable';
          return reply.code(unavailable ? 503 : 422).send({ ok: false, error: err.code, message: unavailable ? 'La conversion des PDF n’est pas disponible sur le serveur.' : 'Impossible de lire la première page de ce PDF.' });
        }
        const sourceId = save(body, 'application/pdf'); // original kept untouched
        const imageId = save(png, 'image/png');
        auth.event('site_asset_uploaded', { subject: req.admin.email, detail: 'pdf' });
        return { ok: true, assetId: imageId, sourceId, kind: 'pdf' };
      }
      const id = save(body, real);
      auth.event('site_asset_uploaded', { subject: req.admin.email, detail: real });
      return { ok: true, assetId: id, sourceId: id, kind: 'image' };
    } catch (err) {
      req.log.error({ err: { message: err.message, code: err.code } }, 'asset save failed');
      return reply.code(500).send({ ok: false, error: 'server_error', message: msg.server });
    }
  });

  return { store };
}

module.exports = { registerSiteRoutes, sniff, renderPdfFirstPage };
