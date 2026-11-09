/* VECTIS — édition directe sur la page (administrateur authentifié uniquement).
   Chargé après une connexion réussie ; les visiteurs ne reçoivent ni ce fichier, ni ses styles, ni aucun contrôle.
   Principe : chaque clic sur un élément du site ouvre l'édition de CET élément, sur place. Les changements alimentent un
   brouillon en mémoire, prévisualisé avec les mêmes fonctions que le site public. Rien n'est publié sans « Publier »
   (même API, mêmes validateurs, même versionnage que le reste de l'administration). Toute donnée est insérée via textContent/value. */
(function () {
  'use strict';

  var ASSET = /^[0-9a-f]{32}$/;
  var IMG = ['image/jpeg', 'image/png', 'image/webp'];
  var ORDER = ['categories', 'places', 'brand', 'banner', 'about', 'services', 'contact', 'texts'];
  var LABELS = { categories: 'Catégories', places: 'Établissements', brand: 'Logos et nom', banner: 'Bannière', about: 'À propos', services: 'Services', contact: 'Contact', texts: 'Textes', palette: 'Couleurs' };
  var o = null, active = false, C = { content: {}, versions: {} }, D = {}, pop = null, textEd = null, bar = null, started = false;

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function uid(p) { return p + Math.random().toString(36).slice(2, 8); }
  function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'x'; }
  function assetUrl(id) { return ASSET.test(String(id || '')) ? '/api/site/assets/' + id : null; }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v === null || v === undefined || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e[k] = v; else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function btn(label, cls, fn, extra) { return h('button', Object.assign({ type: 'button', class: 'vbtn ' + (cls || ''), text: label, onclick: fn }, extra || {})); }
  function svgIcon(id) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic');
    var u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.appendChild(u); return s;
  }
  function armed(b, label, fn) { /* confirmation en deux temps, sans boîte de dialogue */
    b.onclick = function () {
      if (b.dataset.arm !== '1') { b.dataset.arm = '1'; b.textContent = 'Confirmer ?'; setTimeout(function () { b.dataset.arm = ''; b.textContent = label; }, 4000); return; }
      fn();
    };
    return b;
  }
  function req(method, url, body, raw) {
    var hd = { Accept: 'application/json' };
    if (method !== 'GET') { hd['X-CSRF-Token'] = o.csrf(); hd['Content-Type'] = raw ? raw.type : 'application/json'; }
    return fetch(url, { method: method, credentials: 'same-origin', headers: hd, body: method === 'GET' ? undefined : (raw ? raw.file : JSON.stringify(body || {})) })
      .then(function (r) {
        if (r.status === 401) o.unauthorized();
        return r.json().catch(function () { return {}; }).then(function (j) { j.status_code = r.status; return j; });
      });
  }
  function upload(file, kinds) {
    if (kinds.indexOf(file.type) < 0) return Promise.reject(new Error('Format non pris en charge (' + kinds.map(function (k) { return k.split('/')[1].toUpperCase(); }).join(', ') + ').'));
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('Fichier trop volumineux (10 Mo maximum).'));
    return req('POST', '/api/admin/site/assets', null, { file: file, type: file.type }).then(function (j) {
      if (!j.ok) throw new Error(j.status_code === 413 ? 'Fichier refusé par le serveur (limite de taille actuelle). Essayez un fichier plus léger.' : (j.message || 'Échec de l’envoi du fichier.'));
      return j;
    });
  }

  var CSS =
    '.vpop{position:absolute;z-index:95;width:min(370px,calc(100vw - 24px));max-height:78vh;overflow:auto;padding:14px;border:1.5px solid var(--gold);border-radius:14px;background:var(--panel);color:var(--text);box-shadow:0 12px 36px rgba(0,0,0,.55);font-size:14px;line-height:1.4}' +
    '.vpop h4{margin:0 0 10px;font-size:14px;letter-spacing:.03em;color:var(--gold-hi)}' +
    '.vpop label{display:block;margin:10px 0 4px;font-size:12px;color:var(--text);opacity:.8}.vpop label.chk{display:flex;gap:8px;align-items:center;opacity:1;margin:10px 0}' +
    '.vpop input[type=text],.vpop input[type=email],.vpop textarea,.vpop select{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--ink);color:var(--text);font:inherit}' +
    '.vpop textarea{min-height:72px;resize:vertical}.vpop input[type=file]{width:100%;font-size:12px;color:var(--text)}' +
    '.vpop .vrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}.vpop .vhint{font-size:12px;opacity:.7;margin:6px 0 0}' +
    '.vpop .verr{margin:10px 0 0;padding:8px 10px;border-radius:8px;background:rgba(224,58,58,.15);border:1px solid #e03a3a;color:#ffd0d0;font-size:13px}' +
    '.vbtn{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:5px 13px;border-radius:99px;border:1px solid var(--line);background:transparent;color:var(--text);font-weight:600;font-size:13px;line-height:1.1;font-family:inherit;cursor:pointer}' +
    '.vbtn:hover,.vbtn:focus-visible{border-color:var(--gold-hi);color:var(--gold-hi)}.vbtn.go{background:var(--gold-grad);border-color:var(--gold);color:#0a0a0a}.vbtn.go:hover{color:#0a0a0a;filter:brightness(1.08)}' +
    '.vbtn.sm{min-height:28px;padding:3px 9px;font-size:12px}.vbtn.danger{border-color:#e03a3a;color:#ff9d9d}.vbtn:disabled{opacity:.45;cursor:default}' +
    '.vpop.wide{width:min(600px,calc(100vw - 24px))}.vpop .vplace{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-top:8px}.vpop .vplace>.vhead{display:flex;gap:8px;align-items:center}.vpop .vplace>.vhead strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.vpop .vsec{margin-top:14px;padding-top:10px;border-top:1px solid var(--line-soft)}.vpop .vrow.tight{margin-top:6px}.vpop .vcols{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media(max-width:560px){.vpop .vcols{grid-template-columns:1fr}}' +
    '.vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:8px;margin-top:8px}.vth{position:relative;border:1.5px solid var(--line);border-radius:8px;overflow:hidden;background:var(--ink)}' +
    '.vth.main{border-color:#59d36a}.vth img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}.vth .vb{display:flex;flex-wrap:wrap;gap:2px;padding:3px;background:rgba(0,0,0,.7)}.vth .vb button{flex:1;min-width:24px;border:0;border-radius:5px;background:#222;color:#fff;font-size:11px;padding:3px 2px;cursor:pointer}' +
    '.vlist{margin:8px 0 0;padding:0;list-style:none}.vlist li{display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line-soft)}.vlist li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.vlogo{display:block;max-width:100%;max-height:90px;margin:4px auto;object-fit:contain;background:var(--ink);border:1px dashed var(--line);border-radius:8px;padding:6px}' +
    '.vmini{position:absolute;z-index:96;display:flex;gap:6px;align-items:center;padding:5px;border-radius:99px;border:1.5px solid #59d36a;background:var(--panel);box-shadow:0 6px 18px rgba(0,0,0,.5)}.vmini .verr{font-size:12px;color:#ffb3b3;padding:0 6px}' +
    '.vbar{position:fixed;z-index:81;left:50%;transform:translateX(-50%);bottom:calc(64px + env(safe-area-inset-bottom,0px));display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 24px);padding:7px 10px;border-radius:16px;border:1.5px solid var(--line);background:var(--panel);color:var(--text);font-size:12.5px;box-shadow:0 6px 22px rgba(0,0,0,.5)}' +
    '.vbar[hidden]{display:none}.vbar.dirty{border-color:var(--gold-hi)}.vbar .vmsg{padding:0 4px}.vbar .verr{color:#ffb3b3}' +
    'body.v-editing .vedit-on{cursor:pointer;outline:1px dashed transparent;outline-offset:3px;transition:outline-color .15s}' +
    'body.v-editing .vedit-on:hover,body.v-editing .vedit-on:focus-visible{outline-color:#59d36a}' +
    'body.v-editing .vadd{display:flex;align-items:center;justify-content:center;gap:6px;border:1.5px dashed #59d36a!important;background:transparent!important;color:#bff2c6!important;cursor:pointer;min-height:64px;font-size:13px;font-weight:600;border-radius:12px;padding:8px 12px}' +
    'body.v-editing .card.vadd{flex:0 0 auto;min-width:130px;aspect-ratio:auto}body.v-editing .vghost{opacity:.5;border-style:dashed!important}' +
    '.vedit-txt{outline:2px solid #59d36a!important;outline-offset:3px;border-radius:4px;cursor:text!important;-webkit-user-select:text;user-select:text}' +
    '@media(max-width:560px){.vpop{position:fixed!important;left:8px!important;right:8px!important;top:auto!important;bottom:8px!important;width:auto;max-height:72vh}.vbar{bottom:calc(60px + env(safe-area-inset-bottom,0px))}}';

  /* ---------- données : publié (C), brouillon (D), valeurs par défaut du site intégré ---------- */
  function lib() { return (window.VectisAdmin && window.VectisAdmin.data) || { LIBRARY: [], ICONS: [] }; }
  function defaults(sec) {
    switch (sec) {
      case 'brand': return { name: (($('#f-about') || {}).textContent || 'VECTIS').trim(), logoMain: null, logoFooter: null, logoAbout: null };
      case 'contact': return { company: 'VECTIS', address: '8 Rue Pasteur', postalCode: '69200', city: 'Vénissieux', country: 'France', phone: '', email: '', siren: '107 463 358' };
      case 'about': return { title: (($('#t-about') || {}).textContent || 'À propos').trim(), text: (($('.about-box p') || {}).textContent || '').trim(), imageId: null };
      case 'services': return {
        title: (($('#t-serv') || {}).textContent || 'Nos services').trim(),
        items: $$('.quality .q:not(.vadd):not(.vghost)').map(function (q, i) { var u = $('use', q); return { id: q.dataset.sid || 'svc' + (i + 1), name: q.textContent.trim(), text: '', icon: u ? u.getAttribute('href').slice(1) : 'i-shield', active: true }; })
      };
      case 'categories': return { items: lib().LIBRARY.map(function (l) { return { id: l[0], label: l[1], subtitle: '', icon: l[2], active: l[3] }; }) };
      case 'places': return { items: [], hideBuiltin: false };
      case 'banner': return { imageId: null, sourceId: null, zoom: 1, x: 50, y: 50 };
      case 'texts': return { items: [] };
    }
    return null;
  }
  function cur(sec) { return clone(D[sec] || C.content[sec] || defaults(sec)); }
  function mutate(sec, fn) { var v = cur(sec); fn(v); D[sec] = v; refresh(); }
  function dirtyList() { return ORDER.filter(function (s) { return D[s]; }); }
  function textOf(key) { var t = cur('texts').items.filter(function (x) { return x.key === key; })[0]; return t ? t.text : null; }

  function refresh() {
    var merged = Object.assign({}, C.content, D);
    if (window.vectisApplyContent) window.vectisApplyContent(merged);
    decorate(); paintBar();
  }

  /* ---------- repérage des éléments modifiables ---------- */
  var TEXT_SPECS = [ /* sélecteur → { section, champ } ; les clés « texts » viennent de la table publique */
    ['#t-about', { sec: 'about', field: 'title', max: 80 }], ['.about-box p', { sec: 'about', field: 'text', max: 2000, multi: true }],
    ['#t-serv', { sec: 'services', field: 'title', max: 80 }], ['#f-about', { sec: 'brand', field: 'name', max: 60 }]
  ];
  function textSpec(el) {
    for (var i = 0; i < TEXT_SPECS.length; i++) { var m = el.closest(TEXT_SPECS[i][0]); if (m) return { el: m, spec: TEXT_SPECS[i][1] }; }
    var T = window.vectisTextTargets || {};
    for (var k in T) { if (/^(hero|perk)/.test(k)) continue; var n = el.closest(T[k]); if (n) return { el: n, spec: { sec: 'texts', key: k, max: 160, multi: /^step/.test(k) } }; }
    return null;
  }
  function decorate() {
    if (!active) return;
    var mark = function (sel) { $$(sel).forEach(function (e) { e.classList.add('vedit-on'); }); };
    $$('.vadd,.vghost').forEach(function (e) { e.remove(); });
    ['.site-header .brand', '.foot-logo', '.about-box .badge', '#accueil', '.dom', '.card', '.q', '.contact-list li', '#f-contact + ul li'].forEach(mark);
    Object.keys(window.vectisTextTargets || {}).filter(function (k) { return !/^(hero|perk)/.test(k); }).map(function (k) { return window.vectisTextTargets[k]; }).concat(TEXT_SPECS.map(function (t) { return t[0]; })).forEach(mark);
    var f = $('#f-contact'); if (f && f.parentNode) $$('ul li', f.parentNode).forEach(function (e) { e.classList.add('vedit-on'); });
    var q = $('.quality');
    if (q) {
      q.hidden = false;
      $$('.q', q).forEach(function (e, i) { if (!e.dataset.sid) e.dataset.sid = 'svc' + (i + 1); });
      var sv = cur('services');
      sv.items.filter(function (x) { return !x.active; }).forEach(function (x) { var g = h('div', { class: 'q vghost vedit-on', 'data-sid': x.id, title: 'Service masqué' }, [svgIcon(x.icon), x.name]); q.appendChild(g); });
      q.appendChild(h('div', { class: 'q vadd', 'data-act': 'add-service', role: 'button', tabindex: '0', text: '+ Ajouter un service' }));
    }
    var d = $('#domains'); if (d) d.appendChild(h('button', { type: 'button', class: 'dom vadd', 'data-act': 'add-cat', text: '+ Catégorie' }));
    var g = $('#gal'); if (g) g.appendChild(h('button', { type: 'button', class: 'card vadd', 'data-act': 'add-place', text: '+ Ajouter un établissement' }));
  }

  /* ---------- fenêtres contextuelles (popovers) ---------- */
  function closePop(ok) { if (pop) { var c = pop.cancel, n = pop.node; pop = null; n.remove(); if (!ok && c) c(); } }
  function openPop(anchor, title, body, onOk, opts) {
    opts = opts || {};
    commitText(true); closePop();
    var err = h('p', { class: 'verr', hidden: true, role: 'alert' });
    var node = h('div', { class: 'vpop' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-label': title }, [h('h4', { text: title }), body, err]);
    var ok = btn(opts.okLabel || 'OK', 'go', function () {
      var m = onOk(); if (m) { err.textContent = m; err.hidden = false; return; } closePop(true);
    });
    var row = h('div', { class: 'vrow' }, [ok, btn('Annuler', '', function () { cancelPop(); })].concat(opts.extra || []));
    node.appendChild(row); document.body.appendChild(node);
    var r = anchor.getBoundingClientRect(), w = node.offsetWidth;
    var left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8));
    var top = window.scrollY + r.bottom + 8;
    node.style.left = left + 'px'; node.style.top = top + 'px';
    pop = { node: node, cancel: opts.onCancel, err: err, anchor: anchor };
    var f = $('input,textarea,select', node); if (f && !opts.noFocus) f.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return node;
  }
  function cancelPop() { closePop(false); }
  function field(label, input) { return [h('label', { text: label }), input]; }
  function inputText(value, max, label) { return h('input', { type: 'text', maxlength: String(max), value: value || '', 'aria-label': label }); }
  function iconSelect(value) {
    var s = h('select', { 'aria-label': 'Icône' });
    lib().ICONS.forEach(function (i) { var op = h('option', { value: i[0], text: i[1] }); if (i[0] === value) op.selected = true; s.appendChild(op); });
    return s;
  }

  /* ---------- texte modifiable sur place ---------- */
  function commitText(silent) { if (textEd) textEd.finish(true, silent); }
  function startText(el, spec) {
    commitText(); closePop();
    var keepers = '.bub,svg';
    var host = h('span', { class: 'vedit-txt', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-label': 'Modifier le texte' });
    var saved = el.innerHTML;
    var nodes = Array.prototype.slice.call(el.childNodes).filter(function (n) { return !(n.nodeType === 1 && n.matches(keepers)); });
    nodes.forEach(function (n) { host.appendChild(n); });
    el.appendChild(host);
    var start = host.innerText.replace(/ /g, ' ');
    var mini = h('div', { class: 'vmini' }); var msg = h('span', { class: 'verr', hidden: true });
    function place() { var r = host.getBoundingClientRect(); mini.style.left = Math.max(8, window.scrollX + r.left) + 'px'; mini.style.top = (window.scrollY + r.bottom + 8) + 'px'; }
    function read() { return host.innerText.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }
    function finish(save, silent) {
      var v = read();
      if (save) {
        if (!v) { msg.textContent = 'Le texte ne peut pas être vide.'; msg.hidden = false; return false; }
        if (v.length > spec.max) { msg.textContent = 'Maximum ' + spec.max + ' caractères.'; msg.hidden = false; return false; }
        if (!spec.multi && /\n/.test(v)) v = v.replace(/\n+/g, ' ');
      }
      mini.remove(); document.removeEventListener('keydown', key, true); textEd = null;
      el.innerHTML = saved;
      if (save && v !== start.trim()) apply(v); else if (!save) refresh();
      return true;
    }
    function apply(v) {
      if (spec.sec === 'texts') mutate('texts', function (t) { var x = t.items.filter(function (i) { return i.key === spec.key; })[0]; if (x) x.text = v; else t.items.push({ key: spec.key, text: v }); });
      else mutate(spec.sec, function (d) { d[spec.field] = v; });
    }
    function key(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && (!spec.multi || e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
    }
    host.addEventListener('paste', function (e) { e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, spec.multi ? t : t.replace(/\s*\n\s*/g, ' ')); });
    mini.appendChild(btn('✓', 'go sm', function () { finish(true); }, { 'aria-label': 'Valider le texte' }));
    mini.appendChild(btn('✕', 'sm', function () { finish(false); }, { 'aria-label': 'Annuler la modification du texte' }));
    mini.appendChild(msg);
    document.body.appendChild(mini); place(); document.addEventListener('keydown', key, true);
    textEd = { finish: finish }; host.focus();
    var sel = window.getSelection(); var rg = document.createRange(); rg.selectNodeContents(host); sel.removeAllRanges(); sel.addRange(rg);
  }

  /* ---------- logos et images ---------- */
  function logoEditor(el, label, apply, curId, resetLabel) {
    var st = { id: curId }; var prev = h('img', { class: 'vlogo', alt: label, src: el.getAttribute('src') || '' });
    var f = h('input', { type: 'file', accept: IMG.join(','), 'aria-label': label });
    var info = h('p', { class: 'vhint', text: 'PNG, JPEG ou WebP. Les proportions sont conservées.' });
    f.onchange = function () {
      var file = f.files && f.files[0]; if (!file) return;
      info.textContent = 'Envoi en cours…';
      upload(file, IMG).then(function (j) { st.id = j.assetId; prev.src = assetUrl(j.assetId); info.textContent = 'Nouvelle image prête : validez avec OK.'; })
        .catch(function (e) { info.textContent = e.message; f.value = ''; });
    };
    var extra = [armed(btn(resetLabel || 'Logo d’origine', 'sm danger'), resetLabel || 'Logo d’origine', function () { apply(null); closePop(true); })];
    openPop(el, label, h('div', null, [prev, f, info]), function () { if (st.id !== curId) apply(st.id); }, { extra: extra, noFocus: true });
  }
  function editLogo(kind, el) {
    var key = { main: 'logoMain', footer: 'logoFooter', about: 'logoAbout' }[kind];
    var title = { main: 'Logo principal (en-tête et accueil)', footer: 'Logo du pied de page', about: 'Logo de la section À propos' }[kind];
    logoEditor(el, title, function (id) { mutate('brand', function (b) { b[key] = id; }); }, cur('brand')[key]);
  }

  function editBanner(el) {  /* el = toute la section d'accueil : photo, logo, slogan et textes forment UNE seule composition */
    var art = $('.hero-art', el), img = art && $('img', art); if (!img) return;
    var orig = { src: img.getAttribute('src'), style: img.getAttribute('style'), had: el.classList.contains('has-banner') };
    var b = cur('banner');
    function paint() { if (window.vectisApplyBanner) window.vectisApplyBanner(b); }
    function clamp(v, a, z) { return Math.max(a, Math.min(z, v)); }
    var zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.05', value: String(b.zoom), 'aria-label': 'Zoom' });
    zoom.oninput = function () { b.zoom = Number(zoom.value); paint(); };
    var f = h('input', { type: 'file', accept: IMG.concat(['application/pdf']).join(','), 'aria-label': 'Remplacer toute la bannière' });
    var prev = h('img', { class: 'vlogo', alt: 'Aperçu de la composition complète', hidden: true });
    var info = h('p', { class: 'vhint', text: 'L’image remplace TOUTE la bannière (photo, logo, slogan, textes, décor). Glissez sur la page pour cadrer, réglez le zoom, puis validez. JPEG, PNG, WebP ou PDF (1re page).' });
    f.onchange = function () {
      var file = f.files && f.files[0]; if (!file) return; info.textContent = 'Envoi en cours…';
      upload(file, IMG.concat(['application/pdf'])).then(function (j) {
        b.imageId = j.assetId; b.sourceId = j.sourceId; b.zoom = 1; b.x = 50; b.y = 50; zoom.value = '1'; paint();
        prev.src = assetUrl(j.assetId); prev.hidden = false; info.textContent = 'Composition remplacée : cadrez-la sur la page, puis validez avec OK.';
      }).catch(function (e) { info.textContent = e.message; f.value = ''; });
    };
    var drag = null;
    function down(e) { if (e.target.closest('.vpop,.vmini,.vbar,#vdock')) return; drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); e.preventDefault(); }
    function move(e) {
      if (!drag) return; var r = art.getBoundingClientRect();
      b.x = clamp(b.x - (e.clientX - drag.x) / r.width * 100 / b.zoom, 0, 100); b.y = clamp(b.y - (e.clientY - drag.y) / r.height * 100 / b.zoom, 0, 100);
      drag = { x: e.clientX, y: e.clientY }; paint();
    }
    function up() { drag = null; }
    function wheel(e) { if (e.target.closest('.vpop,.vbar,#vdock')) return; e.preventDefault(); b.zoom = clamp(b.zoom * (e.deltaY < 0 ? 1.06 : 0.94), 1, 4); zoom.value = String(b.zoom); paint(); }
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('wheel', wheel, { passive: false });
    el.style.touchAction = 'none'; el.style.cursor = 'grab';
    function off() { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('wheel', wheel); el.style.touchAction = ''; el.style.cursor = ''; }
    var origCancel = function () { off(); img.setAttribute('src', orig.src); if (orig.style === null) img.removeAttribute('style'); else img.setAttribute('style', orig.style); el.classList.toggle('has-banner', orig.had); refresh(); };
    var node = openPop(el, 'Bannière complète : image et cadrage', h('div', null, [f, prev, h('label', { text: 'Zoom' }), zoom, info]), function () {
      off(); b.zoom = Math.round(b.zoom * 100) / 100; b.x = Math.round(b.x * 10) / 10; b.y = Math.round(b.y * 10) / 10; D.banner = b; refresh(); return null;
    }, { onCancel: origCancel, noFocus: true, extra: [btn('Recentrer', 'sm', function () { b.x = 50; b.y = 50; b.zoom = 1; zoom.value = '1'; paint(); })] });
    node.style.top = (window.scrollY + el.getBoundingClientRect().bottom - node.offsetHeight - 12) + 'px';
  }

  /* ---------- services ---------- */
  function editService(el, isNew) {
    var sv = cur('services'); var id = el && el.dataset.sid;
    var idx = sv.items.map(function (x) { return x.id; }).indexOf(id);
    var w = isNew ? { id: uid('svc-'), name: '', text: '', icon: 'i-check', active: true } : clone(sv.items[idx]);
    if (!isNew && idx < 0) return;
    var name = inputText(w.name, 80, 'Titre du service'); name.oninput = function () { w.name = name.value; };
    var text = h('textarea', { maxlength: '300', 'aria-label': 'Description' }); text.value = w.text; text.oninput = function () { w.text = text.value; };
    var ic = iconSelect(w.icon); ic.onchange = function () { w.icon = ic.value; };
    var vis = h('input', { type: 'checkbox' }); vis.checked = w.active; vis.onchange = function () { w.active = vis.checked; };
    var body = h('div', null, [].concat(field('Titre', name), field('Description (info-bulle sur le site)', text), field('Icône', ic), [h('label', { class: 'chk' }, [vis, 'Visible sur le site'])]));
    var extra = [];
    if (!isNew) {
      extra.push(btn('←', 'sm', function () { mutate('services', function (d) { var i = d.items.map(function (x) { return x.id; }).indexOf(id); if (i > 0) { var t = d.items[i - 1]; d.items[i - 1] = d.items[i]; d.items[i] = t; } }); closePop(true); }, { 'aria-label': 'Déplacer avant' }));
      extra.push(btn('→', 'sm', function () { mutate('services', function (d) { var i = d.items.map(function (x) { return x.id; }).indexOf(id); if (i < d.items.length - 1) { var t = d.items[i + 1]; d.items[i + 1] = d.items[i]; d.items[i] = t; } }); closePop(true); }, { 'aria-label': 'Déplacer après' }));
      extra.push(armed(btn('Supprimer', 'sm danger'), 'Supprimer', function () { mutate('services', function (d) { d.items = d.items.filter(function (x) { return x.id !== id; }); }); closePop(true); }));
    }
    openPop(el, isNew ? 'Nouveau service' : 'Service', body, function () {
      if (!w.name.trim()) return 'Le titre est obligatoire.';
      if (isNew && sv.items.length >= 12) return 'Maximum 12 services.';
      w.name = w.name.trim(); w.text = w.text.trim();
      mutate('services', function (d) { var i = d.items.map(function (x) { return x.id; }).indexOf(w.id); if (i >= 0) d.items[i] = w; else d.items.push(w); });
      return null;
    }, { extra: extra });
  }

  /* ---------- catégorie → établissements → photos : UNE seule interface contextuelle ---------- */
  var norm = function (s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  function placeEditor(w, onChange, onRemove, siblings) {
    var name = inputText(w.title, 80, 'Nom de l’établissement'); name.oninput = function () { w.title = name.value; onChange(); };
    var desc = h('textarea', { maxlength: '500', 'aria-label': 'Description' }); desc.value = w.description; desc.oninput = function () { w.description = desc.value; };
    var vis = h('input', { type: 'checkbox' }); vis.checked = w.active; vis.onchange = function () { w.active = vis.checked; onChange(); };
    var grid = h('div', { class: 'vgrid' }); var counter = h('span', { class: 'vhint' }); var msg = h('p', { class: 'vhint' });
    var add = h('input', { type: 'file', accept: IMG.join(','), multiple: true, 'aria-label': 'Ajouter des photos' });
    var rep = h('input', { type: 'file', accept: IMG.join(','), hidden: true, 'aria-label': 'Remplacer la photo' }); var repIdx = -1;
    function photos() {
      grid.textContent = '';
      w.photos.forEach(function (pid, k) {
        var isMain = w.mainPhoto === pid;
        grid.appendChild(h('div', { class: 'vth' + (isMain ? ' main' : '') }, [h('img', { src: assetUrl(pid), alt: 'Photo ' + (k + 1) + (isMain ? ' (principale)' : '') }), h('div', { class: 'vb' }, [
          h('button', { type: 'button', text: isMain ? '★' : '☆', title: 'Photo principale', 'aria-label': 'Photo principale', onclick: function () { w.mainPhoto = pid; photos(); } }),
          h('button', { type: 'button', text: '←', 'aria-label': 'Reculer', onclick: function () { if (k > 0) { var t = w.photos[k - 1]; w.photos[k - 1] = pid; w.photos[k] = t; photos(); } } }),
          h('button', { type: 'button', text: '→', 'aria-label': 'Avancer', onclick: function () { if (k < w.photos.length - 1) { var t = w.photos[k + 1]; w.photos[k + 1] = pid; w.photos[k] = t; photos(); } } }),
          h('button', { type: 'button', text: '↻', title: 'Remplacer cette photo', 'aria-label': 'Remplacer cette photo', onclick: function () { repIdx = k; rep.click(); } }),
          h('button', { type: 'button', text: '✕', 'aria-label': 'Retirer la photo', onclick: function () { w.photos.splice(k, 1); if (w.mainPhoto === pid) w.mainPhoto = w.photos[0] || null; photos(); } })])]));
      });
      counter.textContent = w.photos.length + ' / 10 photos'; add.disabled = w.photos.length >= 10;
    }
    add.onchange = function () {
      var files = Array.prototype.slice.call(add.files || []); add.value = ''; var room = 10 - w.photos.length;
      if (files.length > room) { msg.textContent = 'Maximum 10 photos : ' + (room > 0 ? room + ' envoi(s) possible(s).' : 'limite atteinte.'); files = files.slice(0, Math.max(room, 0)); } else msg.textContent = '';
      files.reduce(function (p, f) { return p.then(function () { return upload(f, IMG).then(function (j) { if (w.photos.indexOf(j.assetId) < 0) w.photos.push(j.assetId); if (!w.mainPhoto) w.mainPhoto = j.assetId; photos(); }); }); }, Promise.resolve()).catch(function (e) { msg.textContent = e.message; });
    };
    rep.onchange = function () {
      var f = rep.files && rep.files[0]; rep.value = ''; if (!f || repIdx < 0) return; var k = repIdx;
      upload(f, IMG).then(function (j) { var old = w.photos[k]; if (w.photos.indexOf(j.assetId) >= 0) { msg.textContent = 'Cette photo est déjà dans la galerie.'; return; } w.photos[k] = j.assetId; if (w.mainPhoto === old) w.mainPhoto = j.assetId; msg.textContent = ''; photos(); }).catch(function (e) { msg.textContent = e.message; });
    };
    photos();
    var del = armed(btn('Supprimer cet établissement', 'sm danger'), 'Supprimer cet établissement', onRemove);
    return h('div', null, [].concat(field('Nom de l’établissement', name), field('Description (facultatif)', desc), [h('label', { class: 'chk' }, [vis, 'Visible sur le site']),
      h('label', { text: 'Galerie (10 photos maximum ; ★ = photo principale affichée sur la carte ; ↻ = remplacer)' }), add, rep, counter, msg, grid, h('div', { class: 'vrow tight' }, [del])]));
  }

  function editCategory(anchor, id, opts) {
    opts = opts || {};
    var ct = cur('categories'), pl = cur('places');
    var idx = id ? ct.items.map(function (x) { return x.id; }).indexOf(id) : -1;
    var isNew = idx < 0;
    var w = isNew ? { id: null, label: '', subtitle: '', icon: 'i-other', active: true } : clone(ct.items[idx]);
    w.subtitle = w.subtitle || '';
    var wp = isNew ? [] : pl.items.filter(function (p) { return p.category === w.id; }).map(clone);
    var open = {}; if (opts.open && opts.open !== 'new') open[opts.open] = true;
    var L = lib().LIBRARY;
    /* — champs de la catégorie : même structure que l'ancienne configuration « Domaines d’intervention » — */
    var vis = h('input', { type: 'checkbox', 'aria-label': 'Afficher la catégorie' }); vis.checked = w.active; vis.onchange = function () { w.active = vis.checked; };
    var ic = iconSelect(w.icon); ic.onchange = function () { w.icon = ic.value; };
    var name = inputText(w.label, 60, 'Titre de la catégorie'); name.oninput = function () { w.label = name.value; };
    var sub = inputText(w.subtitle, 60, 'Sous-titre'); sub.oninput = function () { w.subtitle = sub.value; };
    var model = h('select', { 'aria-label': 'Catégorie correspondante' });
    model.appendChild(h('option', { value: '', text: '— Catégorie personnalisée —' }));
    L.forEach(function (l) { var op = h('option', { value: l[0], text: l[1] }); if (!isNew && l[0] === w.id) op.selected = true; model.appendChild(op); });
    model.onchange = function () {
      var l = L.filter(function (x) { return x[0] === model.value; })[0]; if (!l) return;
      var ex = ct.items.filter(function (x) { return x.id === l[0]; })[0];
      if (isNew && ex) { if (ex.active) { err('« ' + ex.label + ' » est déjà affichée.'); model.value = ''; return; } w.id = ex.id; w.subtitle = ex.subtitle || ''; wp = pl.items.filter(function (p) { return p.category === ex.id; }).map(clone); drawPlaces(); sub.value = w.subtitle; }
      w.label = l[1]; w.icon = l[2]; name.value = w.label; ic.value = w.icon;
    };
    function err(m) { if (pop) { pop.err.textContent = m; pop.err.hidden = false; } }
    var pos = h('span', { class: 'vhint' });
    function moveCat(d) {   /* position parmi les catégories visibles */
      var items = cur('categories').items; var i = items.map(function (x) { return x.id; }).indexOf(w.id); if (i < 0) return;
      var j = i + d; while (j >= 0 && j < items.length && !items[j].active) j += d; if (j < 0 || j >= items.length) return;
      mutate('categories', function (c) { var t = c.items[i]; c.items[i] = c.items[j]; c.items[j] = t; }); paintPos();
    }
    function paintPos() { var act = cur('categories').items.filter(function (x) { return x.active; }); var n = act.map(function (x) { return x.id; }).indexOf(w.id); pos.textContent = isNew ? 'Ajoutée en dernière position.' : (n >= 0 ? 'Position ' + (n + 1) + ' / ' + act.length : 'Masquée'); }
    paintPos();
    var head = h('div', null, [
      h('div', { class: 'vrow', style: 'margin-top:0' }, [h('label', { class: 'chk', style: 'margin:0' }, [vis, 'Visible']), svgIcon(w.icon)].concat(isNew ? [] : [btn('←', 'sm', function () { moveCat(-1); }, { 'aria-label': 'Monter la catégorie' }), btn('→', 'sm', function () { moveCat(1); }, { 'aria-label': 'Descendre la catégorie' }), pos])),
      h('div', { class: 'vcols' }, [h('div', null, field('Titre', name)), h('div', null, field('Sous-titre (facultatif)', sub))]),
      h('div', { class: 'vcols' }, [h('div', null, field('Icône', ic)), h('div', null, field('Catégorie correspondante (liste existante)', model))])]);
    /* — établissements associés — */
    var list = h('div'); var count = h('h4', { style: 'margin:0' });
    function drawPlaces() {
      list.textContent = ''; count.textContent = 'Établissements de cette catégorie (' + wp.length + ')';
      wp.forEach(function (p) {
        var body = h('div', { hidden: !open[p.id] });
        var title = h('strong', { text: p.title || 'Nouvel établissement' });
        var tog = btn(open[p.id] ? 'Réduire' : 'Modifier', 'sm', function () { open[p.id] = !open[p.id]; body.hidden = !open[p.id]; tog.textContent = open[p.id] ? 'Réduire' : 'Modifier'; });
        body.appendChild(placeEditor(p, function () { title.textContent = p.title || 'Nouvel établissement'; }, function () { wp = wp.filter(function (x) { return x !== p; }); drawPlaces(); }));
        list.appendChild(h('div', { class: 'vplace', 'data-pid': p.id }, [h('div', { class: 'vhead' }, [title, p.active ? null : h('span', { class: 'vhint', text: 'masqué' }), tog]), body]));
      });
      if (!wp.length) list.appendChild(h('p', { class: 'vhint', text: 'Aucun établissement. Ajoutez-en un ci-dessous.' }));
    }
    var addP = btn(wp.length ? 'AJOUTER UN AUTRE ÉTABLISSEMENT' : 'AJOUTER UN ÉTABLISSEMENT', 'go sm', function () {
      var np = { id: uid('lieu-'), category: w.id || '', title: '', description: '', photos: [], mainPhoto: null, active: true }; open[np.id] = true; wp.push(np); drawPlaces();
      var last = list.lastChild; if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      addP.textContent = 'AJOUTER UN AUTRE ÉTABLISSEMENT';
    });
    if (opts.open === 'new') { var np0 = { id: uid('lieu-'), category: w.id || '', title: '', description: '', photos: [], mainPhoto: null, active: true }; open[np0.id] = true; wp.push(np0); addP.textContent = 'AJOUTER UN AUTRE ÉTABLISSEMENT'; }
    drawPlaces();
    var body = h('div', null, [head, h('div', { class: 'vsec' }, [count, list, h('div', { class: 'vrow' }, [addP])])]);
    var hasPlaces = !isNew && cur('places').items.some(function (p) { return p.category === w.id; });
    var custom = !isNew && !L.some(function (l) { return l[0] === w.id; });
    var extra = (custom && !hasPlaces) ? [armed(btn('Supprimer la catégorie', 'sm danger'), 'Supprimer la catégorie', function () { mutate('categories', function (d) { d.items = d.items.filter(function (x) { return x.id !== id; }); }); closePop(true); })] : [];
    openPop(anchor, isNew ? 'Nouvelle catégorie' : 'Catégorie : ' + w.label, body, function () {
      w.label = w.label.trim(); w.subtitle = w.subtitle.trim();
      if (!w.label) return 'Le titre de la catégorie est obligatoire.';
      var cats = cur('categories');
      if (isNew && !w.id) { var base = slug(w.label); var nid = base; while (cats.items.some(function (x) { return x.id === nid; })) nid = base.slice(0, 18) + '-' + Math.random().toString(36).slice(2, 5); w.id = nid; }
      if (cats.items.some(function (x) { return x.id !== w.id && norm(x.label) === norm(w.label) && x.active; })) return 'Une catégorie « ' + w.label + ' » existe déjà.';
      var names = {};
      for (var i = 0; i < wp.length; i++) {
        var p = wp[i], t = p.title.trim(); if (!t) return 'Un établissement n’a pas de nom : renseignez-le ou supprimez-le.';
        if (names[norm(t)]) return '« ' + t + ' » existe déjà dans cette catégorie.'; names[norm(t)] = 1;
        if (p.photos.length && !p.mainPhoto) return '« ' + t + ' » : choisissez une photo principale (★).';
        p.title = t; p.description = (p.description || '').trim(); p.category = w.id;
      }
      mutate('categories', function (d) {
        var k = d.items.map(function (x) { return x.id; }).indexOf(w.id);
        var out = { id: w.id, label: w.label, subtitle: w.subtitle, icon: w.icon, active: w.active };
        if (k >= 0) d.items[k] = out; else d.items.push(out);
        if (!d.items.some(function (x) { return x.active; })) d.items[k >= 0 ? k : d.items.length - 1].active = true;
      });
      mutate('places', function (d) {
        var ids = wp.reduce(function (m, p) { m[p.id] = p; return m; }, {}); var seen = {};
        d.items = d.items.reduce(function (acc, p) { if (p.category !== w.id) acc.push(p); else if (ids[p.id]) { acc.push(ids[p.id]); seen[p.id] = 1; } return acc; }, []);
        wp.forEach(function (p) { if (!seen[p.id]) d.items.push(p); });
      });
      return null;
    }, { extra: extra, wide: true, noFocus: !!opts.open });
    if (opts.open && pop) { var tgt = $('[data-pid="' + opts.open + '"]', pop.node) || $('[data-pid]:last-of-type', pop.node); if (tgt) tgt.scrollIntoView({ block: 'nearest' }); }
  }
  function chooseCategory(anchor) {   /* « + Ajouter un établissement » dans la galerie : on choisit d'abord la catégorie */
    var cats = cur('categories').items.filter(function (c) { return c.active; });
    var list = h('ul', { class: 'vlist' });
    cats.forEach(function (c) { list.appendChild(h('li', null, [svgIcon(c.icon), h('span', { text: c.label }), btn('Choisir', 'sm', function () { closePop(true); editCategory($('.dom[data-cat="' + c.id + '"]') || anchor, c.id, { open: 'new' }); })])); });
    openPop(anchor, 'Dans quelle catégorie ?', h('div', null, [h('p', { class: 'vhint', text: 'Les établissements sont toujours rattachés à une catégorie.' }), list]), function () { return null; }, { okLabel: 'Fermer', noFocus: true });
  }
  function sampleNotice(el) {
    var pl = cur('places'); var hide = !!pl.hideBuiltin;
    var vis = h('input', { type: 'checkbox' }); vis.checked = hide;
    openPop(el, 'Photo d’exemple intégrée', h('div', null, [h('p', { class: 'vhint', text: 'Cette photo vient du site d’origine. Ajoutez vos établissements avec « + Ajouter un établissement » ; rien n’est supprimé sans votre accord.' }),
      h('label', { class: 'chk' }, [vis, 'Masquer toutes les photos d’exemple intégrées'])]), function () { mutate('places', function (d) { d.hideBuiltin = vis.checked; }); return null; }, { noFocus: true });
  }

  /* ---------- contact (bloc contact et pied de page, une seule source) ---------- */
  var CF = { company: ['Nom de l’entreprise', 80], address: ['Adresse', 120], postalCode: ['Code postal', 12], city: ['Ville', 80], country: ['Pays', 60], phone: ['Téléphone', 30], email: ['E-mail', 120], siren: ['SIREN', 20] };
  function contactKind(li) {
    if (li.id === 'ft-phone') return 'phone'; if (li.id === 'ft-mail') return 'email';
    var u = $('use', li); var href = u ? u.getAttribute('href') : '';
    if (href === '#i-doc' || /^SIREN/.test(li.textContent.trim())) return 'siren'; if (href === '#i-phone') return 'phone'; if (href === '#i-mail') return 'email';
    return 'address';
  }
  function editContact(li) {
    var kind = contactKind(li); var fields = kind === 'address' ? ['company', 'address', 'postalCode', 'city', 'country'] : [kind];
    var w = cur('contact'); var inputs = {}; var kids = [];
    fields.forEach(function (f) { var i = h('input', { type: f === 'email' ? 'email' : 'text', maxlength: String(CF[f][1]), value: w[f] || '', 'aria-label': CF[f][0] }); inputs[f] = i; kids = kids.concat(field(CF[f][0], i)); });
    kids.push(h('p', { class: 'vhint', text: 'Mis à jour dans la section Contact et dans le pied de page.' }));
    openPop(li, 'Contact', h('div', null, kids), function () {
      var v = Object.assign({}, w); fields.forEach(function (f) { v[f] = inputs[f].value.trim(); });
      if (!v.company) return 'Le nom de l’entreprise est obligatoire.';
      if (v.email && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(v.email)) return 'Adresse e-mail invalide.';
      if (v.phone && !/^[+\d][\d\s().-]{6,}$/.test(v.phone)) return 'Numéro de téléphone invalide.';
      if (v.siren && !/^\d{3}\s?\d{3}\s?\d{3}$/.test(v.siren)) return 'Le SIREN comporte 9 chiffres.';
      mutate('contact', function (d) { Object.assign(d, v); }); return null;
    });
  }

  /* ---------- clic direct sur les éléments du site ---------- */
  function onClick(e) {
    if (!active) return;
    var t = e.target; if (!t.closest) return;
    if (t.closest('#vdock,.vpop,.vbar,.vmini,#adm,#adminKey,#toast,.lb')) return;
    if (t.closest('[contenteditable="true"]')) return;
    var a = t.closest('[data-act]');
    var go = null;
    if (a) { var act = a.dataset.act; go = function () { if (act === 'add-service') editService(a, true); else if (act === 'add-cat') editCategory(a, null); else if (act === 'add-place') chooseCategory(a); }; }
    else if (t.closest('.card')) { var c = t.closest('.card'); go = function () { var id = c.dataset.id; var p = cur('places').items.filter(function (x) { return x.id === id; })[0]; if (p) editCategory(c, p.category, { open: id }); else sampleNotice(c); }; }
    else if (t.closest('.dom')) { var d = t.closest('.dom'); go = function () { editCategory(d, d.dataset.cat); }; }
    else if (t.closest('.q')) { var q = t.closest('.q'); go = function () { editService(q, false); }; }
    else if (t.closest('.site-header .brand')) { var lm = $('.site-header .brand img'); go = function () { editLogo('main', lm); }; }
    else if (t.closest('.foot-logo')) { var lf = t.closest('.foot-logo'); go = function () { editLogo('footer', lf); }; }
    else if (t.closest('.about-box .badge')) { var la = t.closest('.about-box .badge'); go = function () { editLogo('about', la); }; }
    else if (t.closest('#accueil')) { var ha = $('#accueil'); if (pop && pop.anchor === ha) return; go = function () { editBanner(ha); }; }
    else {
      var li = t.closest('.contact-list li') || (function () { var f = $('#f-contact'); var l = t.closest('li'); return (f && f.parentNode && l && f.parentNode.contains(l)) ? l : null; })();
      if (li) go = function () { editContact(li); };
      else { var ts = textSpec(t); if (ts) go = function () { startText(ts.el, ts.spec); }; }
    }
    if (!go) return;
    e.preventDefault(); e.stopPropagation();
    if (pop) closePop(false);  /* une seule fenêtre à la fois : en ouvrir une autre annule la précédente (rien n'est perdu côté site : seul le brouillon validé compte) */
    go();
  }
  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape' && pop && !e.defaultPrevented) { cancelPop(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.classList && e.target.classList.contains('vadd')) { e.preventDefault(); e.target.click(); }
  }

  /* ---------- barre Publier / Annuler ---------- */
  function paintBar(state) {
    if (!bar) return; bar.textContent = '';
    var n = dirtyList().length; bar.classList.toggle('dirty', n > 0);
    if (state && state.confirm) {
      bar.appendChild(h('span', { class: 'vmsg', text: 'Publier ' + n + ' section(s) sur le site public ? (' + dirtyList().map(function (s) { return LABELS[s]; }).join(', ') + ')' }));
      bar.appendChild(btn('Oui, publier', 'go sm', publish)); bar.appendChild(btn('Non', 'sm', function () { paintBar(); }));
      return;
    }
    if (state && state.error) bar.appendChild(h('span', { class: 'verr', text: state.error }));
    bar.appendChild(h('span', { class: 'vmsg', text: n ? '● ' + n + ' section(s) modifiée(s), non publiée(s) : aperçu seulement' : '✓ Rien à publier' }));
    var pub = btn('Publier', 'go sm', function () { commitText(); closePop(); paintBar({ confirm: true }); }); pub.disabled = !n;
    var can = btn('Annuler', 'sm', discard); can.disabled = !n;
    bar.appendChild(pub); bar.appendChild(can); bar.appendChild(btn('Rétablir…', 'sm', restoreMenu));
  }
  function discard() { commitText(true); closePop(); D = {}; location.reload(); }   /* retour exact à la dernière version publiée */
  function publish() {
    var list = dirtyList(); bar.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    (function next(i) {
      if (i >= list.length) { D = {}; refresh(); o.toast('Modifications publiées.'); return; }
      var sec = list[i];
      req('PUT', '/api/admin/site/content/' + sec, { value: D[sec], expectedVersion: C.versions[sec] || 0 }).then(function (j) {
        if (j.ok) { C.content[sec] = j.value; C.versions[sec] = j.version; delete D[sec]; next(i + 1); return; }
        var m = j.status_code === 409 ? 'Contenu modifié ailleurs : rechargez la page (vos changements non publiés seront perdus).' : (j.status_code === 429 ? 'Trop de demandes : réessayez dans quelques minutes.' : ((j.message || 'Échec de la publication.') + (j.field ? ' (' + j.field + ')' : '')));
        refresh(); paintBar({ error: LABELS[sec] + ' : ' + m });
      }).catch(function () { paintBar({ error: 'Impossible de joindre le serveur. Vos modifications restent en brouillon.' }); });
    })(0);
  }
  function restoreMenu() {
    commitText(true);
    var published = Object.keys(C.content).filter(function (s) { return s !== 'palette' && C.content[s]; });
    var list = h('ul', { class: 'vlist' });
    published.forEach(function (s) {
      var b = btn('Rétablir', 'sm danger'); armed(b, 'Rétablir', function () {
        req('DELETE', '/api/admin/site/content/' + s, {}).then(function (j) { if (j.ok) { o.toast('Contenu d’origine rétabli.'); setTimeout(function () { location.reload(); }, 700); } else o.toast(j.message || 'Échec du rétablissement.'); });
      });
      list.appendChild(h('li', null, [h('span', { text: LABELS[s] || s }), b]));
    });
    if (!published.length) list.appendChild(h('li', null, [h('span', { class: 'vhint', text: 'Aucun contenu personnalisé publié.' })]));
    openPop(bar, 'Rétablir le contenu d’origine', h('div', null, [h('p', { class: 'vhint', text: 'Supprime votre version publiée d’une section : le site retrouve son contenu d’origine.' }), list]), function () { return null; }, { okLabel: 'Fermer', noFocus: true });
    pop.node.style.position = 'fixed'; pop.node.style.top = 'auto'; pop.node.style.bottom = '110px';
  }

  /* ---------- cycle de vie ---------- */
  function beforeUnload(e) { if (dirtyList().length) { e.preventDefault(); e.returnValue = ''; } }
  function start(ctx) {
    o = ctx; active = true;
    if (!document.getElementById('vInlineStyle')) document.head.appendChild(h('style', { id: 'vInlineStyle', text: CSS }));
    var ready = function () {
      req('GET', '/api/admin/site/content').then(function (j) {
        if (!active) return;
        if (j.ok) { C.content = j.content || {}; C.versions = j.versions || {}; }
        if (!bar) { bar = h('div', { class: 'vbar', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(bar); }
        bar.hidden = false;
        if (!started) { document.addEventListener('click', onClick, true); document.addEventListener('keydown', onKey); window.addEventListener('beforeunload', beforeUnload); started = true; }
        if (Object.keys(D).length) refresh(); else { decorate(); paintBar(); }
        var g = $('#vGear'); if (g && !g.__v) { g.__v = 1; }
      }).catch(function () { o.toast('Contenu admin indisponible.'); });
    };
    if (window.VectisAdmin && window.VectisAdmin.data) ready();
    else { var sc = document.createElement('script'); sc.src = '/admin-panel.js?v=20261109'; sc.onload = ready; sc.onerror = function () { o.toast('L’éditeur n’a pas pu être chargé.'); }; document.head.appendChild(sc); }
  }
  function stop() { /* « Minimiser » : on masque les commandes ; le brouillon éventuel reste en mémoire et visible en aperçu */
    commitText(true); closePop(); active = false;
    $$('.vadd,.vghost').forEach(function (e) { e.remove(); }); $$('.vedit-on').forEach(function (e) { e.classList.remove('vedit-on'); });
    if (bar) bar.hidden = true;
    if (!dirtyList().length) { var q = $('.quality'); if (q && !q.children.length) q.hidden = true; }
  }
  window.VectisInline = { start: start, stop: stop, dirty: function () { return dirtyList().length > 0; } };
})();
