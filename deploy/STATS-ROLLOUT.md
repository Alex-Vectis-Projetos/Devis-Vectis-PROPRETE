# STATISTIQUES VECTIS — mise en service et confidentialité

État du code (branche `feat/stats-2-dashboard`, **non déployée**) : API de lecture admin, tableau de bord dans le dock, collecte navigateur
(`stats-collect.js`), roll-up + rétention. `STATS_ENABLED` reste **faux** tant que le propriétaire ne l'a pas validé.

## Ce qui est mesuré (et ce qui ne l'est pas)
- Événements : `view`, `category_view`, `gallery_open`, `form_open`, `form_start`, `phone_click`, `email_click`. Corps envoyé : `{t, g}` seulement.
- Devis envoyé : jamais un événement navigateur ; compté côté serveur depuis la table `quotes` (`status = 'sent'`), sans lire nom, e-mail, téléphone ni contenu.
- Aucun cookie, aucun stockage navigateur. IP et user-agent ne sont ni enregistrés ni journalisés : ils servent en mémoire à calculer une clé pseudonymisée
  (HMAC avec un sel aléatoire du jour, supprimé le lendemain) → donnée **pseudonymisée** (RGPD applicable), non réidentifiable d'un jour à l'autre.
- Non mesuré, volontairement : visiteurs nouveaux/récurrents, origine du trafic, clic sur « Envoyer ».
- Respect de `DNT` et `Sec-GPC` (navigateur et serveur). Le trafic administrateur n'est jamais compté.

## Rétention
- `stats_events` : 90 jours (aujourd'hui + 89). `stats_daily` : 25 mois (depuis le 1er du mois −25).
- Roll-up des jours clos (marge 30 min) atomique et idempotent ; purge brute seulement si le total agrégé = nombre de lignes brutes ; sinon le jour est conservé et journalisé.
- Tâche lancée par `index.js` (1 min après le démarrage, puis toutes les 6 h) ; sans effet tant que les tables sont vides.

## Avant d'activer `STATS_ENABLED=true` (nécessite une autorisation expresse)
1. Appliquer dans Nginx le bloc `location = /api/stats/e { access_log off; ... }` de `deploy/nginx-devis-vectis-api.conf` (`nginx -t` puis reload) : sans lui,
   l'IP des visiteurs reste dans `access.log` pour cette route. `error.log` reste global (à indiquer dans la politique de confidentialité).
2. Vérifier `TRUST_PROXY=172.16.11.1` dans le conteneur (sinon tous les visiteurs ont la même clé).
3. Publier la politique de confidentialité (pages légales : 22 champs `[À COMPLÉTER]`) et valider avec le conseil juridique (CNIL : mesure d'audience, exemption possible
   seulement si les conditions sont remplies : finalité limitée, pas de recoupement, durée limitée).
4. Surveiller après activation : `docker logs devis-vectis-api` (compteurs d'abandon, aucune donnée personnelle), puis le tableau de bord.

## Retour arrière
`STATS_ENABLED` absent/faux + recréation de l'API : plus aucune route de collecte (le navigateur s'arrête au premier 404). Le code précédent (`823cc53`) reste
compatible avec la base (aucune migration nouvelle dans cette branche).
