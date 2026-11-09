/* VECTIS — panneau d'administration du contenu.
   Chargé uniquement après une connexion administrateur réussie (aucun code d'administration pour les visiteurs).
   Toute donnée affichée est insérée avec textContent / value : jamais innerHTML. */
(function () {
  'use strict';

  var HEX = /^#[0-9a-f]{6}$/i;
  var ASSET = /^[0-9a-f]{32}$/;
  var ICONS = [
    ['i-atelier', 'Atelier'], ['i-cartorio', 'Cartorio'], ['i-pharmacie', 'Pharmacie'], ['i-home', 'Maison'], ['i-building', 'Immeuble'],
    ['i-steth', 'Médical'], ['i-public', 'Public'], ['i-laptop', 'Bureau'], ['i-resid', 'Résidence'], ['i-factory', 'Usine'],
    ['i-shop', 'Commerce'], ['i-warehouse', 'Entrepôt'], ['i-brief', 'Professionnel'], ['i-hotel', 'Hôtel'], ['i-restaurant', 'Restaurant'],
    ['i-mall', 'Centre commercial'], ['i-school', 'École'], ['i-baby', 'Crèche'], ['i-gym', 'Sport'], ['i-hospital', 'Hôpital'],
    ['i-parking', 'Parking'], ['i-storage', 'Stockage'], ['i-other', 'Autre'], ['i-shield', 'Bouclier'], ['i-clock', 'Horloge'],
    ['i-leaf', 'Feuille'], ['i-users', 'Équipe'], ['i-sparkle', 'Étincelle'], ['i-check', 'Validé'], ['i-key', 'Clé'], ['i-doc', 'Document'], ['i-grid', 'Grille']
  ];

  /* Bibliothèque : les 13 catégories actuelles du site (actives) + celles du cahier des charges (inactives tant qu'elles ne sont pas cochées). */
  var LIBRARY = [
    ['atelier', 'Atelier', 'i-atelier', true], ['cartorio', 'Cartório', 'i-cartorio', true], ['pharmacie', 'Pharmacie', 'i-pharmacie', true],
    ['airbnb', 'Airbnb', 'i-home', true], ['immeubles', 'Immeubles commerciaux', 'i-building', true], ['cabinet', 'Cabinet médical', 'i-steth', true],
    ['public', 'Services publics', 'i-public', true], ['bureaux', 'Bureaux', 'i-laptop', true], ['residences', 'Résidences', 'i-resid', true],
    ['usines', 'Usines et industries', 'i-factory', true], ['commerces', 'Commerces', 'i-shop', true], ['entrepots', 'Entrepôts', 'i-warehouse', true],
    ['pro', 'Établissements professionnels', 'i-brief', true],
    ['hotels', 'Hôtels', 'i-hotel', false], ['restaurants', 'Restaurants', 'i-restaurant', false], ['centres', 'Centres commerciaux', 'i-mall', false],
    ['ecoles', 'Écoles et établissements scolaires', 'i-school', false], ['creches', 'Crèches', 'i-baby', false], ['sport', 'Salles de sport', 'i-gym', false],
    ['hopitaux', 'Hôpitaux et cliniques', 'i-hospital', false], ['parkings', 'Parkings', 'i-parking', false], ['copro', 'Copropriétés', 'i-resid', false],
    ['industriels', 'Locaux industriels', 'i-factory', false], ['stockage', 'Espaces de stockage', 'i-storage', false],
    ['autres', 'Autres espaces professionnels', 'i-other', false]
  ];

  function pal(name, bg, card, text, title, primary, secondary, accent, border, button, icon) {
    return { id: name.toLowerCase().replace(/[^a-z]+/g, '-'), name: name, colors: { background: bg, card: card, text: text, title: title, primary: primary, secondary: secondary, accent: accent, border: border, button: button, icon: icon } };
  }
  var PRESETS = [
    pal('Noir & Or', '#070707', '#0d0d0c', '#f7f3ea', '#f6d36a', '#d9a521', '#a8740f', '#f6d36a', '#d9a521', '#d9a521', '#d9a521'),
    pal('Noir & Champagne', '#080808', '#121110', '#f5efe3', '#ead9b0', '#d8c08a', '#a8925f', '#f1e4c3', '#d8c08a', '#d8c08a', '#d8c08a'),
    pal('Anthracite & Or', '#1c1e21', '#25282c', '#f2f0ea', '#f0cf6a', '#d9a521', '#a8740f', '#f6d36a', '#d9a521', '#d9a521', '#e3b73e'),
    pal('Bleu Marine & Or', '#0b1b33', '#102542', '#f3f1ea', '#f1d27a', '#d9a521', '#a8740f', '#f6d36a', '#d9a521', '#d9a521', '#e3b73e'),
    pal('Bleu Nuit & Argent', '#0a1020', '#111a30', '#eef1f6', '#d7dde8', '#b7c0d0', '#7f8aa0', '#e4e9f2', '#9aa6bc', '#b7c0d0', '#c9d1df'),
    pal('Blanc & Or', '#fbf9f4', '#ffffff', '#1d1a14', '#7a5410', '#a8740f', '#7a5410', '#8a5f10', '#c9a24a', '#a8740f', '#8a5f10'),
    pal('Vert Profond & Or', '#07201a', '#0c2b23', '#f1f0e6', '#f1d27a', '#d9a521', '#a8740f', '#f6d36a', '#d9a521', '#d9a521', '#e3b73e'),
    pal('Bordeaux & Champagne', '#25080f', '#33101a', '#f6efe4', '#ead9b0', '#d8c08a', '#a8925f', '#f1e4c3', '#d8c08a', '#d8c08a', '#d8c08a'),
    pal('Gris Premium', '#17181a', '#202225', '#eceae5', '#ffffff', '#c7c9cd', '#8d9096', '#e6e7ea', '#8d9096', '#c7c9cd', '#d5d7db'),
    pal('Contemporain Ardoise & Cuivre', '#12161b', '#1a2027', '#eef0f2', '#f0b88c', '#d98a55', '#a45f32', '#f0b88c', '#d98a55', '#d98a55', '#e8a070'),
    pal('Contemporain Nuit & Menthe', '#0c1514', '#122120', '#ecf4f2', '#9be3d0', '#4fc7a8', '#2e8c76', '#9be3d0', '#4fc7a8', '#4fc7a8', '#6fd9bd'),
    pal('Noir & Blanc', '#070707', '#181818', '#f7f3ea', '#f2f2f2', '#f2f2f2', '#a0a0a0', '#f2f2f2', '#f2f2f2', '#f2f2f2', '#f2f2f2'),
    pal('Noir & Rouge', '#070707', '#181818', '#f7f3ea', '#e84a4a', '#e84a4a', '#9e3d3d', '#e84a4a', '#e84a4a', '#e84a4a', '#e84a4a'),
    pal('Noir & Bordeaux', '#070707', '#181818', '#f7f3ea', '#c84a62', '#c84a62', '#904755', '#c84a62', '#c84a62', '#c84a62', '#c84a62'),
    pal('Noir & Orange', '#070707', '#181818', '#f7f3ea', '#f08a24', '#f08a24', '#9e5c1a', '#f08a24', '#f08a24', '#f08a24', '#f08a24'),
    pal('Noir & Jaune', '#070707', '#181818', '#f7f3ea', '#f6d21e', '#f6d21e', '#a28b16', '#f6d21e', '#f6d21e', '#f6d21e', '#f6d21e'),
    pal('Noir & Vert', '#070707', '#181818', '#f7f3ea', '#3fbf6a', '#3fbf6a', '#2b7f47', '#3fbf6a', '#3fbf6a', '#3fbf6a', '#3fbf6a'),
    pal('Noir & Bleu', '#070707', '#181818', '#f7f3ea', '#4a9af0', '#4a9af0', '#33679e', '#4a9af0', '#4a9af0', '#4a9af0', '#4a9af0'),
    pal('Noir & Violet', '#070707', '#181818', '#f7f3ea', '#a77cf5', '#a77cf5', '#6f53a2', '#a77cf5', '#a77cf5', '#a77cf5', '#a77cf5'),
    pal('Noir & Rose', '#070707', '#181818', '#f7f3ea', '#f06ca8', '#f06ca8', '#9e4970', '#f06ca8', '#f06ca8', '#f06ca8', '#f06ca8'),
    pal('Noir & Gris', '#070707', '#181818', '#f7f3ea', '#b8bcc2', '#b8bcc2', '#7a7d81', '#b8bcc2', '#b8bcc2', '#b8bcc2', '#b8bcc2'),
    pal('Blanc & Noir', '#fbfbfa', '#ffffff', '#14110a', '#111111', '#111111', '#636363', '#111111', '#111111', '#111111', '#111111'),
    pal('Blanc & Rouge', '#fbfbfa', '#ffffff', '#14110a', '#c0262d', '#c0262d', '#d57175', '#c0262d', '#c0262d', '#c0262d', '#c0262d'),
    pal('Blanc & Bordeaux', '#fbfbfa', '#ffffff', '#14110a', '#7d1930', '#7d1930', '#a96877', '#7d1930', '#7d1930', '#7d1930', '#7d1930'),
    pal('Blanc & Orange', '#fbfbfa', '#ffffff', '#14110a', '#c2570c', '#c2570c', '#c18256', '#c2570c', '#c2570c', '#c2570c', '#c2570c'),
    pal('Blanc & Jaune', '#fbfbfa', '#ffffff', '#14110a', '#a87a00', '#a87a00', '#a78e4b', '#a87a00', '#a87a00', '#a87a00', '#a87a00'),
    pal('Blanc & Vert', '#fbfbfa', '#ffffff', '#14110a', '#1f8a4c', '#1f8a4c', '#5c9774', '#1f8a4c', '#1f8a4c', '#1f8a4c', '#1f8a4c'),
    pal('Blanc & Bleu', '#fbfbfa', '#ffffff', '#14110a', '#1f5fbf', '#1f5fbf', '#678fc9', '#1f5fbf', '#1f5fbf', '#1f5fbf', '#1f5fbf'),
    pal('Blanc & Violet', '#fbfbfa', '#ffffff', '#14110a', '#6b3fc0', '#6b3fc0', '#9d81d4', '#6b3fc0', '#6b3fc0', '#6b3fc0', '#6b3fc0'),
    pal('Blanc & Rose', '#fbfbfa', '#ffffff', '#14110a', '#c2306f', '#c2306f', '#cb7198', '#c2306f', '#c2306f', '#c2306f', '#c2306f'),
    pal('Blanc & Gris', '#fbfbfa', '#ffffff', '#14110a', '#5a5f66', '#5a5f66', '#8b8f92', '#5a5f66', '#5a5f66', '#5a5f66', '#5a5f66'),
    pal('Rouge & Blanc', '#a31621', '#a92631', '#f7f3ea', '#ffffff', '#ffffff', '#dfadb1', '#ffffff', '#ffffff', '#ffffff', '#ffffff'),
    pal('Rouge & Or', '#a31621', '#a92631', '#f7f3ea', '#f6d36a', '#f6d36a', '#d99150', '#f6d36a', '#f6d36a', '#f6d36a', '#f6d36a'),
    pal('Bordeaux & Blanc', '#3a0d18', '#481e28', '#f7f3ea', '#ffffff', '#ffffff', '#baaaae', '#ffffff', '#ffffff', '#ffffff', '#ffffff'),
    pal('Bordeaux & Or', '#3a0d18', '#481e28', '#f7f3ea', '#d9a521', '#d9a521', '#a1701e', '#d9a521', '#d9a521', '#d9a521', '#d9a521'),
    pal('Bordeaux & Rose', '#3a0d18', '#481e28', '#f7f3ea', '#f2b5c4', '#f2b5c4', '#b27a88', '#f2b5c4', '#f2b5c4', '#f2b5c4', '#f2b5c4'),
    pal('Orange & Blanc', '#a84106', '#ae4e17', '#f7f3ea', '#ffffff', '#ffffff', '#e1bda8', '#ffffff', '#ffffff', '#ffffff', '#ffffff'),
    pal('Orange & Jaune', '#a84106', '#ae4e17', '#f7f3ea', '#ffe08a', '#ffe08a', '#e3ac64', '#ffe08a', '#ffe08a', '#ffe08a', '#ffe08a'),
    pal('Jaune & Noir', '#f2c200', '#f9e48c', '#14110a', '#14110a', '#14110a', '#624f07', '#14110a', '#14110a', '#14110a', '#14110a'),
    pal('Jaune & Rouge', '#f2c200', '#f9e48c', '#14110a', '#8f1a1a', '#8f1a1a', '#a95110', '#8f1a1a', '#8f1a1a', '#8f1a1a', '#8f1a1a'),
    pal('Vert & Blanc', '#0f4d2e', '#20593d', '#f7f3ea', '#ffffff', '#ffffff', '#abc1b6', '#ffffff', '#ffffff', '#ffffff', '#ffffff'),
    pal('Vert & Or', '#0f4d2e', '#20593d', '#f7f3ea', '#d9a521', '#d9a521', '#9d923c', '#d9a521', '#d9a521', '#d9a521', '#d9a521'),
    pal('Vert & Menthe', '#0f4d2e', '#20593d', '#f7f3ea', '#9be3d0', '#9be3d0', '#6aaf97', '#9be3d0', '#9be3d0', '#9be3d0', '#9be3d0'),
    pal('Vert Clair & Vert', '#e8f3ec', '#f5faf6', '#14110a', '#1f6b3f', '#1f6b3f', '#609376', '#1f6b3f', '#1f6b3f', '#1f6b3f', '#1f6b3f'),
    pal('Vert Clair & Noir', '#e8f3ec', '#f5faf6', '#14110a', '#14110a', '#14110a', '#5e6059', '#14110a', '#14110a', '#14110a', '#14110a'),
    pal('Bleu & Blanc', '#0d2f6b', '#1e3e75', '#f7f3ea', '#ffffff', '#ffffff', '#aab6cb', '#ffffff', '#ffffff', '#ffffff', '#ffffff'),
    pal('Bleu & Or', '#0d2f6b', '#1e3e75', '#f7f3ea', '#d9a521', '#d9a521', '#927c3b', '#d9a521', '#d9a521', '#d9a521', '#d9a521'),
    pal('Bleu & Argent', '#0d2f6b', '#1e3e75', '#f7f3ea', '#c9d1df', '#c9d1df', '#8798b6', '#c9d1df', '#c9d1df', '#c9d1df', '#c9d1df'),
    pal('Bleu & Ciel', '#0d2f6b', '#1e3e75', '#f7f3ea', '#8fc4ff', '#8fc4ff', '#6290cb', '#8fc4ff', '#8fc4ff', '#8fc4ff', '#8fc4ff'),
    pal('Bleu Clair & Bleu', '#e8f0fb', '#f5f8fd', '#14110a', '#1f4fa3', '#1f4fa3', '#6587c2', '#1f4fa3', '#1f4fa3', '#1f4fa3', '#1f4fa3'),
    pal('Bleu Clair & Noir', '#e8f0fb', '#f5f8fd', '#14110a', '#14110a', '#14110a', '#5e5f5e', '#14110a', '#14110a', '#14110a', '#14110a'),
    pal('Violet & Blanc', '#2b1458', '#3a2464', '#f7f3ea', '#ffffff', '#ffffff', '#b5adc5', '#ffffff', '#ffffff', '#ffffff', '#ffffff'),
    pal('Violet & Or', '#2b1458', '#3a2464', '#f7f3ea', '#d9a521', '#d9a521', '#9c7234', '#d9a521', '#d9a521', '#d9a521', '#d9a521'),
    pal('Violet & Rose', '#2b1458', '#3a2464', '#f7f3ea', '#f2a6d1', '#f2a6d1', '#ac73a7', '#f2a6d1', '#f2a6d1', '#f2a6d1', '#f2a6d1'),
    pal('Violet & Lavande', '#2b1458', '#3a2464', '#f7f3ea', '#cdb8ff', '#cdb8ff', '#947fc5', '#cdb8ff', '#cdb8ff', '#cdb8ff', '#cdb8ff'),
    pal('Violet Clair & Violet', '#f1ecfb', '#f9f6fd', '#14110a', '#5a2fa8', '#5a2fa8', '#8f71c5', '#5a2fa8', '#5a2fa8', '#5a2fa8', '#5a2fa8'),
    pal('Violet Clair & Noir', '#f1ecfb', '#f9f6fd', '#14110a', '#14110a', '#14110a', '#615e5e', '#14110a', '#14110a', '#14110a', '#14110a'),
    pal('Rose & Bordeaux', '#f8e1ec', '#fcf2f6', '#14110a', '#7d1930', '#7d1930', '#a85f72', '#7d1930', '#7d1930', '#7d1930', '#7d1930'),
    pal('Rose & Noir', '#f8e1ec', '#fcf2f6', '#14110a', '#14110a', '#14110a', '#645a59', '#14110a', '#14110a', '#14110a', '#14110a'),
    pal('Rose & Violet', '#f8e1ec', '#fcf2f6', '#14110a', '#5a2fa8', '#5a2fa8', '#916dc0', '#5a2fa8', '#5a2fa8', '#5a2fa8', '#5a2fa8'),
    pal('Rose Profond & Blanc', '#8a1c4f', '#922c5b', '#f7f3ea', '#ffffff', '#ffffff', '#d6b0c1', '#ffffff', '#ffffff', '#ffffff', '#ffffff'),
    pal('Rose Profond & Or', '#8a1c4f', '#922c5b', '#f7f3ea', '#f6d36a', '#f6d36a', '#d09361', '#f6d36a', '#f6d36a', '#f6d36a', '#f6d36a'),
    pal('Gris & Blanc', '#1c1e21', '#2c2e31', '#f7f3ea', '#f2f2f2', '#f2f2f2', '#a7a8a9', '#f2f2f2', '#f2f2f2', '#f2f2f2', '#f2f2f2'),
    pal('Gris & Rouge', '#1c1e21', '#2c2e31', '#f7f3ea', '#ee6a62', '#ee6a62', '#a54f4b', '#ee6a62', '#ee6a62', '#ee6a62', '#ee6a62'),
    pal('Gris & Bleu', '#1c1e21', '#2c2e31', '#f7f3ea', '#6fb1ff', '#6fb1ff', '#527eb1', '#6fb1ff', '#6fb1ff', '#6fb1ff', '#6fb1ff'),
    pal('Gris & Vert', '#1c1e21', '#2c2e31', '#f7f3ea', '#5fd08a', '#5fd08a', '#489265', '#5fd08a', '#5fd08a', '#5fd08a', '#5fd08a'),
    pal('Gris Clair & Noir', '#eceae5', '#f6f6f3', '#14110a', '#1c1e21', '#1c1e21', '#656566', '#1c1e21', '#1c1e21', '#1c1e21', '#1c1e21'),
    pal('Gris Clair & Rouge', '#eceae5', '#f6f6f3', '#14110a', '#b3261e', '#b3261e', '#c76b64', '#b3261e', '#b3261e', '#b3261e', '#b3261e'),
    pal('Gris Clair & Bleu', '#eceae5', '#f6f6f3', '#14110a', '#1f5fbf', '#1f5fbf', '#5d82b8', '#1f5fbf', '#1f5fbf', '#1f5fbf', '#1f5fbf'),
    pal('Gris Clair & Vert', '#eceae5', '#f6f6f3', '#14110a', '#1f7a4a', '#1f7a4a', '#5d9173', '#1f7a4a', '#1f7a4a', '#1f7a4a', '#1f7a4a')
  ];
  var PALETTE_KEYS = [['primary', 'Couleur principale'], ['secondary', 'Couleur secondaire'], ['accent', 'Couleur de mise en avant'], ['background', 'Couleur de fond'], ['card', 'Couleur des cartes'], ['border', 'Couleur des bordures'], ['title', 'Couleur des titres'], ['text', 'Couleur des textes'], ['button', 'Couleur des boutons'], ['icon', 'Couleur des icônes']];

  function lum(hex) {
    var n = parseInt(hex.slice(1), 16);
    var c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) { var s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  var RULES = [['text', 'background', 4.5, 'Le texte est illisible sur le fond.'], ['text', 'card', 4.5, 'Le texte est illisible sur les cartes.'], ['title', 'background', 3, 'Les titres manquent de contraste sur le fond.'], ['title', 'card', 3, 'Les titres manquent de contraste sur les cartes.'], ['icon', 'background', 3, 'Les icônes manquent de contraste sur le fond.'], ['button', 'background', 3, 'Les boutons manquent de contraste sur le fond.']];
  function paletteProblems(colors) {
    var out = [];
    RULES.forEach(function (r) { if (HEX.test(colors[r[0]]) && HEX.test(colors[r[1]]) && contrast(colors[r[0]], colors[r[1]]) < r[2]) out.push(r[3]); });
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { PRESETS: PRESETS, LIBRARY: LIBRARY, ICONS: ICONS, paletteProblems: paletteProblems }; return; }

  /* ---------- DOM helpers ---------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function btn(label, cls, fn, extra) { return h('button', Object.assign({ type: 'button', class: cls || 'ap-btn', text: label, onclick: fn }, extra || {})); }
  function svgIcon(id) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic');
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s;
  }
  function assetUrl(id) { return ASSET.test(String(id || '')) ? '/api/site/assets/' + id : null; }
  function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  function uid(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }
  function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'x'; }

  var CSS = '' +
    '.ap{margin-top:16px;text-align:left}.ap *{box-sizing:border-box}' +
    '.ap-group{border:1px solid var(--line-soft);border-radius:12px;padding:12px;margin:12px 0}.ap-group .ap-card{margin-top:10px}' +
    '.ap-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;border-bottom:1px solid var(--line-soft);margin-bottom:14px;-webkit-overflow-scrolling:touch}' +
    '.ap-tab{flex:none;padding:8px 12px;border-radius:999px;border:1.5px solid var(--line);background:transparent;color:var(--text);font-size:12.5px;font-weight:600;white-space:nowrap}' +
    '.ap-tab[aria-selected=true]{background:var(--gold);color:#0a0a0a;border-color:var(--gold)}' +
    '.ap h3{margin:0 0 10px;font-size:16px;color:var(--gold-hi)}.ap p.hint{margin:0 0 12px;font-size:12.5px;color:#b9b3a3}' +
    '.ap label{display:block;font-weight:600;font-size:12.5px;margin:10px 0 5px}' +
    '.ap input[type=text],.ap input[type=email],.ap textarea,.ap select{width:100%;padding:10px 12px;border-radius:10px;border:1.5px solid var(--line);background:var(--field,#0a0a0a);color:var(--text);font:inherit;font-size:14px}' +
    '.ap textarea{min-height:110px;resize:vertical}.ap .invalid{border-color:#ff8a7a!important}' +
    '.ap-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ap-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}' +
    '.ap-card{border:1px solid var(--line-soft);border-radius:12px;padding:12px;margin:10px 0;background:rgba(255,255,255,.02)}' +
    '.ap-btn{padding:9px 14px;border-radius:10px;border:1.5px solid var(--line);background:transparent;color:var(--text);font-weight:600;font-size:13px}' +
    '.ap-btn.gold{background:var(--gold);color:#0a0a0a;border-color:var(--gold)}.ap-btn.sm{padding:6px 9px;font-size:12px}.ap-btn.danger{border-color:#7a2b2b;color:#f3c4c4}' +
    '.ap-btn:disabled{opacity:.45;cursor:not-allowed}.ap-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:12px;border-top:1px solid var(--line-soft)}' +
    '.ap-msg{margin:12px 0 0;padding:10px 12px;border-radius:10px;font-size:13px}.ap-msg.err{border:1px solid #7a2b2b;background:#1c0d0d;color:#f3c4c4}.ap-msg.ok{border:1px solid #2f6b3d;background:#0d1c11;color:#c6efd0}.ap-msg.warn{border:1px solid var(--line);background:#14110a;color:var(--gold-hi)}' +
    '.ap-stage{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border:1.5px solid var(--line);border-radius:12px;background:#000;touch-action:none;cursor:grab}.ap-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;user-select:none}' +
    '.ap-thumb{position:relative;border:1.5px solid var(--line-soft);border-radius:10px;overflow:hidden;background:#000}.ap-thumb.main{border-color:var(--gold-hi);box-shadow:0 0 0 1px var(--gold-hi)}.ap-thumb img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}.ap-thumb .bar{display:flex;gap:4px;padding:4px;flex-wrap:wrap}' +
    '.ap-swatch{min-width:0;overflow-wrap:anywhere;display:flex;align-items:center;gap:8px;padding:8px;border-radius:10px;border:1.5px solid var(--line-soft);background:transparent;color:var(--text);font-size:12px;font-weight:600;text-align:left}.ap-swatch[aria-pressed=true]{border-color:var(--gold-hi)}.ap-swatch .sw{display:flex;flex:none;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,.25)}.ap-swatch .sw i{display:block;width:14px;height:22px}' +
    '.ap-color{display:flex;align-items:center;gap:8px}.ap-color input[type=color]{width:42px;height:34px;padding:0;border:1.5px solid var(--line);border-radius:8px;background:transparent}' +
    '.ap-logo{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.ap-logo img{width:84px;height:84px;object-fit:contain;border:1.5px solid var(--line-soft);border-radius:10px;background:#000}' +
    '.ap input[type=file]{font-size:13px;max-width:100%}.adm-card.ap-wide{width:min(980px,100%);max-height:calc(100dvh - 40px);overflow:auto}' +
    '@media(max-width:560px){.ap-grid{grid-template-columns:repeat(2,1fr)}}';

  /* ---------- panel ---------- */
  function mount(o) {
    var root = o.root;
    root.textContent = '';
    if (!document.getElementById('apStyle')) { var st = document.createElement('style'); st.id = 'apStyle'; st.textContent = CSS; document.head.appendChild(st); }
    var card = root.closest('.adm-card'); if (card) card.classList.add('ap-wide');

    var S = { content: {}, versions: {}, tab: (o.tab || (o.sections && o.sections[0]) || 'banner') };
    var ap = h('div', { class: 'ap' });
    var tabs = h('div', { class: 'ap-tabs', role: 'tablist', 'aria-label': 'Sections du panneau' });
    var host = h('div', { class: 'ap-body' });
    ap.appendChild(tabs); ap.appendChild(host); root.appendChild(ap);

    function request(method, url, body, raw) {
      var hd = { Accept: 'application/json' };
      if (method !== 'GET') { hd['X-CSRF-Token'] = o.csrf(); hd['Content-Type'] = raw ? raw.type : 'application/json'; }
      return fetch(url, { method: method, credentials: 'same-origin', headers: hd, body: method === 'GET' ? undefined : (raw ? raw.file : JSON.stringify(body || {})) })
        .then(function (r) {
          if (r.status === 401) { o.unauthorized(); }
          return r.json().catch(function () { return {}; }).then(function (j) { j.status_code = r.status; return j; });
        });
    }
    function load() {
      return request('GET', '/api/admin/site/content').then(function (j) {
        if (j.ok) { S.content = j.content || {}; S.versions = j.versions || {}; }
        return j;
      });
    }
    function showMsg(box, kind, text) { box.className = 'ap-msg ' + kind; box.textContent = text; box.hidden = false; }

    /* generic publish bar: Publier → confirmation → Annuler / Rétablir */
    function actions(section, getValue, opts) {
      opts = opts || {};
      var msg = h('p', { class: 'ap-msg', role: 'status', hidden: true });
      var bar = h('div', { class: 'ap-actions' });
      var pub = btn('Publier', 'ap-btn gold', function () { askConfirm(); });
      var cancel = btn('Annuler les modifications', 'ap-btn', function () { render(); });
      var reset = btn('Rétablir le contenu d’origine', 'ap-btn danger', function () {
        if (reset.dataset.arm !== '1') { reset.dataset.arm = '1'; reset.textContent = 'Confirmer le rétablissement ?'; setTimeout(function () { reset.dataset.arm = ''; reset.textContent = 'Rétablir le contenu d’origine'; }, 5000); return; }
        request('DELETE', '/api/admin/site/content/' + section, {}).then(function (j) {
          if (j.ok) { o.toast('Contenu d’origine rétabli.'); load().then(function () { o.applyAll(); o.reload(); }); } else showMsg(msg, 'err', j.message || 'Échec du rétablissement.');
        }).catch(function () { showMsg(msg, 'err', 'Impossible de joindre le serveur.'); });
      });
      function restoreBar() { bar.textContent = ''; [pub, cancel, reset].forEach(function (b) { bar.appendChild(b); }); }
      function askConfirm() {
        if (opts.validate) { var p = opts.validate(); if (p) { showMsg(msg, 'err', p); return; } }
        bar.textContent = '';
        bar.appendChild(h('span', { text: 'Publier ces modifications sur le site public ?', style: 'align-self:center;font-size:13px' }));
        bar.appendChild(btn('Oui, publier', 'ap-btn gold', doSave));
        bar.appendChild(btn('Non', 'ap-btn', restoreBar));
      }
      function doSave() {
        var value; try { value = getValue(); } catch (e) { restoreBar(); showMsg(msg, 'err', e.message); return; }
        bar.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        request('PUT', '/api/admin/site/content/' + section, { value: value, expectedVersion: S.versions[section] || 0 }).then(function (j) {
          if (j.ok) {
            S.content[section] = j.value; S.versions[section] = j.version;
            o.toast('Modifications publiées.'); o.applyAll(); showMsg(msg, 'ok', 'Publié : les visiteurs voient maintenant ce contenu.');
          } else {
            var m = j.message || 'Échec de l’enregistrement.'; if (j.field) m += ' (' + j.field + ')';
            showMsg(msg, 'err', j.status_code === 429 ? 'Trop de demandes. Réessayez dans quelques minutes.' : m);
          }
        }).catch(function () { showMsg(msg, 'err', 'Impossible de joindre le serveur. Vos données restent dans le formulaire.'); })
          .then(restoreBar);
      }
      [pub, cancel, reset].forEach(function (b) { bar.appendChild(b); });
      var wrap = h('div'); wrap.appendChild(bar); wrap.appendChild(msg); return wrap;
    }

    function upload(file, kinds) {
      var okType = kinds.indexOf(file.type) > -1;
      if (!okType) return Promise.reject(new Error('Format non pris en charge (' + kinds.map(function (k) { return k.split('/')[1].toUpperCase(); }).join(', ') + ').'));
      if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('Fichier trop volumineux (10 Mo maximum).'));
      return request('POST', '/api/admin/site/assets', null, { file: file, type: file.type }).then(function (j) {
        if (!j.ok) throw new Error(j.message || 'Échec de l’envoi du fichier.');
        return j;
      });
    }
    var IMG = ['image/jpeg', 'image/png', 'image/webp'];

    /* ---------- sections ---------- */
    var SECTIONS = [
      ['banner', 'Bannière principale', secBanner], ['categories', 'Domaines d’intervention', secCategories], ['places', 'Lieux d’intervention', secPlaces],
      ['services', 'Nos services', secServices], ['brand', 'Identité de marque', secBrand], ['contact', 'Contact', secContact],
      ['about', 'À propos', secAbout], ['palette', 'Personnalisation des couleurs', secPalette]
    ];

    function secBanner() {
      var cur = S.content.banner || { imageId: null, sourceId: null, zoom: 1, x: 80, y: 100 };
      var st = { imageId: cur.imageId, sourceId: cur.sourceId, zoom: cur.zoom, x: cur.x, y: cur.y };
      var heroImg = document.querySelector('.hero-art img');
      var img = h('img', { alt: 'Aperçu de la bannière' });
      var stage = h('div', { class: 'ap-stage', 'aria-label': 'Zone de cadrage : glissez pour repositionner, pincez ou utilisez le curseur pour zoomer' }, [img]);
      var msgBox = h('p', { class: 'ap-msg', hidden: true, role: 'alert' });
      var zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.05', 'aria-label': 'Niveau de zoom' });
      function paint() {
        var src = assetUrl(st.imageId) || (heroImg ? heroImg.getAttribute('src') : '');
        if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.style.objectPosition = st.x + '% ' + st.y + '%';
        img.style.transformOrigin = st.x + '% ' + st.y + '%';
        img.style.transform = 'scale(' + st.zoom + ')';
        zoom.value = st.zoom;
      }
      function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
      var pts = {}, last = null, pinch = null;
      stage.addEventListener('pointerdown', function (e) { stage.setPointerCapture(e.pointerId); pts[e.pointerId] = { x: e.clientX, y: e.clientY }; stage.style.cursor = 'grabbing'; last = null; pinch = null; });
      stage.addEventListener('pointermove', function (e) {
        if (!pts[e.pointerId]) return;
        var prev = pts[e.pointerId]; pts[e.pointerId] = { x: e.clientX, y: e.clientY };
        var ids = Object.keys(pts);
        var r = stage.getBoundingClientRect();
        if (ids.length === 1) {
          st.x = clamp(st.x - ((e.clientX - prev.x) / r.width) * 100 / st.zoom, 0, 100);
          st.y = clamp(st.y - ((e.clientY - prev.y) / r.height) * 100 / st.zoom, 0, 100);
        } else if (ids.length === 2) {
          var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch) st.zoom = clamp(st.zoom * (d / pinch), 1, 4);
          pinch = d;
        }
        paint();
      });
      function up(e) { delete pts[e.pointerId]; pinch = null; stage.style.cursor = 'grab'; }
      stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
      stage.addEventListener('wheel', function (e) { e.preventDefault(); st.zoom = clamp(st.zoom * (e.deltaY < 0 ? 1.06 : 0.94), 1, 4); paint(); }, { passive: false });
      zoom.addEventListener('input', function () { st.zoom = Number(zoom.value); paint(); });
      var file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,application/pdf', 'aria-label': 'Choisir une image ou un PDF' });
      file.addEventListener('change', function () {
        var f = file.files && file.files[0]; if (!f) return;
        showMsg(msgBox, 'warn', 'Envoi en cours…');
        upload(f, IMG.concat(['application/pdf'])).then(function (j) {
          st.imageId = j.assetId; st.sourceId = j.sourceId; st.zoom = 1; st.x = 50; st.y = 50; paint();
          showMsg(msgBox, 'ok', j.kind === 'pdf' ? 'PDF converti : première page affichée. L’original est conservé.' : 'Image chargée. Ajustez le cadrage puis publiez.');
        }).catch(function (e) { showMsg(msgBox, 'err', e.message); file.value = ''; });
      });
      paint();
      var wrap = h('div', null, [
        h('h3', { text: 'Bannière principale' }),
        h('p', { class: 'hint', text: 'JPG, PNG, WEBP ou PDF (première page). L’image n’est jamais déformée : seul le cadrage change.' }),
        file, h('label', { text: 'Aperçu du résultat final' }), stage,
        h('div', { class: 'ap-row' }, [h('label', { text: 'Zoom', style: 'margin:0' }), zoom, btn('Recentrer', 'ap-btn sm', function () { st.x = 50; st.y = 50; st.zoom = 1; paint(); })]),
        msgBox,
        actions('banner', function () {
          if (!st.imageId) throw new Error('Choisissez d’abord une image.');
          return { imageId: st.imageId, sourceId: st.sourceId, zoom: st.zoom, x: Math.round(st.x * 10) / 10, y: Math.round(st.y * 10) / 10 };
        })
      ]);
      return wrap;
    }

    function selectIcons(value) {
      var s = h('select', { 'aria-label': 'Icône' });
      ICONS.forEach(function (i) { var op = h('option', { value: i[0], text: i[1] }); if (i[0] === value) op.selected = true; s.appendChild(op); });
      return s;
    }

    function secCategories() {
      var saved = S.content.categories;
      var items = saved ? saved.items.map(function (x) { return { id: x.id, label: x.label, icon: x.icon, active: x.active }; })
        : LIBRARY.map(function (l) { return { id: l[0], label: l[1], icon: l[2], active: l[3] }; });
      if (saved) LIBRARY.forEach(function (l) { if (!items.some(function (x) { return x.id === l[0]; })) items.push({ id: l[0], label: l[1], icon: l[2], active: false }); });
      var list = h('div'); var msg = h('p', { class: 'ap-msg', hidden: true });
      function draw() {
        list.textContent = '';
        items.forEach(function (it, i) {
          var chk = h('input', { type: 'checkbox', 'aria-label': 'Afficher ' + it.label }); chk.checked = it.active; chk.onchange = function () { it.active = chk.checked; };
          var lab = h('input', { type: 'text', value: it.label, maxlength: '60', 'aria-label': 'Nom de la catégorie' }); lab.oninput = function () { it.label = lab.value; };
          var ic = selectIcons(it.icon); ic.onchange = function () { it.icon = ic.value; };
          var custom = !LIBRARY.some(function (l) { return l[0] === it.id; });
          list.appendChild(h('div', { class: 'ap-card ap-row' }, [chk, svgIcon(it.icon), h('div', { style: 'flex:1;min-width:150px' }, [lab]), h('div', { style: 'min-width:130px' }, [ic]),
            btn('↑', 'ap-btn sm', function () { move(items, i, -1); draw(); }, { 'aria-label': 'Monter' }), btn('↓', 'ap-btn sm', function () { move(items, i, 1); draw(); }, { 'aria-label': 'Descendre' }),
            custom ? btn('Supprimer', 'ap-btn sm danger', function () { items.splice(i, 1); draw(); }) : null]));
        });
      }
      draw();
      var nl = h('input', { type: 'text', maxlength: '60', placeholder: 'Nouvelle catégorie (seulement si nécessaire)', 'aria-label': 'Nouvelle catégorie' }); var ni = selectIcons('i-other');
      var add = btn('Ajouter', 'ap-btn', function () {
        var t = nl.value.trim(); if (!t) { showMsg(msg, 'err', 'Saisissez un nom.'); return; }
        var id = slug(t); while (items.some(function (x) { return x.id === id; })) id = slug(t).slice(0, 18) + '-' + Math.random().toString(36).slice(2, 5);
        items.push({ id: id, label: t, icon: ni.value, active: true }); nl.value = ''; msg.hidden = true; draw();
      });
      return h('div', null, [h('h3', { text: 'Domaines d’intervention' }), h('p', { class: 'hint', text: 'Cochez les catégories à afficher, changez l’ordre et les icônes. Les catégories cochées apparaissent sur le site.' }), list,
        h('div', { class: 'ap-row' }, [h('div', { style: 'flex:1;min-width:180px' }, [nl]), h('div', { style: 'min-width:130px' }, [ni]), add]), msg,
        actions('categories', function () {
          if (!items.some(function (x) { return x.active; })) throw new Error('Gardez au moins une catégorie active.');
          return { items: items.map(function (x) { return { id: x.id, label: x.label.trim(), icon: x.icon, active: x.active }; }) };
        })]);
    }

    function secPlaces() {
      var saved = S.content.places || { items: [], hideBuiltin: false };
      var cats = (S.content.categories ? S.content.categories.items : LIBRARY.map(function (l) { return { id: l[0], label: l[1], active: l[3] }; })).filter(function (c) { return c.active; });
      var items = saved.items.map(function (p) { return { id: p.id, category: p.category, title: p.title, description: p.description, photos: p.photos.slice(), mainPhoto: p.mainPhoto, active: p.active }; });
      var hide = !!saved.hideBuiltin;
      var list = h('div'); var top = h('div');
      var allCats = (S.content.categories ? S.content.categories.items : LIBRARY.map(function (l) { return { id: l[0], label: l[1], icon: l[2], active: l[3] }; }));
      function draw() {
        list.textContent = '';
        var shown = allCats.filter(function (c) { return c.active || items.some(function (p) { return p.category === c.id; }); });
        shown.forEach(function (c) {
          var mine = items.filter(function (p) { return p.category === c.id; });
          var body = h('div');
          mine.forEach(function (p) { body.appendChild(placeCard(p, mine.indexOf(p))); });
          if (!mine.length) body.appendChild(h('p', { class: 'hint', text: 'Aucun établissement dans cette catégorie.' }));
          var addB = btn(mine.length ? 'AJOUTER UN AUTRE ÉTABLISSEMENT' : 'AJOUTER UN ÉTABLISSEMENT', 'ap-btn gold', function () {
            items.push({ id: uid('lieu-'), category: c.id, title: '', description: '', photos: [], mainPhoto: null, active: true }); draw();
            var cards = list.querySelectorAll('[data-cat="' + c.id + '"] .ap-card'); if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          var g = h('section', { class: 'ap-group', 'data-cat': c.id }, [
            h('div', { class: 'ap-row' }, [svgIcon(c.icon), h('h3', { text: c.label, style: 'margin:0' }), h('span', { class: 'hint', text: mine.length + ' établissement(s)', style: 'margin-left:auto' })]),
            body, addB]);
          list.appendChild(g);
        });
        if (!shown.length) list.appendChild(h('p', { class: 'hint', text: 'Aucune catégorie active. Activez-en une dans « Catégories ».' }));
      }
      function placeCard(p, i) {
        var msg = h('p', { class: 'ap-msg', hidden: true, role: 'alert' });
        var title = h('input', { type: 'text', maxlength: '80', value: p.title, 'aria-label': 'Nom de l’établissement' }); title.oninput = function () { p.title = title.value; };
        var desc = h('textarea', { maxlength: '500', 'aria-label': 'Description' }); desc.value = p.description; desc.oninput = function () { p.description = desc.value; };
        var act = h('input', { type: 'checkbox' }); act.checked = p.active; act.onchange = function () { p.active = act.checked; };
        var grid = h('div', { class: 'ap-grid' });
        function photos() {
          grid.textContent = '';
          p.photos.forEach(function (id, k) {
            var isMain = p.mainPhoto === id;
            grid.appendChild(h('div', { class: 'ap-thumb' + (isMain ? ' main' : '') }, [h('img', { src: assetUrl(id), alt: 'Photo ' + (k + 1) + (isMain ? ' (principale)' : '') }),
              h('div', { class: 'bar' }, [
                btn(isMain ? '★ Principale' : '☆ Principale', 'ap-btn sm', function () { p.mainPhoto = id; photos(); }),
                btn('←', 'ap-btn sm', function () { move(p.photos, k, -1); photos(); }, { 'aria-label': 'Reculer' }), btn('→', 'ap-btn sm', function () { move(p.photos, k, 1); photos(); }, { 'aria-label': 'Avancer' }),
                btn('Retirer', 'ap-btn sm danger', function () { p.photos.splice(k, 1); if (p.mainPhoto === id) p.mainPhoto = p.photos[0] || null; photos(); })])]));
          });
          counter.textContent = p.photos.length + ' / 10 photos';
          add.disabled = p.photos.length >= 10;
        }
        var counter = h('span', { class: 'hint' });
        var delBtn = btn('Supprimer', 'ap-btn sm danger', function () {
          if (delBtn.dataset.arm !== '1') { delBtn.dataset.arm = '1'; delBtn.textContent = 'Confirmer la suppression ?'; setTimeout(function () { delBtn.dataset.arm = ''; delBtn.textContent = 'Supprimer'; }, 4000); return; }
          items.splice(items.indexOf(p), 1); draw();
        });
        var add = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, 'aria-label': 'Ajouter des photos' });
        add.addEventListener('change', function () {
          var files = Array.prototype.slice.call(add.files || []); add.value = '';
          var room = 10 - p.photos.length;
          if (files.length > room) { showMsg(msg, 'err', 'Maximum 10 photos par lieu : ' + (room > 0 ? room + ' envoi(s) possible(s).' : 'limite atteinte.')); files = files.slice(0, Math.max(room, 0)); }
          files.reduce(function (pr, f) {
            return pr.then(function () { return upload(f, IMG).then(function (j) { if (p.photos.indexOf(j.assetId) < 0) p.photos.push(j.assetId); if (!p.mainPhoto) p.mainPhoto = j.assetId; photos(); }); });
          }, Promise.resolve()).catch(function (e) { showMsg(msg, 'err', e.message); });
        });
        photos();
        return h('div', { class: 'ap-card' }, [
          h('div', { class: 'ap-row' }, [h('strong', { text: 'Établissement ' + (i + 1) }), h('label', { style: 'margin:0 0 0 auto' }, [act, ' Visible']), delBtn]),
          h('label', { text: 'Nom de l’établissement' }), title,
          h('label', { text: 'Description (facultatif)' }), desc, h('label', { text: 'Galerie (10 photos maximum ; une photo principale, affichée sur la carte de l’établissement)' }), add, counter, grid, msg]);
      }
      var hideChk = h('input', { type: 'checkbox' }); hideChk.checked = hide; hideChk.onchange = function () { hide = hideChk.checked; };
      top.appendChild(h('div', { class: 'ap-card' }, [h('label', { style: 'margin:0' }, [hideChk, ' Masquer les photos d’exemple intégrées au site']),
        h('p', { class: 'hint', text: 'Par défaut, les photos d’exemple actuelles restent visibles : rien n’est supprimé sans votre accord.' })]));
      draw();
      return h('div', null, [h('h3', { text: 'Lieux d’intervention' }), h('p', { class: 'hint', text: 'Une catégorie apparaît une seule fois sur le site et peut contenir plusieurs établissements, chacun avec sa propre galerie.' }), top, list,
        actions('places', function () {
          var seenT = {};
          items.forEach(function (p, i) {
            var k = p.category + '|' + p.title.trim().toLowerCase().replace(/\s+/g, ' ');
            if (p.title.trim() && seenT[k]) throw new Error('« ' + p.title.trim() + ' » existe déjà dans cette catégorie.'); seenT[k] = 1;
            if (!p.title.trim()) throw new Error('Établissement sans nom : le nom est obligatoire.');
            if (p.photos.length && !p.mainPhoto) throw new Error('« ' + p.title.trim() + ' » : choisissez une photo principale.');
          });
          return { hideBuiltin: hide, items: items.map(function (p) { return { id: p.id, category: p.category, title: p.title.trim(), description: p.description.trim(), photos: p.photos, mainPhoto: p.mainPhoto, active: p.active }; }) };
        })]);
    }

    function secServices() {
      var saved = S.content.services;
      var title = saved ? saved.title : (document.getElementById('t-serv') || {}).textContent || 'Nos services';
      var items = saved ? saved.items.map(function (x) { return Object.assign({}, x); }) : Array.prototype.slice.call(document.querySelectorAll('.quality .q')).map(function (q, i) {
        var u = q.querySelector('use'); return { id: 'svc' + (i + 1), name: q.textContent.trim(), text: '', icon: u ? u.getAttribute('href').slice(1) : 'i-shield', active: true };
      });
      var t = h('input', { type: 'text', maxlength: '80', value: String(title).trim(), 'aria-label': 'Titre de la section' });
      var list = h('div');
      function draw() {
        list.textContent = '';
        items.forEach(function (it, i) {
          var chk = h('input', { type: 'checkbox' }); chk.checked = it.active; chk.onchange = function () { it.active = chk.checked; };
          var n = h('input', { type: 'text', maxlength: '80', value: it.name, 'aria-label': 'Nom du service' }); n.oninput = function () { it.name = n.value; };
          var tx = h('textarea', { maxlength: '300', 'aria-label': 'Texte', style: 'min-height:60px' }); tx.value = it.text; tx.oninput = function () { it.text = tx.value; };
          var ic = selectIcons(it.icon); ic.onchange = function () { it.icon = ic.value; };
          list.appendChild(h('div', { class: 'ap-card' }, [h('div', { class: 'ap-row' }, [chk, svgIcon(it.icon), h('div', { style: 'flex:1;min-width:150px' }, [n]), h('div', { style: 'min-width:130px' }, [ic]),
            btn('↑', 'ap-btn sm', function () { move(items, i, -1); draw(); }, { 'aria-label': 'Monter' }), btn('↓', 'ap-btn sm', function () { move(items, i, 1); draw(); }, { 'aria-label': 'Descendre' }),
            btn('Supprimer', 'ap-btn sm danger', function () { items.splice(i, 1); draw(); })]), h('label', { text: 'Texte d’information (affiché au survol)' }), tx]));
        });
      }
      draw();
      return h('div', null, [h('h3', { text: 'Nos services' }), h('label', { text: 'Titre de la section' }), t, list,
        btn('+ Ajouter un service', 'ap-btn', function () { if (items.length >= 12) return; items.push({ id: uid('svc-'), name: '', text: '', icon: 'i-check', active: true }); draw(); }),
        actions('services', function () {
          items.forEach(function (x, i) { if (!x.name.trim()) throw new Error('Service ' + (i + 1) + ' : le nom est obligatoire.'); });
          return { title: t.value.trim(), items: items.map(function (x) { return { id: x.id, name: x.name.trim(), text: x.text.trim(), icon: x.icon, active: x.active }; }) };
        })]);
    }

    function logoSlot(label, st, key) {
      var prev = h('img', { alt: label }); var msg = h('p', { class: 'ap-msg', hidden: true, role: 'alert' });
      function paint() { var u = assetUrl(st[key]); if (u) prev.setAttribute('src', u); else prev.removeAttribute('src'); prev.style.visibility = u ? 'visible' : 'hidden'; }
      var f = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': label });
      f.onchange = function () {
        var file = f.files && f.files[0]; if (!file) return;
        upload(file, IMG).then(function (j) { st[key] = j.assetId; paint(); msg.hidden = true; }).catch(function (e) { showMsg(msg, 'err', e.message); f.value = ''; });
      };
      paint();
      return h('div', { class: 'ap-card' }, [h('strong', { text: label }), h('div', { class: 'ap-logo' }, [prev, f, btn('Retirer (logo d’origine)', 'ap-btn sm', function () { st[key] = null; f.value = ''; paint(); })]), msg]);
    }
    function secBrand() {
      var cur = S.content.brand || {};
      var st = { name: cur.name || ((document.getElementById('f-about') || {}).textContent || 'VECTIS').trim(), logoMain: cur.logoMain || null, logoFooter: cur.logoFooter || null, logoAbout: cur.logoAbout || null };
      var n = h('input', { type: 'text', maxlength: '60', value: st.name, 'aria-label': 'Nom commercial' }); n.oninput = function () { st.name = n.value; };
      return h('div', null, [h('h3', { text: 'Identité de marque' }), h('p', { class: 'hint', text: 'Le nom et les logos sont remplacés partout où ils apparaissent. Les proportions des images sont conservées.' }),
        h('label', { text: 'Nom commercial de l’entreprise' }), n, logoSlot('Logo principal (en-tête et page d’accueil)', st, 'logoMain'), logoSlot('Logo du pied de page', st, 'logoFooter'), logoSlot('Logo de la section « À propos »', st, 'logoAbout'),
        actions('brand', function () { if (!st.name.trim()) throw new Error('Le nom commercial est obligatoire.'); return { name: st.name.trim(), logoMain: st.logoMain, logoFooter: st.logoFooter, logoAbout: st.logoAbout }; })]);
    }

    function secContact() {
      var cur = S.content.contact || { company: 'VECTIS', address: '8 Rue Pasteur', postalCode: '69200', city: 'Vénissieux', country: 'France', phone: '', email: '', siren: '107 463 358' };
      var fields = [['company', 'Nom de l’entreprise', 80], ['address', 'Adresse', 120], ['postalCode', 'Code postal', 12], ['city', 'Ville', 80], ['country', 'Pays', 60], ['phone', 'Téléphone', 30], ['email', 'E-mail', 120], ['siren', 'Numéro SIREN', 20]];
      var inputs = {}; var kids = [h('h3', { text: 'Contact' }), h('p', { class: 'hint', text: 'Ces informations sont mises à jour dans la section Contact et dans le pied de page. Le formulaire de devis n’est pas modifié.' })];
      fields.forEach(function (f) { var i = h('input', { type: f[0] === 'email' ? 'email' : 'text', maxlength: String(f[2]), value: cur[f[0]] || '', 'aria-label': f[1] }); inputs[f[0]] = i; kids.push(h('label', { text: f[1] }), i); });
      kids.push(actions('contact', function () {
        var v = {}; fields.forEach(function (f) { v[f[0]] = inputs[f[0]].value.trim(); });
        if (!v.company) throw new Error('Le nom de l’entreprise est obligatoire.');
        if (v.email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(v.email)) throw new Error('Adresse e-mail invalide.');
        if (v.phone && !/^[+\d][\d\s().-]{6,}$/.test(v.phone)) throw new Error('Numéro de téléphone invalide.');
        if (v.siren && !/^\d{3}\s?\d{3}\s?\d{3}$/.test(v.siren)) throw new Error('Le SIREN comporte 9 chiffres.');
        return v;
      }));
      return h('div', null, kids);
    }

    function secAbout() {
      var cur = S.content.about || { title: ((document.getElementById('t-about') || {}).textContent || 'À propos').trim(), text: ((document.querySelector('.about-box p') || {}).textContent || '').trim(), imageId: null };
      var st = { imageId: cur.imageId };
      var t = h('input', { type: 'text', maxlength: '80', value: cur.title, 'aria-label': 'Titre' });
      var tx = h('textarea', { maxlength: '2000', 'aria-label': 'Texte de présentation', style: 'min-height:170px' }); tx.value = cur.text;
      return h('div', null, [h('h3', { text: 'À propos' }), h('label', { text: 'Titre' }), t, h('label', { text: 'Texte de présentation' }), tx, logoSlot('Image ou logo de la section', st, 'imageId'),
        actions('about', function () { if (!t.value.trim() || !tx.value.trim()) throw new Error('Le titre et le texte sont obligatoires.'); return { title: t.value.trim(), text: tx.value.trim(), imageId: st.imageId }; })]);
    }

    function secPalette() {
      var saved = S.content.palette;
      var cur = saved ? { preset: saved.preset, colors: Object.assign({}, saved.colors) } : { preset: 'noir-or', colors: Object.assign({}, PRESETS[0].colors) };
      var st = { preset: cur.preset, colors: cur.colors };
      var warn = h('p', { class: 'ap-msg err', hidden: true, role: 'alert' });
      var pubWrap;
      var grid = h('div', { class: 'ap-grid' }); var manual = h('div', { class: 'ap-grid' });
      function preview() {
        var problems = paletteProblems(st.colors);
        warn.hidden = !problems.length; warn.textContent = problems.join(' ');
        if (!problems.length) o.applyPalette({ colors: st.colors });
        grid.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.id === st.preset)); });
      }
      PRESETS.forEach(function (p) {
        var sw = h('span', { class: 'sw' }, [p.colors.background, p.colors.card, p.colors.primary, p.colors.title].map(function (c) { return h('i', { style: 'background:' + c }); }));
        grid.appendChild(h('button', { type: 'button', class: 'ap-swatch', 'data-id': p.id, 'aria-pressed': String(p.id === st.preset), onclick: function () { st.preset = p.id; st.colors = Object.assign({}, p.colors); drawManual(); preview(); } }, [sw, p.name]));
      });
      function drawManual() {
        manual.textContent = '';
        PALETTE_KEYS.forEach(function (k) {
          var i = h('input', { type: 'color', value: st.colors[k[0]], 'aria-label': k[1] });
          i.oninput = function () { st.colors[k[0]] = i.value; st.preset = 'personnalisee'; preview(); };
          manual.appendChild(h('div', { class: 'ap-color' }, [i, h('span', { text: k[1], style: 'font-size:12.5px' })]));
        });
      }
      drawManual();
      function restoreSite() { var sv = S.content.palette; o.applyPalette(sv ? { colors: sv.colors } : null); }
      var wrap = h('div', null, [h('h3', { text: 'Personnalisation des couleurs' }), h('p', { class: 'hint', text: 'L’aperçu s’applique en direct au site et au panneau ; il n’est publié qu’après confirmation. Les combinaisons illisibles sont refusées.' }),
        grid, h('h3', { text: 'Personnalisation manuelle', style: 'margin-top:16px' }), manual, warn]);
      pubWrap = actions('palette', function () {
        var p = paletteProblems(st.colors); if (p.length) throw new Error(p.join(' '));
        return { preset: st.preset, colors: st.colors };
      }, { validate: function () { var p = paletteProblems(st.colors); return p.length ? p.join(' ') : null; } });
      wrap.appendChild(pubWrap);
      wrap.appendChild(btn('Annuler et revenir aux couleurs publiées', 'ap-btn sm', function () { restoreSite(); render(); }));
      wrap.__leave = restoreSite;
      return wrap;
    }

    /* ---------- tab rendering ---------- */
    var leave = null;
    function render() {
      if (leave) { try { leave(); } catch (e) { /* aperçu abandonné */ } leave = null; }
      tabs.textContent = '';
      var visible = SECTIONS.filter(function (s) { return !o.sections || o.sections.indexOf(s[0]) >= 0; });
      if (visible.length && !visible.some(function (s) { return s[0] === S.tab; })) S.tab = visible[0][0];
      tabs.hidden = visible.length < 2;
      visible.forEach(function (s) {
        tabs.appendChild(h('button', { type: 'button', class: 'ap-tab', role: 'tab', 'aria-selected': String(S.tab === s[0]), text: s[1], onclick: function () { S.tab = s[0]; render(); } }));
      });
      host.textContent = '';
      var sec = SECTIONS.filter(function (s) { return s[0] === S.tab; })[0];
      var view = sec[2]();
      if (view.__leave) leave = view.__leave;
      host.appendChild(view);
    }

    load().then(function (j) {
      if (!j.ok) { host.appendChild(h('p', { class: 'ap-msg err', text: j.message || 'Impossible de charger le contenu.' })); return; }
      render();
    }).catch(function () { host.appendChild(h('p', { class: 'ap-msg err', text: 'Impossible de joindre le serveur.' })); });
  }

  window.VectisAdmin = { mount: mount, data: { LIBRARY: LIBRARY, ICONS: ICONS, PRESETS: PRESETS } };
})();
