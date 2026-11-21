/* VECTIS — tableau de bord STATISTIQUES (administration).
   Chargé uniquement après une connexion administrateur réussie ET si l'API répond à /api/admin/stats/status.
   Toute donnée affichée est insérée avec textContent : jamais innerHTML. Graphiques en SVG, sans bibliothèque externe. */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var NF = new Intl.NumberFormat('fr-FR');
  var NF1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  var DEVICE_LABEL = { mobile: 'Mobile', desktop: 'Ordinateur', tablet: 'Tablette' };
  var RANGES = [['today', 'Aujourd’hui'], ['7d', '7 jours'], ['30d', '30 jours'], ['90d', '90 jours'], ['custom', 'Personnalisé']];

  var CSS = [
    '.vst{position:fixed;inset:0;z-index:88;background:rgba(0,0,0,.86);overflow:auto;-webkit-overflow-scrolling:touch}',
    '.vst[hidden]{display:none}',
    '.vst-card{position:relative;max-width:1180px;margin:0 auto;min-height:100%;background:linear-gradient(180deg,#14130f,#070706);border-left:1px solid var(--line-soft);border-right:1px solid var(--line-soft);padding:0 max(16px,env(safe-area-inset-right,0px)) calc(28px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));color:var(--text)}',
    '.vst-head{position:sticky;top:0;z-index:3;display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:calc(14px + env(safe-area-inset-top,0px)) 0 12px;background:linear-gradient(180deg,#14130f 78%,rgba(20,19,15,0));border-bottom:1px solid var(--line-soft)}',
    '.vst-head h2{margin:0;font-size:20px;display:flex;align-items:center;gap:9px}',
    '.vst-head h2 svg{width:22px;height:22px;color:var(--gold-hi)}',
    '.vst-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--gold);color:var(--gold-hi);border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}',
    '.vst-badge::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--gold-hi)}',
    '.vst-close{margin-left:auto;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:transparent;color:var(--text);font:inherit;font-size:18px;cursor:pointer;display:grid;place-items:center}',
    '.vst-close:hover,.vst-close:focus-visible{border-color:var(--gold-hi);color:var(--gold-hi)}',
    '.vst-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:14px 0 4px}',
    '.vst-chip{min-height:34px;padding:5px 13px;border-radius:99px;border:1px solid var(--line);background:transparent;color:var(--text);font:inherit;font-size:13px;cursor:pointer}',
    '.vst-chip:hover,.vst-chip:focus-visible{border-color:var(--gold-hi);color:var(--gold-hi)}',
    '.vst-chip[aria-pressed="true"]{background:var(--gold);border-color:var(--gold);color:#16120a;font-weight:700}',
    '.vst-custom{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;color:var(--muted)}',
    '.vst-custom[hidden]{display:none}',
    '.vst-custom input{min-height:34px;border-radius:9px;border:1px solid var(--line);background:#0b0a08;color:var(--text);font:inherit;padding:3px 8px;color-scheme:dark}',
    '.vst-cmp{display:inline-flex;align-items:center;gap:7px;margin-left:auto;font-size:13px;color:var(--muted);cursor:pointer}',
    '.vst-cmp input{accent-color:var(--gold)}',
    '.vst-sub{margin:4px 0 0;font-size:12.5px;color:var(--muted)}',
    '.vst-grid{display:grid;gap:14px;margin-top:16px}',
    '.vst-kpis{grid-template-columns:repeat(auto-fit,minmax(168px,1fr))}',
    '.vst-two{grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)}',
    '.vst-even{grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}',
    '@media(max-width:820px){.vst-two{grid-template-columns:minmax(0,1fr)}}',
    '.vst-box{border:1px solid var(--line-soft);border-radius:14px;background:rgba(255,255,255,.02);padding:14px 14px 12px;min-width:0}',
    '.vst-box h3{margin:0 0 2px;font-size:14px;color:var(--gold-hi);letter-spacing:.02em}',
    '.vst-box .vst-note{margin:0 0 8px;font-size:12px;color:var(--muted)}',
    '.vst-kpi .v{font-size:28px;font-weight:700;line-height:1.15;margin-top:6px;font-variant-numeric:tabular-nums}',
    '.vst-kpi .l{font-size:12.5px;color:var(--muted)}',
    '.vst-kpi .d{display:inline-block;margin-top:4px;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}',
    '.vst-up{color:#59d36a}.vst-down{color:#ff8a7a}.vst-flat{color:var(--muted)}',
    '.vst svg{display:block;width:100%;height:auto;overflow:visible}',
    '.vst .ax{stroke:rgba(247,243,234,.12);stroke-width:1}',
    '.vst .tx{fill:var(--muted);font-size:11px}',
    '.vst-leg{display:flex;flex-wrap:wrap;gap:6px 14px;margin:2px 0 6px;font-size:12.5px;color:var(--muted)}',
    '.vst-leg button{display:inline-flex;align-items:center;gap:6px;border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:2px 0}',
    '.vst-leg button[aria-pressed="false"]{opacity:.45;text-decoration:line-through}',
    '.vst-sw{width:18px;height:0;border-top:3px solid currentColor;display:inline-block}',
    '.vst-sw.dash{border-top-style:dashed}',
    '.vst-sq{width:11px;height:11px;border-radius:3px;display:inline-block}',
    '.vst-tip{position:absolute;z-index:5;pointer-events:none;background:#0b0a08;border:1px solid var(--gold);border-radius:9px;padding:7px 10px;font-size:12px;line-height:1.45;box-shadow:0 6px 20px rgba(0,0,0,.6);white-space:nowrap}',
    '.vst-wrap{position:relative}',
    '.vst-donut{display:flex;flex-wrap:wrap;align-items:center;gap:14px}.vst-donut svg{width:150px;flex:0 0 150px}',
    '.vst-dl{flex:1;min-width:150px;display:grid;gap:7px;font-size:13px}',
    '.vst-dl div{display:flex;align-items:center;gap:8px}.vst-dl b{margin-left:auto;font-variant-numeric:tabular-nums}',
    '.vst-rows{display:grid;gap:9px;margin-top:6px}',
    '.vst-row{display:grid;grid-template-columns:minmax(96px,34%) 1fr auto;align-items:center;gap:9px;font-size:13px}',
    '.vst-row .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.vst-track{height:12px;border-radius:7px;background:rgba(247,243,234,.07);overflow:hidden}',
    '.vst-fill{height:100%;border-radius:7px;background:var(--gold-grad,linear-gradient(90deg,#e0aa27,#f6d36a))}',
    '.vst-fill.g{background:linear-gradient(90deg,#3a9d4d,#59d36a)}',
    '.vst-row .n{font-variant-numeric:tabular-nums;font-weight:600;text-align:right;min-width:42px}',
    '.vst-row small{color:var(--muted);font-weight:400;margin-left:6px}',
    '.vst-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:6px}',
    '.vst-tile{border:1px solid var(--line-soft);border-radius:12px;padding:10px 12px}',
    '.vst-tile .v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.vst-tile .l{font-size:12px;color:var(--muted)}',
    '.vst-fun{display:grid;gap:10px;margin-top:6px}',
    '.vst-fun .r{display:grid;grid-template-columns:28px minmax(0,1fr);gap:10px;align-items:center}',
    '.vst-fun .i{width:28px;height:28px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;font-size:12px;color:var(--gold-hi)}',
    '.vst-fun .t{display:flex;flex-wrap:wrap;gap:2px 10px;justify-content:space-between;font-size:13px;margin-bottom:4px}',
    '.vst-fun .t b{font-variant-numeric:tabular-nums}.vst-fun .t span{color:var(--muted);font-size:12px}',
    '.vst-nm{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:8px;font-size:12.5px;color:var(--muted)}',
    '.vst-nm b{color:var(--text);display:block;font-weight:600}',
    '.vst-sim{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px}',
    '.vst-sim label{display:grid;gap:3px;font-size:12px;color:var(--muted)}',
    '.vst-sim select,.vst-sim input{min-height:36px;border-radius:9px;border:1px solid var(--line);background:#0b0a08;color:var(--text);font:inherit;padding:3px 8px;color-scheme:dark;min-width:0}',
    '.vst-sim input{width:74px}',
    '.vst-btn{min-height:36px;padding:5px 15px;border-radius:99px;border:1px solid var(--gold);background:var(--gold);color:#16120a;font:inherit;font-weight:700;cursor:pointer}',
    '.vst-btn.sec{background:transparent;color:var(--text);border-color:var(--line);font-weight:500}',
    '.vst-btn:disabled{opacity:.55;cursor:default}',
    '.vst-msg{margin:12px 0 0;padding:10px 12px;border-radius:10px;border:1px solid var(--line);font-size:13px}',
    '.vst-msg.err{border-color:#ff8a7a;color:#ffb3a8}',
    '.vst-foot{margin:18px 0 0;font-size:12px;color:var(--muted)}',
    '.vst-off{margin:0 0 14px;padding:10px 14px;border:1px solid var(--gold);border-radius:10px;color:var(--gold-hi);font-size:13px;line-height:1.5}',
    '.vst-empty{padding:18px 4px;color:var(--muted);font-size:13px}',
    '@media(max-width:520px){.vst-head{padding-right:46px}.vst-close{position:absolute;right:0;top:calc(12px + env(safe-area-inset-top,0px))}.vst-row{grid-template-columns:minmax(80px,38%) 1fr auto}.vst-kpi .v{font-size:24px}.vst-cmp{margin-left:0}}'
  ].join('\n');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sv(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function fmtDay(d, long) {
    var dt = new Date(d + 'T00:00:00Z');
    return dt.toLocaleDateString('fr-FR', long ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  }
  function niceMax(v) {
    if (v <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  /* ----- state ----- */
  var S = { ctx: null, root: null, range: '30d', from: '', to: '', compare: true, series: { visitors: true, sessions: true }, data: null, busy: false, tip: null, opener: null };

  function ensureStyle() {
    if (document.getElementById('vstStyle')) return;
    var st = document.createElement('style');
    st.id = 'vstStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function request(method, url, body) {
    var h = { Accept: 'application/json' };
    if (method !== 'GET') { h['Content-Type'] = 'application/json'; h['X-CSRF-Token'] = S.ctx.csrf() || ''; }
    return fetch(url, { method: method, credentials: 'same-origin', headers: h, body: method === 'GET' ? undefined : JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status_code = r.status; return j; }); });
  }

  /* ----- charts ----- */
  function showTip(wrap, x, y, lines) {
    hideTip();
    var t = el('div', 'vst-tip');
    lines.forEach(function (l, i) { var d = el('div', null, l); if (i === 0) d.style.fontWeight = '700'; t.appendChild(d); });
    wrap.appendChild(t);
    var w = wrap.clientWidth;
    var left = Math.min(Math.max(4, x + 12), Math.max(4, w - t.offsetWidth - 4));
    t.style.left = left + 'px';
    t.style.top = Math.max(0, y - t.offsetHeight - 10) + 'px';
    S.tip = t;
  }
  function hideTip() { if (S.tip && S.tip.parentNode) S.tip.parentNode.removeChild(S.tip); S.tip = null; }

  function frame(W, H, pad, maxV, days) {
    var g = sv('g', {});
    var x0 = pad.l, x1 = W - pad.r, y0 = H - pad.b, y1 = pad.t;
    for (var i = 0; i <= 4; i++) {
      var y = y0 - ((y0 - y1) * i) / 4;
      g.appendChild(sv('line', { x1: x0, x2: x1, y1: y, y2: y, class: 'ax' }));
      var t = sv('text', { x: x0 - 6, y: y + 4, 'text-anchor': 'end', class: 'tx' });
      t.textContent = NF.format(Math.round((maxV * i) / 4));
      g.appendChild(t);
    }
    var n = days.length, ticks = Math.min(6, n);
    for (var k = 0; k < ticks; k++) {
      var idx = ticks === 1 ? 0 : Math.round((k * (n - 1)) / (ticks - 1));
      var x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * idx) / (n - 1);
      var tx = sv('text', { x: x, y: H - 6, 'text-anchor': k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle', class: 'tx' });
      tx.textContent = fmtDay(days[idx]);
      g.appendChild(tx);
    }
    return g;
  }

  function lineChart(box, d) {
    var W = 640, H = 250, pad = { l: 40, r: 10, t: 10, b: 24 };
    var days = d.daily.map(function (x) { return x.day; });
    var defs = [
      { key: 'visitors', label: 'Visiteurs', color: '#f6d36a', dash: false },
      { key: 'sessions', label: 'Sessions', color: '#a8a396', dash: false }
    ];
    var maxV = 1;
    defs.forEach(function (s) {
      if (!S.series[s.key]) return;
      d.daily.forEach(function (x) { if (x[s.key] > maxV) maxV = x[s.key]; });
      if (S.compare) d.previousDaily.forEach(function (x) { if (x[s.key] > maxV) maxV = x[s.key]; });
    });
    maxV = niceMax(maxV);
    var wrap = el('div', 'vst-wrap');
    var leg = el('div', 'vst-leg');
    defs.forEach(function (s) {
      var b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', S.series[s.key] ? 'true' : 'false'); b.style.color = s.color;
      var sw = el('span', 'vst-sw'); b.appendChild(sw);
      var tx = el('span', null, s.label); tx.style.color = 'var(--text)'; b.appendChild(tx);
      b.onclick = function () { S.series[s.key] = !S.series[s.key]; if (!S.series.visitors && !S.series.sessions) S.series[s.key] = true; render(); };
      leg.appendChild(b);
    });
    if (S.compare) {
      var c = el('span'); c.style.display = 'inline-flex'; c.style.alignItems = 'center'; c.style.gap = '6px';
      var sw2 = el('span', 'vst-sw dash'); sw2.style.color = '#a8a396'; c.appendChild(sw2); c.appendChild(el('span', null, 'Période précédente'));
      leg.appendChild(c);
    }
    box.appendChild(leg);
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Évolution quotidienne des visiteurs et des sessions sur ' + days.length + ' jours' });
    svg.appendChild(frame(W, H, pad, maxV, days));
    var x0 = pad.l, x1 = W - pad.r, y0 = H - pad.b, y1 = pad.t, n = days.length;
    var X = function (i) { return n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1); };
    var Y = function (v) { return y0 - ((y0 - y1) * v) / maxV; };
    function path(vals) { return vals.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' '); }
    defs.forEach(function (s) {
      if (!S.series[s.key]) return;
      if (S.compare) {
        var pv = d.previousDaily.map(function (x) { return x[s.key]; });
        svg.appendChild(sv('path', { d: path(pv), fill: 'none', stroke: s.color, 'stroke-width': 1.6, 'stroke-dasharray': '4 4', opacity: .55 }));
      }
      var vals = d.daily.map(function (x) { return x[s.key]; });
      if (s.key === 'visitors') {
        svg.appendChild(sv('path', { d: path(vals) + ' L' + X(n - 1).toFixed(1) + ' ' + y0 + ' L' + X(0).toFixed(1) + ' ' + y0 + ' Z', fill: s.color, opacity: .1 }));
      }
      svg.appendChild(sv('path', { d: path(vals), fill: 'none', stroke: s.color, 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      if (n <= 31) vals.forEach(function (v, i) { svg.appendChild(sv('circle', { cx: X(i), cy: Y(v), r: 2.8, fill: s.color })); });
    });
    var guide = sv('line', { y1: y1, y2: y0, stroke: '#f6d36a', 'stroke-width': 1, opacity: 0 });
    svg.appendChild(guide);
    var hit = sv('rect', { x: x0, y: y1, width: x1 - x0, height: y0 - y1, fill: 'transparent' });
    svg.appendChild(hit);
    function move(ev) {
      var r = svg.getBoundingClientRect();
      var px = ((ev.clientX - r.left) / r.width) * W;
      var i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - x0) / (x1 - x0)) * (n - 1))));
      guide.setAttribute('x1', X(i)); guide.setAttribute('x2', X(i)); guide.setAttribute('opacity', .5);
      var row = d.daily[i];
      var lines = [fmtDay(row.day, true), 'Visiteurs : ' + NF.format(row.visitors), 'Sessions : ' + NF.format(row.sessions)];
      if (S.compare && d.previousDaily[i]) lines.push('Précédent : ' + NF.format(d.previousDaily[i].visitors) + ' visiteurs, ' + NF.format(d.previousDaily[i].sessions) + ' sessions');
      var wr = wrap.getBoundingClientRect();
      showTip(wrap, ev.clientX - wr.left, ev.clientY - wr.top, lines);
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', function () { hideTip(); guide.setAttribute('opacity', 0); });
    wrap.appendChild(svg);
    box.appendChild(wrap);
  }

  function quotesChart(box, d) {
    var W = 640, H = 210, pad = { l: 40, r: 10, t: 10, b: 24 };
    var days = d.daily.map(function (x) { return x.day; }), n = days.length;
    var maxV = 1;
    d.daily.forEach(function (x) { if (x.quotes > maxV) maxV = x.quotes; });
    if (S.compare) d.previousDaily.forEach(function (x) { if (x.quotes > maxV) maxV = x.quotes; });
    maxV = niceMax(maxV);
    var leg = el('div', 'vst-leg');
    [['#d9a521', 'Demandes reçues'], ['#59d36a', 'Envoyées par e-mail']].forEach(function (a) {
      var s = el('span'); s.style.display = 'inline-flex'; s.style.alignItems = 'center'; s.style.gap = '6px';
      var q = el('span', 'vst-sq'); q.style.background = a[0]; s.appendChild(q); s.appendChild(el('span', null, a[1])); leg.appendChild(s);
    });
    box.appendChild(leg);
    var wrap = el('div', 'vst-wrap');
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Demandes de devis par jour : ' + NF.format(d.quotes.created) + ' reçues, ' + NF.format(d.quotes.sent) + ' envoyées' });
    svg.appendChild(frame(W, H, pad, maxV, days));
    var x0 = pad.l, x1 = W - pad.r, y0 = H - pad.b, y1 = pad.t;
    var slot = (x1 - x0) / n, bw = Math.max(1.2, Math.min(9, slot * 0.36));   // two bars side by side: received, then sent
    d.daily.forEach(function (x, i) {
      var cx = x0 + slot * (i + 0.5);
      var h1 = ((y0 - y1) * x.quotes) / maxV, h2 = ((y0 - y1) * x.quotesSent) / maxV;
      var r1 = sv('rect', { x: cx - bw - 0.5, y: y0 - h1, width: bw, height: Math.max(0, h1), fill: '#d9a521', rx: 1.5 });
      var r2 = sv('rect', { x: cx + 0.5, y: y0 - h2, width: bw, height: Math.max(0, h2), fill: '#59d36a', rx: 1.5 });
      svg.appendChild(r1); svg.appendChild(r2);
      var hit = sv('rect', { x: cx - slot / 2, y: y1, width: slot, height: y0 - y1, fill: 'transparent' });
      hit.addEventListener('pointermove', function (ev) {
        var wr = wrap.getBoundingClientRect();
        var lines = [fmtDay(x.day, true), 'Reçues : ' + NF.format(x.quotes), 'Envoyées : ' + NF.format(x.quotesSent)];
        if (S.compare && d.previousDaily[i]) lines.push('Période précédente : ' + NF.format(d.previousDaily[i].quotes) + ' reçues');
        showTip(wrap, ev.clientX - wr.left, ev.clientY - wr.top, lines);
      });
      hit.addEventListener('pointerleave', hideTip);
      svg.appendChild(hit);
    });
    wrap.appendChild(svg);
    box.appendChild(wrap);
  }

  function donut(box, d) {
    var total = d.devices.reduce(function (s, x) { return s + x.visitors; }, 0);
    var colors = { mobile: '#f6d36a', desktop: '#d9a521', tablet: '#8a6a1d' };
    var row = el('div', 'vst-donut');
    var svg = sv('svg', { viewBox: '0 0 120 120', role: 'img', 'aria-label': 'Répartition des visiteurs par appareil' });
    var R = 46, C = 2 * Math.PI * R, off = 0;
    svg.appendChild(sv('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: 'rgba(247,243,234,.07)', 'stroke-width': 18 }));
    if (total > 0) d.devices.forEach(function (x) {
      var len = (C * x.visitors) / total;
      if (len <= 0) return;
      svg.appendChild(sv('circle', { cx: 60, cy: 60, r: R, fill: 'none', stroke: colors[x.device], 'stroke-width': 18, 'stroke-dasharray': len.toFixed(2) + ' ' + (C - len).toFixed(2), 'stroke-dashoffset': (-off).toFixed(2), transform: 'rotate(-90 60 60)' }));
      off += len;
    });
    var t = sv('text', { x: 60, y: 58, 'text-anchor': 'middle', fill: '#f7f3ea', 'font-size': 17, 'font-weight': 700 }); t.textContent = NF.format(total); svg.appendChild(t);
    var t2 = sv('text', { x: 60, y: 73, 'text-anchor': 'middle', class: 'tx' }); t2.textContent = 'visiteurs'; svg.appendChild(t2);
    row.appendChild(svg);
    var dl = el('div', 'vst-dl');
    d.devices.forEach(function (x) {
      var r = el('div');
      var q = el('span', 'vst-sq'); q.style.background = colors[x.device]; r.appendChild(q);
      r.appendChild(el('span', null, DEVICE_LABEL[x.device]));
      r.appendChild(el('b', null, (x.sharePct == null ? '—' : NF1.format(x.sharePct) + ' %')));
      dl.appendChild(r);
      var s = el('div'); s.style.cssText = 'margin:-4px 0 0 19px;font-size:12px;color:var(--muted)'; s.appendChild(el('span', null, NF.format(x.visitors) + ' visiteurs · ' + NF.format(x.sessions) + ' sessions'));
      dl.appendChild(s);
    });
    row.appendChild(dl);
    box.appendChild(row);
  }

  function bars(box, rows, max, cls) {
    var wrap = el('div', 'vst-rows');
    rows.forEach(function (r) {
      var line = el('div', 'vst-row');
      var nm = el('span', 'nm', r.label); nm.title = r.label; line.appendChild(nm);
      var tr = el('div', 'vst-track'); var f = el('div', 'vst-fill' + (cls ? ' ' + cls : '')); f.style.width = (max ? Math.max(2, (r.value / max) * 100) : 0) + '%'; tr.appendChild(f); line.appendChild(tr);
      var n = el('span', 'n', NF.format(r.value)); if (r.extra) n.appendChild(el('small', null, r.extra)); line.appendChild(n);
      wrap.appendChild(line);
    });
    box.appendChild(wrap);
  }

  function box(title, note) {
    var b = el('section', 'vst-box');
    b.appendChild(el('h3', null, title));
    if (note) b.appendChild(el('p', 'vst-note', note));
    return b;
  }

  function kpi(label, value, deltaPct, hint) {
    var b = el('div', 'vst-box vst-kpi');
    b.appendChild(el('div', 'l', label));
    b.appendChild(el('div', 'v', value));
    var d = el('span', 'd');
    if (deltaPct === undefined) { d.textContent = hint || ''; d.className = 'd vst-flat'; }
    else if (deltaPct === null) { d.textContent = '— vs période précédente'; d.className = 'd vst-flat'; d.title = 'La période précédente ne contient pas de données.'; }
    else { d.textContent = (deltaPct > 0 ? '▲ +' : deltaPct < 0 ? '▼ ' : '= ') + NF1.format(deltaPct) + ' % vs période précédente'; d.className = 'd ' + (deltaPct > 0 ? 'vst-up' : deltaPct < 0 ? 'vst-down' : 'vst-flat'); }
    b.appendChild(d);
    return b;
  }

  /* ----- page ----- */
  function render() {
    hideTip();
    var card = S.root.querySelector('.vst-body');
    card.textContent = '';
    var d = S.data;
    if (!d) return;
    var r = d.range;

    var sub = el('p', 'vst-sub', 'Du ' + fmtDay(r.from, true) + ' au ' + fmtDay(r.to, true) + ' (' + r.days + ' jour' + (r.days > 1 ? 's' : '') + ') · comparé au ' + fmtDay(d.previous.from) + ' – ' + fmtDay(d.previous.to) + ' · fuseau Europe/Paris');
    card.appendChild(sub);
    if (!d.simulated && d.collectionEnabled === false) {
      var off = el('p', 'vst-off', 'La collecte des visites est désactivée : aucun visiteur n’est mesuré pour le moment. Seuls les devis (table des demandes) apparaissent ci-dessous.');
      off.setAttribute('role', 'status');
      card.appendChild(off);
    }

    var k = el('div', 'vst-grid vst-kpis');
    k.appendChild(kpi('Visiteurs (visiteurs-jours)', NF.format(d.totals.visitors), d.deltas.visitors));
    k.appendChild(kpi('Sessions (visites)', NF.format(d.totals.sessions), d.deltas.sessions));
    k.appendChild(kpi('Événements mesurés', NF.format(d.totals.events), d.deltas.events));
    k.appendChild(kpi('Sessions par visiteur', d.totals.sessionsPerVisitor == null ? '—' : NF1.format(d.totals.sessionsPerVisitor), undefined, 'moyenne de la période'));
    k.appendChild(kpi('Demandes de devis reçues', NF.format(d.quotes.created), d.deltas.quotes));
    k.appendChild(kpi('Taux de conversion', d.conversion.rate == null ? '—' : NF1.format(d.conversion.rate) + ' %', undefined, d.conversion.definition + ' (' + NF.format(d.conversion.numerator) + ' ÷ ' + NF.format(d.conversion.denominator) + ')'));
    card.appendChild(k);

    var g1 = el('div', 'vst-grid vst-two');
    var b1 = box('Visiteurs et sessions par jour', 'Visiteurs = visiteurs-jours : un même visiteur n’est pas reconnu d’un jour à l’autre.');
    lineChart(b1, d);
    g1.appendChild(b1);
    var b2 = box('Appareils', 'Part des visiteurs par type d’appareil.');
    donut(b2, d);
    g1.appendChild(b2);
    card.appendChild(g1);

    var g2 = el('div', 'vst-grid vst-two');
    var b3 = box('Évolution des demandes de devis', 'Source : demandes enregistrées par l’API (serveur), pas de simples clics.');
    quotesChart(b3, d);
    g2.appendChild(b3);
    var b4 = box('Interactions importantes', 'Sessions ayant réalisé l’action (une fois par session).');
    var tiles = el('div', 'vst-tiles');
    [['Galerie ouverte', d.interactions.galleryOpens], ['Formulaire ouvert', d.interactions.formOpens], ['Remplissage commencé', d.interactions.formStarts], ['Clics téléphone', d.interactions.phoneClicks], ['Clics e-mail', d.interactions.emailClicks]].forEach(function (a) {
      var t = el('div', 'vst-tile'); t.appendChild(el('div', 'v', NF.format(a[1]))); t.appendChild(el('div', 'l', a[0])); tiles.appendChild(t);
    });
    b4.appendChild(tiles);
    g2.appendChild(b4);
    card.appendChild(g2);

    var g3 = el('div', 'vst-grid vst-even');
    var b5 = box('Catégories les plus consultées', 'Sessions ayant consulté la catégorie, avec ouvertures de galerie.');
    if (!d.categories.length) b5.appendChild(el('p', 'vst-empty', 'Aucune consultation de catégorie sur cette période.'));
    else {
      var max = d.categories.reduce(function (m, c) { return Math.max(m, c.views); }, 1);
      bars(b5, d.categories.slice(0, 10).map(function (c) { return { label: c.label, value: c.views, extra: c.galleryOpens ? c.galleryOpens + ' gal.' : '' }; }), max);
      if (d.categoriesOthersViews) b5.appendChild(el('p', 'vst-note', 'Autres (catégories inconnues ou supprimées) : ' + NF.format(d.categoriesOthersViews)));
    }
    g3.appendChild(b5);
    var b6 = box('Entonnoir de conversion', 'Étapes distinctes : un clic n’est pas un devis. Les unités changent selon l’étape.');
    var fun = el('div', 'vst-fun');
    var top = d.funnel[0].value || 1;
    d.funnel.forEach(function (s, i) {
      var row = el('div', 'r');
      row.appendChild(el('div', 'i', String(i + 1)));
      var c = el('div');
      var t = el('div', 't');
      t.appendChild(el('span', null, s.label));
      var right = el('span'); var b = el('b', null, NF.format(s.value)); right.appendChild(b);
      right.appendChild(el('span', null, ' ' + s.unit + (s.pctOfPrevious == null ? '' : ' · ' + NF1.format(s.pctOfPrevious) + ' % de l’étape précédente')));
      t.appendChild(right);
      c.appendChild(t);
      var tr = el('div', 'vst-track'); var f = el('div', 'vst-fill' + (i === d.funnel.length - 1 ? ' g' : '')); f.style.width = Math.max(1.5, (Math.min(s.value, top) / top) * 100) + '%'; tr.appendChild(f); c.appendChild(tr);
      row.appendChild(c); fun.appendChild(row);
    });
    b6.appendChild(fun);
    g3.appendChild(b6);
    card.appendChild(g3);

    var g4 = el('div', 'vst-grid vst-even');
    var b7 = box('Non mesuré, volontairement', 'Aucun indicateur n’est inventé quand la donnée n’existe pas.');
    var ul = el('ul', 'vst-nm');
    d.notMeasured.forEach(function (n) { var li = el('li'); li.appendChild(el('b', null, n.label)); li.appendChild(el('span', null, n.reason)); ul.appendChild(li); });
    b7.appendChild(ul);
    g4.appendChild(b7);
    if (d.simulated) g4.appendChild(simBox());
    card.appendChild(g4);

    var foot = el('p', 'vst-foot', d.simulated
      ? 'Aperçu de démonstration : toutes les valeurs ci-dessus sont simulées (aucun visiteur ni client réel). Couverture : ' + d.coverage.daysWithData + ' jour(s) avec données sur ' + d.coverage.daysInRange + '.'
      : 'Couverture : ' + d.coverage.daysWithData + ' jour(s) avec données sur ' + d.coverage.daysInRange + '.');
    card.appendChild(foot);
  }

  function simBox() {
    var b = box('Simulation (démonstration)', 'Ajoute des parcours fictifs via le vrai collecteur, puis actualise les graphiques.');
    var f = el('div', 'vst-sim');
    function sel(label, id, opts) {
      var l = el('label'); l.appendChild(el('span', null, label));
      var s = el('select'); s.id = id;
      opts.forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; s.appendChild(op); });
      l.appendChild(s); f.appendChild(l); return s;
    }
    sel('Appareil', 'vstDev', [['mixed', 'Mixte'], ['mobile', 'Mobile'], ['desktop', 'Ordinateur'], ['tablet', 'Tablette']]);
    sel('Visiteur', 'vstVis', [['new', 'Nouveau'], ['returning', 'Récurrent (2e session)'], ['mixed', 'Mixte']]);
    sel('Parcours', 'vstJny', [['view', 'Visite simple'], ['browse', 'Catégorie + galerie'], ['form', 'Formulaire ouvert'], ['phone', 'Clic téléphone'], ['email', 'Clic e-mail'], ['quote', 'Demande de devis complète'], ['mix', 'Mélange réaliste']]);
    var l = el('label'); l.appendChild(el('span', null, 'Nombre'));
    var n = el('input'); n.id = 'vstCnt'; n.type = 'number'; n.min = '1'; n.max = '50'; n.value = '5'; l.appendChild(n); f.appendChild(l);
    var go = el('button', 'vst-btn', 'Simuler'); go.type = 'button';
    go.onclick = function () {
      var cnt = Math.max(1, Math.min(50, parseInt(n.value, 10) || 1));
      go.disabled = true;
      request('POST', '/api/admin/stats/demo/simulate', { device: $v('vstDev'), visitorType: $v('vstVis'), journey: $v('vstJny'), count: cnt })
        .then(function (j) {
          if (j.status_code === 401) { S.ctx.unauthorized(); return; }
          if (!j.ok) { S.ctx.toast(j.message || 'Simulation impossible.'); return; }
          S.ctx.toast(j.journeys + ' parcours simulé(s)' + (j.quotes ? ', ' + j.quotes + ' demande(s) de devis fictive(s)' : '') + '.');
          return load();
        }).catch(function () { S.ctx.toast('Impossible de joindre le serveur.'); }).then(function () { go.disabled = false; });
    };
    f.appendChild(go);
    var rs = el('button', 'vst-btn sec', 'Réinitialiser la démo'); rs.type = 'button';
    rs.onclick = function () {
      rs.disabled = true;
      request('POST', '/api/admin/stats/demo/reset', {}).then(function (j) {
        if (j.status_code === 401) { S.ctx.unauthorized(); return; }
        if (!j.ok) { S.ctx.toast(j.message || 'Réinitialisation impossible.'); return; }
        S.ctx.toast('Données de démonstration réinitialisées.');
        return load();
      }).catch(function () { S.ctx.toast('Impossible de joindre le serveur.'); }).then(function () { rs.disabled = false; });
    };
    f.appendChild(rs);
    b.appendChild(f);
    return b;
  }
  function $v(id) { return document.getElementById(id).value; }

  function message(text, isErr, retry) {
    var card = S.root.querySelector('.vst-body');
    card.textContent = '';
    var m = el('div', 'vst-msg' + (isErr ? ' err' : ''), text);
    if (retry) { var b = el('button', 'vst-btn sec', 'Réessayer'); b.type = 'button'; b.style.marginLeft = '12px'; b.onclick = retry; m.appendChild(b); }
    card.appendChild(m);
  }

  function load() {
    var q = 'range=' + encodeURIComponent(S.range);
    if (S.range === 'custom') q += '&from=' + encodeURIComponent(S.from) + '&to=' + encodeURIComponent(S.to);
    S.busy = true;
    if (!S.data) message('Chargement des statistiques…');
    return request('GET', '/api/admin/stats/overview?' + q).then(function (j) {
      S.busy = false;
      if (j.status_code === 401) { S.ctx.unauthorized(); close(); return; }
      if (!j.ok) { message(j.message || 'Statistiques indisponibles.', true, load); return; }
      S.data = j;
      render();
    }).catch(function () { S.busy = false; message('Impossible de joindre le serveur.', true, load); });
  }

  function build() {
    ensureStyle();
    var root = el('div', 'vst'); root.id = 'vst'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'vst-t');
    var card = el('div', 'vst-card');
    var head = el('div', 'vst-head');
    var h = el('h2'); h.id = 'vst-t';
    var ic = sv('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    [['M4 20V12'], ['M10 20V7'], ['M16 20V14']].forEach(function (a) { ic.appendChild(sv('path', { d: a[0] })); });
    ic.appendChild(sv('path', { d: 'M3 9l5-4 4 3 7-6' })); ic.appendChild(sv('path', { d: 'M15 2h4v4' })); ic.appendChild(sv('path', { d: 'M2 21h20' }));
    h.appendChild(ic); h.appendChild(el('span', null, 'Statistiques'));
    head.appendChild(h);
    var badge = el('span', 'vst-badge', 'Données simulées'); badge.id = 'vstBadge'; badge.hidden = true; head.appendChild(badge);
    var x = el('button', 'vst-close', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Fermer les statistiques'); x.title = 'Fermer'; x.onclick = close;
    head.appendChild(x);
    card.appendChild(head);

    var bar = el('div', 'vst-bar'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Période');
    var chips = {};
    RANGES.forEach(function (a) {
      var c = el('button', 'vst-chip', a[1]); c.type = 'button'; c.setAttribute('aria-pressed', a[0] === S.range ? 'true' : 'false');
      c.onclick = function () {
        S.range = a[0];
        Object.keys(chips).forEach(function (k) { chips[k].setAttribute('aria-pressed', k === S.range ? 'true' : 'false'); });
        custom.hidden = S.range !== 'custom';
        if (S.range !== 'custom') load();
      };
      chips[a[0]] = c; bar.appendChild(c);
    });
    var custom = el('div', 'vst-custom'); custom.hidden = true;
    var f = el('input'); f.type = 'date'; f.setAttribute('aria-label', 'Date de début');
    var t = el('input'); t.type = 'date'; t.setAttribute('aria-label', 'Date de fin');
    var ok = el('button', 'vst-chip', 'Appliquer'); ok.type = 'button';
    ok.onclick = function () {
      if (!f.value || !t.value) { S.ctx.toast('Choisissez une date de début et une date de fin.'); return; }
      S.from = f.value; S.to = t.value; load();
    };
    custom.appendChild(el('span', null, 'Du')); custom.appendChild(f); custom.appendChild(el('span', null, 'au')); custom.appendChild(t); custom.appendChild(ok);
    bar.appendChild(custom);
    var cmp = el('label', 'vst-cmp'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = S.compare;
    cb.onchange = function () { S.compare = cb.checked; render(); };
    cmp.appendChild(cb); cmp.appendChild(el('span', null, 'Comparer à la période précédente'));
    bar.appendChild(cmp);
    card.appendChild(bar);
    card.appendChild(el('div', 'vst-body'));
    root.appendChild(card);
    document.body.appendChild(root);
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    S.root = root;
    S.chips = chips; S.f = f; S.t = t;
  }

  function open(ctx, info) {
    S.ctx = ctx;
    S.opener = document.activeElement;
    if (!S.root) build();
    var today = info && info.today;
    if (today && !S.from) { S.to = today; S.from = today; S.t.value = today; S.f.value = today; S.t.max = today; S.f.max = today; }
    document.getElementById('vstBadge').hidden = !(info && info.simulated);
    S.root.hidden = false;
    document.body.style.overflow = 'hidden';
    S.root.querySelector('.vst-close').focus();
    load();
  }
  function close() {
    hideTip();
    if (!S.root) return;
    S.root.hidden = true;
    document.body.style.overflow = '';
    if (S.opener && S.opener.focus) { try { S.opener.focus(); } catch (e) { /* ignore */ } }
  }

  window.VectisStats = { open: open, close: close };
})();
