/* CONSENTEMENT À LA MESURE D'AUDIENCE — VECTIS.
   Rôle unique : savoir si le visiteur a accepté ou refusé la mesure d'audience (seule catégorie facultative qui existe), et lui permettre de choisir ou de changer d'avis.
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
        '.vc-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;box-sizing:border-box;width:min(392px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:#0b0a08;border:1px solid rgba(217,165,33,.6);border-radius:14px;color:#f7f3ea;font:13.5px/1.5 Montserrat,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;padding:16px 16px 14px;box-shadow:0 12px 40px rgba(0,0,0,.6)}' +
        '.vc-panel *{box-sizing:border-box}' +
        '.vc-t{margin:0 0 6px;font-size:15px;font-weight:700;color:#f6d36a;line-height:1.3}' +
        '.vc-tx{margin:0 0 12px}.vc-tx a,.vc-d a{color:#f6d36a}' +
        '.vc-ac{display:grid;grid-template-columns:1fr 1fr;gap:8px}.vc-ac .vc-btn:last-child{grid-column:1 / -1}' +
        '.vc-btn{appearance:none;cursor:pointer;min-height:44px;padding:9px 12px;border-radius:10px;border:1px solid #d9a521;background:transparent;color:#f6d36a;font:700 13.5px/1.2 inherit;font-family:inherit;text-align:center}' +
        '.vc-btn:hover{background:rgba(217,165,33,.16)}.vc-btn:focus-visible,.vc-sw:focus-visible{outline:2px solid #f6d36a;outline-offset:2px}' +
        '.vc-cat{border:1px solid rgba(217,165,33,.25);border-radius:10px;padding:10px 12px;margin:0 0 8px}' +
        '.vc-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.vc-row label,.vc-row strong{font-weight:700}' +
        '.vc-d{margin:4px 0 0;color:#cfc9b9;font-size:12.5px}.vc-on{color:#cfc9b9;font-size:12px;white-space:nowrap}' +
        '.vc-sw{appearance:none;-webkit-appearance:none;flex:none;width:46px;height:26px;border-radius:13px;border:1px solid #d9a521;background:#1a1810;position:relative;cursor:pointer;margin:0}' +
        '.vc-sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#a8a396;transition:transform .15s}' +
        '.vc-sw:checked{background:rgba(217,165,33,.35)}.vc-sw:checked::after{transform:translateX(20px);background:#f6d36a}' +
        '.vc-sw:disabled{opacity:.6;cursor:not-allowed}' +
        '.vc-ac2{display:grid;grid-template-columns:1fr;gap:8px;margin-top:10px}' +
        '@media (max-width:560px){.vc-panel{right:8px;left:8px;width:auto;bottom:calc(8px + env(safe-area-inset-bottom,0px));max-height:78vh}}' +
        '@media (prefers-reduced-motion:reduce){.vc-sw::after{transition:none}}';
      document.head.appendChild(st);
    }
    function mk(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }
    function link(txt) { var a = mk('a', '', txt); a.href = 'gestion-des-cookies.html'; return a; }
    // Panneau compact en bas à droite, affiché seulement si aucun choix n'existe (jamais avec DNT/GPC).
    // Premier niveau : Tout refuser · Tout accepter · Personnaliser mes choix, trois boutons de même style et de même taille.
    function prompt() {
      try {
        if (bar || get() !== null || !document.body) return;
        css();
        bar = mk('div', 'vc-panel'); bar.id = 'vcBar'; bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-labelledby', 'vcT'); bar.setAttribute('aria-modal', 'false');
        var main = mk('div', 'vc-main'), custom = mk('div', 'vc-custom'); custom.hidden = true;

        // — Niveau 1
        main.appendChild(mk('h2', 'vc-t', 'Cookies et mesure d’audience')).id = 'vcT';
        var tx = mk('p', 'vc-tx');
        tx.appendChild(document.createTextNode('VECTIS ne dépose aucun cookie publicitaire. Avec votre accord, le site mesure sa fréquentation (statistiques pseudonymisées, sans nom ni e-mail) pour s’améliorer. Rien n’est mesuré avant votre choix. '));
        tx.appendChild(link('Politique de cookies')); tx.appendChild(document.createTextNode('.'));
        main.appendChild(tx);
        var ac = mk('div', 'vc-ac');
        var no = mk('button', 'vc-btn', 'Tout refuser'); no.type = 'button'; no.id = 'vcNo';
        var ok = mk('button', 'vc-btn', 'Tout accepter'); ok.type = 'button'; ok.id = 'vcYes';
        var cu = mk('button', 'vc-btn', 'Personnaliser mes choix'); cu.type = 'button'; cu.id = 'vcCustom';
        ac.appendChild(no); ac.appendChild(ok); ac.appendChild(cu); main.appendChild(ac);

        // — Niveau 2 : seules les catégories qui existent vraiment
        var h2 = mk('h2', 'vc-t', 'Personnaliser mes choix'); custom.appendChild(h2);
        var c1 = mk('div', 'vc-cat'), r1 = mk('div', 'vc-row');
        r1.appendChild(mk('strong', '', 'Fonctionnement du site (nécessaire)'));
        r1.appendChild(mk('span', 'vc-on', 'Toujours actif'));
        c1.appendChild(r1);
        c1.appendChild(mk('p', 'vc-d', 'Mémorise votre choix sur cet appareil. Aucun cookie n’est déposé pour les visiteurs ; la session des administrateurs n’existe qu’après leur connexion. Ne peut pas être désactivé.'));
        var c2 = mk('div', 'vc-cat'), r2 = mk('div', 'vc-row');
        var lab = mk('label', '', 'Mesure d’audience'); lab.setAttribute('for', 'vcAud');
        var sw = mk('input', 'vc-sw'); sw.type = 'checkbox'; sw.id = 'vcAud'; sw.setAttribute('role', 'switch'); sw.checked = false;
        r2.appendChild(lab); r2.appendChild(sw); c2.appendChild(r2);
        var d2 = mk('p', 'vc-d', 'Compter les visites, les pages et prestations consultées et les clics sur le téléphone ou l’e-mail, sans cookie, sans nom ni e-mail, pour améliorer le site. Désactivée par défaut. ');
        d2.appendChild(link('En savoir plus')); d2.appendChild(document.createTextNode('.'));
        c2.appendChild(d2);
        custom.appendChild(c1); custom.appendChild(c2);
        var ac2 = mk('div', 'vc-ac2');
        var cf = mk('button', 'vc-btn', 'Confirmer mes choix'); cf.type = 'button'; cf.id = 'vcConfirm';
        var bk = mk('button', 'vc-btn', 'Retour'); bk.type = 'button'; bk.id = 'vcBack';
        ac2.appendChild(cf); ac2.appendChild(bk); custom.appendChild(ac2);

        no.addEventListener('click', function () { set('denied'); });
        ok.addEventListener('click', function () { set('granted'); });
        cu.addEventListener('click', function () { main.hidden = true; custom.hidden = false; sw.focus(); });
        bk.addEventListener('click', function () { custom.hidden = true; main.hidden = false; cu.focus(); });
        cf.addEventListener('click', function () { set(sw.checked ? 'granted' : 'denied'); });
        bar.appendChild(main); bar.appendChild(custom);
        document.body.appendChild(bar);
      } catch (e) { /* ignoré */ }
    }

    window.VectisConsent = { key: KEY, blocked: blocked, get: get, set: set, onChange: onChange, prompt: prompt };
  } catch (e) { /* jamais d'impact sur le site */ }
})();
