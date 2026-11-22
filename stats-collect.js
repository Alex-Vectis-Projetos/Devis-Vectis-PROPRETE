/* STATISTIQUES VECTIS — mesure d'audience du site public (aucun cookie, aucun stockage, aucune donnée personnelle).
   Envoie au serveur uniquement { t: type d'événement, g: identifiant de catégorie } vers /api/stats/e ; le serveur déduit lui-même
   visiteur, session et appareil (l'adresse IP et le navigateur ne sont jamais enregistrés). Rien du formulaire n'est lu :
   ni valeur, ni nom de champ, ni contenu. Un devis envoyé n'est PAS un événement du navigateur : il est compté côté serveur.
   Garanties : n'écoute que (capture, sans jamais arrêter ni modifier un événement), n'appelle aucune fonction du site, ne bloque
   rien, avale toute erreur. Désactivé si le navigateur envoie « Ne pas me suivre » / GPC. Il ne démarre que si la réponse de
   /api/site/content (déjà demandée par la page : AUCUNE requête supplémentaire) contient stats === true, donc jamais de POST ni de
   404 tant que la collecte est désactivée côté serveur. Contenu absent ou en erreur : aucune mesure pendant cette visite. */
(function () {
  'use strict';
  try {
    var nav = window.navigator || {};
    if (nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.globalPrivacyControl === true) return;
    if (typeof window.fetch !== 'function') return;

    var URL_ = '/api/stats/e';
    var ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
    var TARGETED = { category_view: 1, gallery_open: 1 };
    var sent = {};          // une seule fois par type+cible pendant cette page (le serveur dédoublonne aussi par session)
    var off = false;        // filet de sécurité : mis à true si le serveur répond autre chose que 204 (plus aucune requête pendant cette visite)

    function send(type, target) {
      try {
        if (off) return;
        if (TARGETED[type]) { if (typeof target !== 'string' || !ID_RE.test(target)) return; } else target = '';
        var key = type + '|' + target;
        if (sent[key]) return;
        sent[key] = 1;
        if (document.body && document.body.classList.contains('v-editing')) return;   // administrateur en édition : jamais compté
        var body = TARGETED[type] ? { t: type, g: target } : { t: type };
        window.fetch(URL_, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
          cache: 'no-store',
          referrerPolicy: 'no-referrer'
        }).then(function (r) { if (r.status !== 204 && r.status !== 429) off = true; }, function () { /* réseau : ignoré */ });
      } catch (e) { /* jamais d'impact sur le site */ }
    }

    function formOpened() { if ((location.hash || '') === '#devis') send('form_open'); }

    function onClick(e) {
      try {
        var t = e.target && e.target.closest ? e.target : null;
        if (!t) return;
        var a = t.closest('a[href]');
        if (a) {
          var h = (a.getAttribute('href') || '').slice(0, 7).toLowerCase();
          if (h.indexOf('tel:') === 0) { send('phone_click'); return; }
          if (h === 'mailto:') { send('email_click'); return; }
        }
        var c = t.closest('.dom[data-cat], .card[data-cat]');   // catégorie choisie (domaines ou galerie)
        if (c) { send('category_view', c.getAttribute('data-cat')); return; }
        var p = t.closest('.card[data-id]');                     // établissement ouvert dans la galerie : cible = catégorie affichée
        if (p) send('gallery_open', typeof window.activeCat === 'string' ? window.activeCat : '');
      } catch (err) { /* ignoré */ }
    }

    function onInput(e) {
      try {
        if (!e.isTrusted) return;
        var f = document.getElementById('quoteForm');
        if (f && e.target && f.contains(e.target)) send('form_start');
      } catch (err) { /* ignoré */ }
    }

    function start() {
      document.addEventListener('click', onClick, true);
      document.addEventListener('input', onInput, true);
      document.addEventListener('change', onInput, true);
      window.addEventListener('hashchange', formOpened);
      send('view');
      formOpened();
    }

    // Même promesse que celle consommée par le site (window.__siteContent) : pas de nouvelle requête.
    var ready = window.__siteContent;
    if (!ready || typeof ready.then !== 'function') return;
    ready.then(function (j) { if (j && j.ok === true && j.stats === true) start(); }, function () { /* ignoré */ });
  } catch (e) { /* jamais d'impact sur le site */ }
})();
