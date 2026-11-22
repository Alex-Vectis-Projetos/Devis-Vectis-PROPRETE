/* CONSENTEMENT À LA MESURE D'AUDIENCE — VECTIS.
   Rôle unique : savoir si le visiteur a accepté ou refusé la mesure d'audience, et lui permettre de choisir ou de changer d'avis.
   Stockage : une seule clé du stockage local, « vectis_stats_consent » = { v, c: "granted" | "denied", t: horodatage }, écrite uniquement
   lorsque le visiteur clique sur Accepter ou Refuser. Elle ne contient aucune autre donnée, n'est jamais envoyée au serveur et expire après 6 mois.
   Les signaux « Ne pas me suivre » (DNT) et GPC l'emportent sur tout : état « refusé », aucun bandeau.
   Ne fait aucune requête réseau. N'appelle aucune fonction du site. Toute erreur est avalée. */
(function () {
  'use strict';
  try {
    if (window.VectisConsent) return;
    var KEY = 'vectis_stats_consent';
    var TTL = 183 * 24 * 3600 * 1000;      // 6 mois
    var mem = null;                         // repli si le stockage est indisponible : valable pour cette page seulement
    var subs = [];

    function blocked() {
      var n = window.navigator || {};
      return n.doNotTrack === '1' || window.doNotTrack === '1' || n.globalPrivacyControl === true;
    }
    function stored() {
      try {
        var o = JSON.parse(window.localStorage.getItem(KEY));
        if (o && o.v === 1 && (o.c === 'granted' || o.c === 'denied') && typeof o.t === 'number') {
          var age = Date.now() - o.t;
          if (age >= 0 && age < TTL) return o.c;
        }
      } catch (e) { /* stockage indisponible ou valeur invalide : pas de choix */ }
      return null;
    }
    // 'granted' | 'denied' | null (pas encore de choix)
    function get() {
      if (blocked()) return 'denied';
      return stored() || mem;
    }
    function notify() {
      var c = get();
      subs.slice().forEach(function (f) { try { f(c); } catch (e) { /* ignoré */ } });
    }
    function set(c) {
      if (c !== 'granted' && c !== 'denied') return;
      mem = c;
      try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, c: c, t: Date.now() })); } catch (e) { /* le choix vaut pour cette page */ }
      removeBar();
      notify();
    }
    function onChange(f) { if (typeof f === 'function') subs.push(f); }
    window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === null) { mem = null; notify(); } });

    var bar = null;
    function removeBar() { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }
    function css() {
      if (document.getElementById('vc-css')) return;
      var st = document.createElement('style'); st.id = 'vc-css';
      st.textContent =
        '.vc-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#0b0a08;border-top:1px solid rgba(217,165,33,.6);color:#f7f3ea;font:14px/1.5 Montserrat,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:14px max(16px,env(safe-area-inset-right,0px)) calc(14px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));box-shadow:0 -8px 30px rgba(0,0,0,.55)}' +
        '.vc-in{max-width:980px;margin:0 auto;display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;justify-content:space-between}' +
        '.vc-tx{flex:1 1 360px;min-width:0;margin:0}.vc-tx a{color:#f6d36a}' +
        '.vc-ac{display:flex;gap:10px;flex:0 0 auto}' +
        '.vc-btn{appearance:none;cursor:pointer;min-width:112px;min-height:44px;padding:9px 18px;border-radius:10px;border:1px solid #d9a521;background:transparent;color:#f6d36a;font:700 14px/1.2 inherit;font-family:inherit}' +
        '.vc-btn:hover{background:rgba(217,165,33,.16)}.vc-btn:focus-visible{outline:2px solid #f6d36a;outline-offset:2px}' +
        '@media (max-width:560px){.vc-ac{width:100%}.vc-btn{flex:1 1 0}}';
      document.head.appendChild(st);
    }
    function mk(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }
    // Affiche le bandeau (jamais si un choix existe, jamais si DNT/GPC). Deux boutons identiques : Refuser et Accepter.
    function prompt() {
      try {
        if (bar || get() !== null || !document.body) return;
        css();
        bar = mk('div', 'vc-bar'); bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Mesure d’audience'); bar.id = 'vcBar';
        var inn = mk('div', 'vc-in');
        var tx = mk('p', 'vc-tx');
        tx.appendChild(document.createTextNode('VECTIS souhaite mesurer la fréquentation de ce site pour l’améliorer. Aucun cookie n’est déposé, aucune donnée de votre formulaire n’est lue, et rien n’est envoyé sans votre accord. '));
        var a = mk('a', '', 'En savoir plus'); a.href = 'politique-de-confidentialite.html#audience';
        tx.appendChild(a); tx.appendChild(document.createTextNode('.'));
        var ac = mk('div', 'vc-ac');
        var no = mk('button', 'vc-btn', 'Refuser'); no.type = 'button'; no.id = 'vcNo';
        var ok = mk('button', 'vc-btn', 'Accepter'); ok.type = 'button'; ok.id = 'vcYes';
        no.addEventListener('click', function () { set('denied'); });
        ok.addEventListener('click', function () { set('granted'); });
        ac.appendChild(no); ac.appendChild(ok);
        inn.appendChild(tx); inn.appendChild(ac); bar.appendChild(inn);
        document.body.appendChild(bar);
      } catch (e) { /* ignoré */ }
    }

    window.VectisConsent = { key: KEY, blocked: blocked, get: get, set: set, onChange: onChange, prompt: prompt };
  } catch (e) { /* jamais d'impact sur le site */ }
})();
