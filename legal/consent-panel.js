/* Page « Gestion des cookies » : affiche l'état de la mesure d'audience et les deux boutons (Refuser / Accepter, de même poids).
   Une seule lecture de /api/site/content (déjà publique) pour savoir si la mesure est en service. Aucune écriture, hors le choix du visiteur
   (voir stats-consent.js). Toute erreur est avalée. */
(function () {
  'use strict';
  var C = window.VectisConsent;
  var st = document.getElementById('cstate'), bt = document.getElementById('cbtns');
  var no = document.getElementById('cNo'), yes = document.getElementById('cYes');
  if (!st || !bt || !no || !yes) return;
  var active = null;   // true / false / null (inconnu)

  function render() {
    try {
      if (!C) { st.textContent = 'Aucune mesure d’audience n’est effectuée.'; bt.hidden = true; return; }
      if (C.blocked()) { st.textContent = 'Votre navigateur envoie le signal « Ne pas me suivre » (DNT) ou GPC : la mesure d’audience est désactivée, aucun événement n’est envoyé.'; bt.hidden = true; return; }
      if (active !== true) { st.textContent = 'La mesure d’audience n’est pas en service sur ce site : aucun événement n’est envoyé et aucun choix n’est nécessaire.'; bt.hidden = true; return; }
      var c = C.get();
      st.textContent = c === 'granted' ? 'Vous avez accepté la mesure d’audience. Vous pouvez la refuser à tout moment.'
        : c === 'denied' ? 'Vous avez refusé la mesure d’audience : aucun événement n’est envoyé. Vous pouvez l’accepter à tout moment.'
        : 'Vous n’avez pas encore fait de choix : aucun événement n’est envoyé tant que vous n’avez pas accepté.';
      bt.hidden = false;
      no.setAttribute('aria-pressed', c === 'denied' ? 'true' : 'false');
      yes.setAttribute('aria-pressed', c === 'granted' ? 'true' : 'false');
    } catch (e) { /* ignoré */ }
  }
  no.addEventListener('click', function () { if (C) C.set('denied'); render(); });
  yes.addEventListener('click', function () { if (C) C.set('granted'); render(); });
  if (C) C.onChange(render);

  try {
    window.fetch('/api/site/content', { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { active = !!(j && j.ok === true && j.stats === true); render(); },
            function () { active = false; render(); });
  } catch (e) { active = false; render(); }
})();
