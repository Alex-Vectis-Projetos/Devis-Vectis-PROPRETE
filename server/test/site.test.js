'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { setup, ADMIN, testConfig } = require('./helpers');
const { sniff, renderPdfFirstPage } = require('../src/site');

let fastifyAvailable = true;
try { require.resolve('fastify'); require.resolve('@fastify/cookie'); } catch (_) { fastifyAvailable = false; }
const opts = { skip: fastifyAvailable ? false : 'fastify not installed in this environment' };
let hasPdftoppm = true;
try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); } catch (e) { hasPdftoppm = e.code !== 'ENOENT'; }

const ORIGIN = 'https://devis.test';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const MIN_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF\n'
);

async function boot() {
  const { buildApp } = require('../src/app');
  const s = setup({ config: testConfig() });
  const { app, auth } = await buildApp({ config: s.cfg, db: s.db, mailer: s.mailer, keys: s.keys, logger: false });
  await app.ready();
  const req = (method, url, payload, headers = {}, contentType = 'application/json') =>
    app.inject({ method, url, payload, headers: { origin: ORIGIN, 'content-type': contentType, ...headers } });
  await req('POST', '/api/admin/auth/request', { email: ADMIN });
  await auth.idle();
  const res = await req('POST', '/api/admin/auth/verify', { email: ADMIN, code: s.mailer.lastCode() });
  const cookie = res.cookies.find((x) => x.name === 'vectis_admin').value;
  const csrf = res.json().csrfToken;
  const admin = { cookie: `vectis_admin=${cookie}`, 'x-csrf-token': csrf };
  return { app, req, admin, cfg: s.cfg, db: s.db };
}

const CONTACT = { company: 'VECTIS', address: '8 Rue Pasteur', postalCode: '69200', city: 'Vénissieux', country: 'France', phone: '', email: '', siren: '107 463 358' };

test('file signatures are recognised and anything else is refused', () => {
  assert.equal(sniff(PNG), 'image/png');
  assert.equal(sniff(JPG), 'image/jpeg');
  assert.equal(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
  assert.equal(sniff(MIN_PDF), 'application/pdf');
  assert.equal(sniff(Buffer.from('<svg onload=alert(1)>')), null);
  assert.equal(sniff(Buffer.from('<?php echo 1;')), null);
});

test('PDF first page is rendered to a PNG', { skip: hasPdftoppm ? false : 'pdftoppm not installed' }, async () => {
  const png = await renderPdfFirstPage(MIN_PDF);
  assert.equal(sniff(png), 'image/png');
});

test('a garbage PDF is rejected without crashing', { skip: hasPdftoppm ? false : 'pdftoppm not installed' }, async () => {
  await assert.rejects(renderPdfFirstPage(Buffer.from('%PDF-1.4 garbage')), (e) => e.code === 'pdf_render_failed');
});

test('public content is empty by default and readable without a session', opts, async () => {
  const { app } = await boot();
  const r = await app.inject({ method: 'GET', url: '/api/site/content' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true, content: {} });
  await app.close();
});

test('content admin endpoints refuse anonymous access, missing CSRF and a foreign origin', opts, async () => {
  const { app, req, admin } = await boot();
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/site/content' })).statusCode, 401);
  assert.equal((await req('PUT', '/api/admin/site/content/contact', { value: CONTACT })).statusCode, 401);
  assert.equal((await req('PUT', '/api/admin/site/content/contact', { value: CONTACT }, { cookie: admin.cookie })).statusCode, 403);
  assert.equal((await req('PUT', '/api/admin/site/content/contact', { value: CONTACT }, { ...admin, origin: 'https://evil.test' })).statusCode, 403);
  assert.equal((await req('POST', '/api/admin/site/assets', PNG, {}, 'image/png')).statusCode, 401);
  await app.close();
});

test('saving a section persists, appears publicly, and versions are enforced', opts, async () => {
  const { app, req, admin } = await boot();
  const put = await req('PUT', '/api/admin/site/content/contact', { value: CONTACT, expectedVersion: 0 }, admin);
  assert.equal(put.statusCode, 200);
  assert.equal(put.json().version, 1);
  const pub = await app.inject({ method: 'GET', url: '/api/site/content' });
  assert.equal(pub.json().content.contact.city, 'Vénissieux');
  const stale = await req('PUT', '/api/admin/site/content/contact', { value: CONTACT, expectedVersion: 0 }, admin);
  assert.equal(stale.statusCode, 409);
  const listed = await app.inject({ method: 'GET', url: '/api/admin/site/content', headers: { cookie: admin.cookie } });
  assert.equal(listed.json().versions.contact, 1);
  await app.close();
});

test('invalid content gets a precise French error and nothing is saved', opts, async () => {
  const { app, req, admin } = await boot();
  const r = await req('PUT', '/api/admin/site/content/contact', { value: { ...CONTACT, email: 'pas-un-email' } }, admin);
  assert.equal(r.statusCode, 422);
  assert.equal(r.json().field, 'contact.email');
  assert.match(r.json().message, /invalide/);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/site/content' })).json().content, {});
  assert.equal((await req('PUT', '/api/admin/site/content/inconnue', { value: {} }, admin)).statusCode, 404);
  await app.close();
});

test('palette with unreadable contrast is refused by the API', opts, async () => {
  const { app, req, admin } = await boot();
  const colors = { background: '#070707', card: '#0d0d0c', text: '#080808', title: '#f6d36a', primary: '#d9a521', secondary: '#a8740f', accent: '#f6d36a', border: '#a8740f', button: '#d9a521', icon: '#d9a521' };
  const r = await req('PUT', '/api/admin/site/content/palette', { value: { preset: 'x', colors } }, admin);
  assert.equal(r.statusCode, 422);
  assert.equal(r.json().field, 'palette.colors.text');
  await app.close();
});

test('upload: image is stored, served publicly and referenced content is accepted', opts, async () => {
  const { app, req, admin } = await boot();
  const up = await req('POST', '/api/admin/site/assets', PNG, admin, 'image/png');
  assert.equal(up.statusCode, 200);
  const { assetId } = up.json();
  assert.match(assetId, /^[0-9a-f]{32}$/);
  const again = await req('POST', '/api/admin/site/assets', PNG, admin, 'image/png');
  assert.equal(again.json().assetId, assetId, 'identical file is stored once');
  const got = await app.inject({ method: 'GET', url: '/api/site/assets/' + assetId });
  assert.equal(got.statusCode, 200);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.equal(got.headers['x-content-type-options'], 'nosniff');
  assert.match(got.headers['content-security-policy'], /sandbox/);
  const saved = await req('PUT', '/api/admin/site/content/about', { value: { title: 'À propos', text: 'Texte', imageId: assetId } }, admin);
  assert.equal(saved.statusCode, 200);
  await app.close();
});

test('upload: wrong signature, mismatched type and oversize are refused', opts, async () => {
  const { app, req, admin } = await boot();
  assert.equal((await req('POST', '/api/admin/site/assets', Buffer.from('<svg onload=alert(1)>'), admin, 'image/png')).statusCode, 415);
  assert.equal((await req('POST', '/api/admin/site/assets', JPG, admin, 'image/png')).statusCode, 415);
  assert.equal((await req('POST', '/api/admin/site/assets', PNG, admin, 'image/svg+xml')).statusCode, 415);
  assert.equal((await req('POST', '/api/admin/site/assets', PNG, admin, 'application/json')).statusCode, 415);
  const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
  assert.ok((await req('POST', '/api/admin/site/assets', big, admin, 'image/png')).statusCode >= 400);
  await app.close();
});

test('upload: a PDF keeps the original and yields a rendered image', { skip: !fastifyAvailable ? 'fastify not installed' : hasPdftoppm ? false : 'pdftoppm not installed' }, async () => {
  const { app, req, admin } = await boot();
  const up = await req('POST', '/api/admin/site/assets', MIN_PDF, admin, 'application/pdf');
  assert.equal(up.statusCode, 200);
  const j = up.json();
  assert.equal(j.kind, 'pdf');
  assert.notEqual(j.assetId, j.sourceId);
  assert.equal((await app.inject({ method: 'GET', url: '/api/site/assets/' + j.assetId })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/site/assets/' + j.sourceId })).statusCode, 404, 'the PDF itself is not served publicly');
  await app.close();
});

test('content referencing a missing file is refused; asset ids cannot traverse paths', opts, async () => {
  const { app, req, admin } = await boot();
  const r = await req('PUT', '/api/admin/site/content/about', { value: { title: 'À propos', text: 'T', imageId: 'f'.repeat(32) } }, admin);
  assert.equal(r.statusCode, 422);
  assert.equal((await app.inject({ method: 'GET', url: '/api/site/assets/..%2F..%2Fetc%2Fpasswd' })).statusCode, 404);
  await app.close();
});

test('the quote and authentication routes are unchanged', opts, async () => {
  const { app } = await boot();
  assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/ping' })).statusCode, 401);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/admin/auth/session' })).json(), { authenticated: false });
  await app.close();
});
