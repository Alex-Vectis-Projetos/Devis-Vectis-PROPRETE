# STATISTIQUES VECTIS — analyse CNIL / RGPD et mécanisme d'opposition

Analyse **technique** préparée pour la décision de mise en service (`STATS_ENABLED=true`). Elle n'est pas un avis juridique : la conclusion doit être validée par un
conseil (avocat, DPO externe) avant l'activation. Date : 22/11/2026. Source CNIL consultée : « Cookies : solutions pour les outils de mesure d'audience »
(cnil.fr/fr/cookies-solutions-pour-les-outils-de-mesure-daudience) et « Mesurer la fréquentation de vos sites web et de vos applications ».

## 1. Conclusion

**L'éligibilité à la dispense de consentement (art. 82 de la loi Informatique et Libertés) ne peut pas être démontrée aujourd'hui.** Absence de cookie persistant ne suffit pas.
Avant l'activation, une des deux voies doit être retenue **par écrit** :

- **Voie A — pas de consentement** : seulement si un conseil confirme par écrit (1) que l'art. 82 ne s'applique pas à ce dispositif (aucun accès ni inscription d'information
  dans le terminal) et (2) que l'intérêt légitime (art. 6.1.f RGPD) est établi (test de mise en balance), avec information claire et **opposition accessible** (art. 21 RGPD).
- **Voie B — consentement** : bannière opt-in ; aucune requête de mesure avant « Accepter » ; retrait aussi facile que l'acceptation. C'est la voie sûre si la voie A n'est pas validée.

Les pages publiques n'affirment aucune dispense (vérifié par test). La politique de confidentialité porte un marqueur « À COMPLÉTER » imposant cette décision.

## 2. Faits techniques (code `main`, `server/src/stats.js`, `stats-collect.js`)

| Élément | Constat |
|---|---|
| Stockage / lecture dans le terminal | Aucun cookie, `localStorage`, `sessionStorage`. Le script lit seulement DNT/GPC, l'ancre `#devis` et les clics de la page ; il envoie `{t, g}`. |
| Identifiant | `vkey` = HMAC(secret aléatoire de 32 octets du jour, IP + user-agent), tronqué à 24 car. ; `sid` aléatoire, session de 30 min, jamais envoyé au navigateur. |
| IP et user-agent | Utilisés en mémoire, jamais écrits dans `stats_events` ; route sans IP dans le journal applicatif ; Nginx `access_log off` sur `/api/stats/e` (appliqué en production, confirmé par `nginx -T` le 22/11/2026). `error.log` et logs Docker restent généraux. |
| Secret | Table `kv`, supprimé le lendemain ; **les sauvegardes de la base contiennent le secret du jour de leur création**, avec les clés du même jour. |
| Données | `stats_events` : jour, sid, vkey, type, cible, appareil (90 jours) ; `stats_daily` : agrégats (25 mois). Aucun nom, e-mail, téléphone, contenu de formulaire. |
| Devis | Comptés côté serveur depuis `quotes` (date + `status='sent'`), **non rattachés à une session ou à un visiteur**. |
| Opposition | DNT et GPC (navigateur + serveur). Aucun autre mécanisme. |

## 3. Analyse point par point

1. **Identifiant quotidien pseudonymisé.** Il relie les événements d'un même visiteur pendant un jour : c'est une donnée personnelle pseudonymisée (considérant 26 et art. 4(5) RGPD),
   **pas anonyme**. Or les critères CNIL de la dispense exigent de ne produire que des « données statistiques anonymes ». Le désalignement d'un jour à l'autre limite le suivi mais ne rend pas les données anonymes.
2. **IP et user-agent.** La page CNIL consultée ne traite pas spécifiquement l'IP. Le traitement en mémoire et la non-inscription réduisent le risque, mais l'IP reste traitée pour calculer l'identifiant : le RGPD s'applique.
3. **Conversions et entonnoir.** La page CNIL consultée liste comme finalités admises : performance, détection de problèmes de navigation, optimisation technique ou ergonomique, estimation de la puissance serveur, analyse des contenus consultés.
   Les conversions/entonnoirs commerciaux n'y figurent pas explicitement : **non démontré**. Atténuant : le lien visite→devis n'est pas fait au niveau individuel (agrégats juxtaposés).
4. **Finalité exclusivement statistique.** Vérifiée dans le code (pas de croisement, pas de tiers, pas de publicité, administrateurs exclus). À documenter dans le registre des traitements.
5. **Opposition accessible.** DNT/GPC seuls sont insuffisants comme mécanisme **visible** : beaucoup de visiteurs ne les activent pas et rien dans la page ne le propose. L'opposition par e-mail ne peut pas être appliquée à un visiteur précis (VECTIS ne peut plus le retrouver, art. 11 RGPD).
   Un mécanisme simple est donc recommandé dans tous les cas (voir §5).
6. **Art. 82 LIL.** Il vise l'accès ou l'inscription d'informations dans le terminal. Le dispositif n'en réalise pas, mais l'appréciation de la CNIL sur les dispositifs « sans cookie » est plus large pour d'autres techniques (empreinte) : la question doit être tranchée par le conseil. Si l'art. 82 s'applique, la dispense n'est pas démontrée (points 1 et 3) → consentement.
7. **Art. 6.1.f RGPD.** Base plausible pour une mesure d'audience interne, mais elle suppose : intérêt légitime documenté, nécessité (voir design C ci-dessous), balance des intérêts, information (art. 13) et droit d'opposition (art. 21). Test de mise en balance à rédiger (modèle §6).

## 4. Pistes de réduction du risque (non implémentées)

- **Design C — compteurs agrégés sans clé** : n'incrémenter que des compteurs journaliers par type/catégorie/appareil, sans `sid` ni `vkey`. On se rapproche des « statistiques anonymes uniquement » (plus de visiteurs/sessions uniques ni de déduplication, perte de précision). Demande une évolution du collecteur, du tableau de bord et de la migration : **hors périmètre sans nouvelle autorisation**.
- Exclure des sauvegardes la clé `stats:salt:*` ou fixer une durée courte des sauvegardes.
- Réduire la conservation brute (90 jours) si l'agrégat quotidien suffit.

## 5. Proposition technique d'opposition (à valider avant toute modification du collecteur)

Contrainte : pas de cookie persistant. Options :

| Option | Principe | Avantages | Limites |
|---|---|---|---|
| O1 (proposée) | Page « Gestion des cookies » : interrupteur « Ne pas mesurer ma visite ». Un clic écrit `localStorage['vectis_stats_optout']='1'` **uniquement sur action explicite**. Le collecteur lit ce drapeau au démarrage et ne démarre pas (aucune requête). Bouton « Réactiver » efface le drapeau. | Simple, durable, accessible depuis le pied de page, aucune donnée serveur, aucun identifiant. | C'est une inscription dans le terminal (nécessaire pour respecter le choix : à confirmer par le conseil) ; par navigateur ; perdu si le stockage est effacé. |
| O2 | Se contenter de DNT/GPC (déjà en place) | Aucun stockage | Peu visible, non démontrable comme « simple et accessible ». |
| O3 | Opposition côté serveur par clé | — | **Rejetée** : exigerait de conserver un identifiant durable. |
| O4 | Opt-in (voie B) | Robuste juridiquement | Bannière, baisse de couverture. |

Modification type envisagée pour O1/O4 (non appliquée) : dans `stats-collect.js`, avant `start()` : `try{ if(localStorage.getItem('vectis_stats_optout')==='1') return; }catch(e){}` ;
pour O4, démarrer seulement si le drapeau vaut `'accepted'`. Une même clé à trois états (`accepted` / `refused` / absent) permet de passer de O1 à O4 sans refonte. Tests : navigateur (aucune requête après refus, persistance, réactivation, DNT/GPC conservés) et statique (la page ne contient aucun cookie tiers).

## 6. Test de mise en balance (intérêt légitime) — brouillon à faire valider

- **Intérêt** : connaître la fréquentation et l'intérêt pour les prestations afin d'améliorer le site (intérêt commercial légitime, non publicitaire).
- **Nécessité** : mesure interne, sans tiers ; alternative moins intrusive = design C (compteurs sans clé).
- **Balance** : données pseudonymisées d'un jour, aucune donnée sensible, aucune identification entre jours, conservation 90 jours/25 mois, opposition possible, information en pied de page.
- **Garanties** : secret quotidien, IP/UA non enregistrés, logs écartés, administrateurs exclus, accès réservé aux administrateurs.

## 7. Conditions avant `STATS_ENABLED=true`

1. Décision écrite voie A ou B (avec validation d'un conseil) ; adaptation des pages en conséquence.
2. Mécanisme d'opposition (O1) ou de consentement (O4) implémenté, testé et présenté avant toute modification du collecteur.
3. Pages juridiques publiées sans « À COMPLÉTER » (voir `deploy/LEGAL-PENDING.md`).
4. Durées de conservation des sauvegardes et des journaux décidées et documentées.
5. `TRUST_PROXY=172.16.11.1` et `access_log off` sur `/api/stats/e` : déjà confirmés ; ne pas réappliquer.
6. Nouvelle sauvegarde, puis activation avec autorisation séparée.
