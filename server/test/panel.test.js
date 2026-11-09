'use strict';

// The administration panel ships presets and a category library. They must satisfy the server's own rules,
// otherwise the panel would offer choices that the API then refuses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const panel = require('../../admin-panel.js');
const { validatePalette, ICONS } = require('../src/content');

test('every palette preset is accepted by the server contrast rules', () => {
  assert.ok(panel.PRESETS.length >= 10);
  for (const p of panel.PRESETS) assert.doesNotThrow(() => validatePalette({ preset: p.id, colors: p.colors }), p.name);
});

test('the first preset is the original Noir & Or palette of the site', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const v = (n) => html.match(new RegExp('--' + n + ':(#[0-9a-fA-F]{6})'))[1].toLowerCase();
  const c = panel.PRESETS[0].colors;
  assert.equal(panel.PRESETS[0].name, 'Noir & Or');
  assert.equal(c.background, v('ink'));
  assert.equal(c.card, v('panel'));
  assert.equal(c.text, v('text'));
  assert.equal(c.primary, v('gold'));
  assert.equal(c.accent, v('gold-hi'));
  assert.equal(c.secondary, v('gold-deep'));
});

test('client and server agree on unreadable palettes', () => {
  const bad = { ...panel.PRESETS[0].colors, text: '#080808' };
  assert.ok(panel.paletteProblems(bad).length > 0);
  assert.throws(() => validatePalette({ preset: 'x', colors: bad }));
  assert.deepEqual(panel.paletteProblems(panel.PRESETS[0].colors), []);
});

test('category library: unique ids, 25 spec categories, icons known to the server', () => {
  assert.equal(panel.LIBRARY.length, 25);
  assert.equal(new Set(panel.LIBRARY.map((l) => l[0])).size, 25);
  for (const [id, label, icon] of panel.LIBRARY) {
    assert.match(id, /^[a-z0-9][a-z0-9_-]{0,39}$/);
    assert.ok(label.length > 0 && ICONS.includes(icon), id);
  }
});

test('the panel icon list equals the server allow-list', () => {
  assert.deepEqual(panel.ICONS.map((i) => i[0]).sort(), [...ICONS].sort());
});

test('existing site categories keep their ids (13 originals first, active)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\{id:'([a-z]+)',label:'[^']+',icon:'i-[a-z]+'\}/g)].map((m) => m[1]);
  assert.equal(ids.length, 13);
  assert.deepEqual(panel.LIBRARY.slice(0, 13).map((l) => l[0]), ids);
  assert.ok(panel.LIBRARY.slice(0, 13).every((l) => l[3] === true));
});
