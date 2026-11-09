'use strict';

// Editable site content (administration panel). Pure validation + a tiny SQLite store.
// Nothing here is seeded: until a section is saved, the public site keeps using its built-in content.

const ICONS = [
  'i-atelier', 'i-cartorio', 'i-pharmacie', 'i-home', 'i-building', 'i-steth', 'i-public', 'i-laptop',
  'i-resid', 'i-factory', 'i-shop', 'i-warehouse', 'i-brief',
  'i-hotel', 'i-restaurant', 'i-mall', 'i-school', 'i-baby', 'i-gym', 'i-hospital', 'i-parking',
  'i-storage', 'i-other',
  'i-shield', 'i-clock', 'i-leaf', 'i-users', 'i-sparkle', 'i-check', 'i-key', 'i-doc', 'i-grid',
];

const SECTIONS = ['palette', 'contact', 'about', 'services', 'brand', 'categories', 'places', 'banner'];
const PALETTE_KEYS = ['primary', 'secondary', 'accent', 'background', 'card', 'border', 'title', 'text', 'button', 'icon'];
const MAX_PHOTOS = 10;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ASSET_RE = /^[0-9a-f]{32}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

class ContentError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ContentError';
    this.field = field;
  }
}

function fail(field, message) { throw new ContentError(field, message); }
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function exactKeys(obj, allowed, where) {
  if (!isObj(obj)) fail(where, 'Objet attendu.');
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail(where + '.' + k, 'Champ inconnu.');
}

function str(v, field, { min = 0, max = 200, multiline = false } = {}) {
  if (typeof v !== 'string') fail(field, 'Texte attendu.');
  const s = v.replace(/\r\n/g, '\n').trim();
  if (CONTROL_RE.test(s) || (!multiline && /[\n\r]/.test(s))) fail(field, 'Caractères non autorisés.');
  if (s.length < min) fail(field, 'Champ obligatoire.');
  if (s.length > max) fail(field, `Maximum ${max} caractères.`);
  return s;
}

function bool(v, field) {
  if (typeof v !== 'boolean') fail(field, 'Valeur oui/non attendue.');
  return v;
}

function idOf(v, field) {
  if (typeof v !== 'string' || !ID_RE.test(v)) fail(field, 'Identifiant invalide.');
  return v;
}

function assetOf(v, field, { nullable = true } = {}) {
  if (v === null && nullable) return null;
  if (typeof v !== 'string' || !ASSET_RE.test(v)) fail(field, 'Fichier invalide.');
  return v;
}

function iconOf(v, field) {
  if (typeof v !== 'string' || !ICONS.includes(v)) fail(field, 'Icône inconnue.');
  return v;
}

function listOf(v, field, max) {
  if (!Array.isArray(v)) fail(field, 'Liste attendue.');
  if (v.length > max) fail(field, `Maximum ${max} éléments.`);
  return v;
}

function uniqueIds(items, field) {
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.id)) fail(field, 'Identifiants en double.');
    seen.add(it.id);
  }
}

// ---------- colours ----------

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// [foreground, background, minimum ratio, message]
const CONTRAST_RULES = [
  ['text', 'background', 4.5, 'Le texte est illisible sur le fond.'],
  ['text', 'card', 4.5, 'Le texte est illisible sur les cartes.'],
  ['title', 'background', 3, 'Les titres manquent de contraste sur le fond.'],
  ['title', 'card', 3, 'Les titres manquent de contraste sur les cartes.'],
  ['icon', 'background', 3, 'Les icônes manquent de contraste sur le fond.'],
  ['button', 'background', 3, 'Les boutons manquent de contraste sur le fond.'],
];

function validatePalette(v) {
  exactKeys(v, ['preset', 'colors'], 'palette');
  const preset = str(v.preset, 'palette.preset', { min: 1, max: 40 });
  exactKeys(v.colors, PALETTE_KEYS, 'palette.colors');
  const colors = {};
  for (const k of PALETTE_KEYS) {
    const c = v.colors[k];
    if (typeof c !== 'string' || !HEX_RE.test(c)) fail('palette.colors.' + k, 'Couleur invalide (format #RRGGBB).');
    colors[k] = c.toLowerCase();
  }
  for (const [fg, bg, min, message] of CONTRAST_RULES) {
    if (contrast(colors[fg], colors[bg]) < min) fail('palette.colors.' + fg, message);
  }
  return { preset, colors };
}

// ---------- sections ----------

function validateContact(v) {
  exactKeys(v, ['company', 'address', 'postalCode', 'city', 'country', 'phone', 'email', 'siren'], 'contact');
  const out = {
    company: str(v.company, 'contact.company', { min: 1, max: 80 }),
    address: str(v.address, 'contact.address', { max: 120 }),
    postalCode: str(v.postalCode, 'contact.postalCode', { max: 12 }),
    city: str(v.city, 'contact.city', { max: 80 }),
    country: str(v.country, 'contact.country', { max: 60 }),
    phone: str(v.phone, 'contact.phone', { max: 30 }),
    email: str(v.email, 'contact.email', { max: 120 }),
    siren: str(v.siren, 'contact.siren', { max: 20 }),
  };
  if (out.email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(out.email)) fail('contact.email', 'Adresse e-mail invalide.');
  if (out.phone && !/^[+\d][\d\s().-]{6,}$/.test(out.phone)) fail('contact.phone', 'Numéro de téléphone invalide.');
  if (out.siren && !/^\d{3}\s?\d{3}\s?\d{3}$/.test(out.siren)) fail('contact.siren', 'Le SIREN comporte 9 chiffres.');
  return out;
}

function validateAbout(v) {
  exactKeys(v, ['title', 'text', 'imageId'], 'about');
  return {
    title: str(v.title, 'about.title', { min: 1, max: 80 }),
    text: str(v.text, 'about.text', { min: 1, max: 2000, multiline: true }),
    imageId: assetOf(v.imageId, 'about.imageId'),
  };
}

function validateServices(v) {
  exactKeys(v, ['title', 'items'], 'services');
  const items = listOf(v.items, 'services.items', 12).map((it, i) => {
    const w = `services.items[${i}]`;
    exactKeys(it, ['id', 'name', 'text', 'icon', 'active'], w);
    return {
      id: idOf(it.id, w + '.id'),
      name: str(it.name, w + '.name', { min: 1, max: 80 }),
      text: str(it.text, w + '.text', { max: 300, multiline: true }),
      icon: iconOf(it.icon, w + '.icon'),
      active: bool(it.active, w + '.active'),
    };
  });
  uniqueIds(items, 'services.items');
  return { title: str(v.title, 'services.title', { min: 1, max: 80 }), items };
}

function validateBrand(v) {
  exactKeys(v, ['name', 'logoMain', 'logoFooter', 'logoAbout'], 'brand');
  return {
    name: str(v.name, 'brand.name', { min: 1, max: 60 }),
    logoMain: assetOf(v.logoMain, 'brand.logoMain'),
    logoFooter: assetOf(v.logoFooter, 'brand.logoFooter'),
    logoAbout: assetOf(v.logoAbout, 'brand.logoAbout'),
  };
}

function validateCategories(v) {
  exactKeys(v, ['items'], 'categories');
  const items = listOf(v.items, 'categories.items', 60).map((it, i) => {
    const w = `categories.items[${i}]`;
    exactKeys(it, ['id', 'label', 'icon', 'active'], w);
    return {
      id: idOf(it.id, w + '.id'),
      label: str(it.label, w + '.label', { min: 1, max: 60 }),
      icon: iconOf(it.icon, w + '.icon'),
      active: bool(it.active, w + '.active'),
    };
  });
  uniqueIds(items, 'categories.items');
  return { items };
}

function validatePlaces(v, { categoryIds } = {}) {
  exactKeys(v, ['items'], 'places');
  const items = listOf(v.items, 'places.items', 200).map((it, i) => {
    const w = `places.items[${i}]`;
    exactKeys(it, ['id', 'category', 'title', 'description', 'photos', 'mainPhoto', 'active'], w);
    const category = idOf(it.category, w + '.category');
    if (categoryIds && !categoryIds.includes(category)) fail(w + '.category', 'Catégorie inconnue.');
    const photos = listOf(it.photos, w + '.photos', MAX_PHOTOS).map((p, j) => assetOf(p, `${w}.photos[${j}]`, { nullable: false }));
    if (new Set(photos).size !== photos.length) fail(w + '.photos', 'Photos en double.');
    const mainPhoto = assetOf(it.mainPhoto, w + '.mainPhoto');
    if (photos.length === 0 && mainPhoto !== null) fail(w + '.mainPhoto', 'Aucune photo.');
    if (photos.length > 0 && (mainPhoto === null || !photos.includes(mainPhoto))) {
      fail(w + '.mainPhoto', 'Choisissez une photo principale parmi les photos du lieu.');
    }
    return {
      id: idOf(it.id, w + '.id'),
      category,
      title: str(it.title, w + '.title', { min: 1, max: 80 }),
      description: str(it.description, w + '.description', { max: 500, multiline: true }),
      photos,
      mainPhoto,
      active: bool(it.active, w + '.active'),
    };
  });
  uniqueIds(items, 'places.items');
  return { items };
}

function validateBanner(v) {
  exactKeys(v, ['imageId', 'sourceId', 'zoom', 'x', 'y'], 'banner');
  const num = (n, field, lo, hi) => {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) fail(field, `Valeur entre ${lo} et ${hi} attendue.`);
    return Math.round(n * 1000) / 1000;
  };
  return {
    imageId: assetOf(v.imageId, 'banner.imageId'),
    sourceId: assetOf(v.sourceId, 'banner.sourceId'), // original file (PDF or image) kept untouched
    zoom: num(v.zoom, 'banner.zoom', 1, 4),
    x: num(v.x, 'banner.x', 0, 100),
    y: num(v.y, 'banner.y', 0, 100),
  };
}

const VALIDATORS = {
  palette: validatePalette,
  contact: validateContact,
  about: validateAbout,
  services: validateServices,
  brand: validateBrand,
  categories: validateCategories,
  places: validatePlaces,
  banner: validateBanner,
};

// ---------- store ----------

class ContentStore {
  constructor(db, now = Date.now) {
    this.db = db;
    this.now = now;
  }

  all() {
    const out = {};
    for (const r of this.db.prepare('SELECT section, value, version, updated_at FROM site_content').all()) {
      try { out[r.section] = { ...JSON.parse(r.value), }; } catch (_) { continue; }
    }
    return out;
  }

  get(section) {
    const r = this.db.prepare('SELECT value, version, updated_at FROM site_content WHERE section = ?').get(section);
    if (!r) return null;
    return { value: JSON.parse(r.value), version: r.version, updatedAt: r.updated_at };
  }

  /** Validates, checks cross references and writes. expectedVersion protects against overwriting a newer edit. */
  save(section, input, { email, expectedVersion } = {}) {
    if (!SECTIONS.includes(section)) fail(section, 'Section inconnue.');
    let value;
    if (section === 'places') {
      const cats = this.get('categories');
      value = validatePlaces(input, cats ? { categoryIds: cats.value.items.map((c) => c.id) } : {});
    } else {
      value = VALIDATORS[section](input);
    }
    this.checkAssets(value);
    const cur = this.get(section);
    const curVersion = cur ? cur.version : 0;
    if (expectedVersion !== undefined && expectedVersion !== curVersion) {
      const err = new ContentError(section, 'Ce contenu a été modifié ailleurs. Rechargez la page avant d’enregistrer.');
      err.conflict = true;
      throw err;
    }
    const at = this.now();
    this.db
      .prepare(
        `INSERT INTO site_content (section, value, version, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(section) DO UPDATE SET value = excluded.value, version = site_content.version + 1,
           updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(section, JSON.stringify(value), at, email || null);
    return this.get(section);
  }

  /** Every referenced file must exist and be an image, so the public site never points at nothing. */
  checkAssets(value) {
    const ids = new Set();
    (function walk(x, key) {
      if (typeof x === 'string' && ASSET_RE.test(x) && /(Id|logo|photo|Photo|photos)/.test(key || '')) ids.add(x);
      else if (Array.isArray(x)) x.forEach((e) => walk(e, key));
      else if (isObj(x)) for (const [k, e] of Object.entries(x)) walk(e, k);
    })(value, '');
    for (const id of ids) {
      const r = this.db.prepare('SELECT 1 AS ok FROM assets WHERE id = ?').get(id);
      if (!r) fail('assets', 'Un fichier référencé n’existe pas ou plus.');
    }
  }
}

module.exports = {
  ICONS, SECTIONS, PALETTE_KEYS, MAX_PHOTOS, ContentError, ContentStore, VALIDATORS, contrast, validatePalette,
};
