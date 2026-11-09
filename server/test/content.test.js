'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { memoryDb } = require('./helpers');
const { migrate } = require('../src/db');
const { ContentStore, ContentError, ICONS, contrast, validatePalette } = require('../src/content');

const A1 = 'a'.repeat(32);
const A2 = 'b'.repeat(32);

function store() {
  const db = memoryDb();
  migrate(db);
  const add = db.prepare('INSERT INTO assets (id, mime, bytes, sha256, created_at) VALUES (?, ?, 1, ?, 0)');
  add.run(A1, 'image/png', 'x1');
  add.run(A2, 'image/png', 'x2');
  return new ContentStore(db, () => 1000);
}

const NOIR_OR = { background: '#070707', card: '#0d0d0c', text: '#f7f3ea', title: '#f6d36a', primary: '#d9a521', secondary: '#a8740f', accent: '#f6d36a', border: '#a8740f', button: '#d9a521', icon: '#d9a521' };
const throwsField = (fn, field) => assert.throws(fn, (e) => e instanceof ContentError && e.field.startsWith(field), `expected ContentError on ${field}`);

test('migration 2 is additive and idempotent', () => {
  const db = memoryDb();
  assert.equal(migrate(db), 2);
  assert.equal(migrate(db), 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_content').get().n, 0, 'nothing is seeded');
});

test('palette: the original Noir & Or palette is valid', () => {
  assert.doesNotThrow(() => validatePalette({ preset: 'noir-or', colors: NOIR_OR }));
});

test('palette: unreadable combinations are refused', () => {
  throwsField(() => validatePalette({ preset: 'x', colors: { ...NOIR_OR, text: '#080808' } }), 'palette.colors.text');
  throwsField(() => validatePalette({ preset: 'x', colors: { ...NOIR_OR, button: '#0a0a0a' } }), 'palette.colors.button');
  throwsField(() => validatePalette({ preset: 'x', colors: { ...NOIR_OR, title: '#101010' } }), 'palette.colors.title');
});

test('palette: bad colour formats and unknown keys are refused', () => {
  throwsField(() => validatePalette({ preset: 'x', colors: { ...NOIR_OR, text: 'red' } }), 'palette.colors.text');
  throwsField(() => validatePalette({ preset: 'x', colors: { ...NOIR_OR, text: 'url(javascript:1)' } }), 'palette.colors.text');
  throwsField(() => validatePalette({ preset: 'x', colors: { ...NOIR_OR, extra: '#ffffff' } }), 'palette.colors.extra');
});

test('contrast ratio helper', () => {
  assert.ok(contrast('#000000', '#ffffff') > 20.9);
  assert.equal(Math.round(contrast('#ffffff', '#ffffff')), 1);
});

test('contact: validates and normalises', () => {
  const s = store();
  const v = { company: ' VECTIS ', address: '8 Rue Pasteur', postalCode: '69200', city: 'Vénissieux', country: 'France', phone: '+33 4 00 00 00 00', email: 'contact@example.test', siren: '107 463 358' };
  const r = s.save('contact', v, { email: 'a@b.c' });
  assert.equal(r.value.company, 'VECTIS');
  assert.equal(r.version, 1);
  throwsField(() => s.save('contact', { ...v, email: 'not-an-email' }), 'contact.email');
  throwsField(() => s.save('contact', { ...v, siren: '123' }), 'contact.siren');
  throwsField(() => s.save('contact', { ...v, company: '' }), 'contact.company');
  throwsField(() => s.save('contact', { ...v, company: 'a\u0000b' }), 'contact.company');
  throwsField(() => s.save('contact', { ...v, surprise: 1 }), 'contact.surprise');
});

test('optimistic versioning prevents overwriting a newer edit', () => {
  const s = store();
  const v = { title: 'À propos', text: 'Texte', imageId: null };
  assert.equal(s.save('about', v, { expectedVersion: 0 }).version, 1);
  assert.equal(s.save('about', { ...v, text: 'Deux' }, { expectedVersion: 1 }).version, 2);
  assert.throws(() => s.save('about', v, { expectedVersion: 1 }), (e) => e.conflict === true);
  assert.equal(s.get('about').value.text, 'Deux');
});

test('services: ordered list, icon library, unique ids', () => {
  const s = store();
  const item = (id) => ({ id, name: 'Qualité', text: '', icon: 'i-shield', active: true });
  const r = s.save('services', { title: 'Nos services', items: [item('a'), item('b')] });
  assert.deepEqual(r.value.items.map((i) => i.id), ['a', 'b']);
  throwsField(() => s.save('services', { title: 'x', items: [item('a'), item('a')] }), 'services.items');
  throwsField(() => s.save('services', { title: 'x', items: [{ ...item('a'), icon: 'i-evil' }] }), 'services.items[0].icon');
});

test('places: at most 10 photos and exactly one main photo among them', () => {
  const s = store();
  s.save('categories', { items: [{ id: 'atelier', label: 'Atelier', icon: 'i-atelier', active: true }] });
  const place = { id: 'gecko', category: 'atelier', title: 'GECKO', description: '', photos: [A1, A2], mainPhoto: A2, active: true };
  assert.equal(s.save('places', { items: [place] }).value.items[0].mainPhoto, A2);
  throwsField(() => s.save('places', { items: [{ ...place, mainPhoto: null }] }), 'places.items[0].mainPhoto');
  throwsField(() => s.save('places', { items: [{ ...place, mainPhoto: 'c'.repeat(32) }] }), 'places.items[0].mainPhoto');
  throwsField(() => s.save('places', { items: [{ ...place, photos: Array(11).fill(A1) }] }), 'places.items[0].photos');
  throwsField(() => s.save('places', { items: [{ ...place, photos: [A1, A1], mainPhoto: A1 }] }), 'places.items[0].photos');
  throwsField(() => s.save('places', { items: [{ ...place, category: 'inconnue' }] }), 'places.items[0].category');
  throwsField(() => s.save('places', { items: [{ ...place, photos: ['d'.repeat(32)], mainPhoto: 'd'.repeat(32) }] }), 'assets');
});

test('places: built-in sample photos stay unless explicitly hidden', () => {
  const s = store();
  assert.equal(s.save('places', { items: [] }).value.hideBuiltin, false);
  assert.equal(s.save('places', { items: [], hideBuiltin: true }).value.hideBuiltin, true);
  throwsField(() => s.save('places', { items: [], hideBuiltin: 'oui' }), 'places.hideBuiltin');
});

test('brand and banner reference only existing files', () => {
  const s = store();
  assert.doesNotThrow(() => s.save('brand', { name: 'VECTIS', logoMain: A1, logoFooter: null, logoAbout: A2 }));
  throwsField(() => s.save('brand', { name: 'VECTIS', logoMain: 'e'.repeat(32), logoFooter: null, logoAbout: null }), 'assets');
  assert.doesNotThrow(() => s.save('banner', { imageId: A1, sourceId: A2, zoom: 1.5, x: 50, y: 40 }));
  throwsField(() => s.save('banner', { imageId: A1, sourceId: null, zoom: 9, x: 50, y: 50 }), 'banner.zoom');
  throwsField(() => s.save('banner', { imageId: A1, sourceId: null, zoom: 1, x: -1, y: 50 }), 'banner.x');
});

test('unknown sections are refused', () => {
  throwsField(() => store().save('../etc/passwd', {}), '../etc/passwd');
});

test('every icon of the library exists in the site sprite', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const missing = ICONS.filter((i) => !html.includes(`<symbol id="${i}"`) && !html.includes(`id="${i}"`));
  assert.deepEqual(missing, []);
});

test('places: the same establishment cannot exist twice in a category (accents and case ignored), but may in another one', () => {
  const s = store();
  const mk = (id, category, title) => ({ id, category, title, description: '', photos: [], mainPhoto: null, active: true });
  throwsField(() => s.save('places', { items: [mk('a1', 'pharmacie', 'Pharmacie Étoile'), mk('a2', 'pharmacie', ' pharmacie  etoile ')] }), 'places.items[1].title');
  assert.equal(s.save('places', { items: [mk('a1', 'pharmacie', 'Étoile'), mk('a2', 'cabinet', 'Étoile'), mk('a3', 'pharmacie', 'Autre')] }).value.items.length, 3);
});

test('texts: closed key list, no duplicates, bounded length, multiline only inside the value', () => {
  const s = store();
  const ok = s.save('texts', { items: [{ key: 'domainsTitle', text: 'Nos secteurs' }, { key: 'step1', text: 'Vous remplissez\nle formulaire' }] });
  assert.equal(ok.value.items.length, 2);
  throwsField(() => s.save('texts', { items: [{ key: 'script', text: 'x' }] }), 'texts.items[0].key');
  throwsField(() => s.save('texts', { items: [{ key: 'howTitle', text: 'a' }, { key: 'howTitle', text: 'b' }] }), 'texts.items');
  throwsField(() => s.save('texts', { items: [{ key: 'howTitle', text: '' }] }), 'texts.items[0].text');
  throwsField(() => s.save('texts', { items: [{ key: 'howTitle', text: 'x'.repeat(161) }] }), 'texts.items[0].text');
  throwsField(() => s.save('texts', { items: [{ key: 'howTitle', text: 'a', extra: 1 }] }), 'texts.items[0].extra');
});
