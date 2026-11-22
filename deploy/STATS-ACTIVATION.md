# Activation de la mesure d'audience (phase 2) — à exécuter par l'administrateur du serveur

Cette phase modifie l'environnement de production : elle n'est **pas** exécutée par le dépôt ni par le déploiement automatique. Le code publié (consentement + collecte) reste inerte tant que `STATS_ENABLED` n'est pas vrai.

## 1. Preuves de conformité du code avant activation (verrouillées par tests, exécutés en CI)
| Exigence | Test |
|---|---|
| Aucun événement avant le consentement (clics, formulaire, `#devis`) ; aucun cookie ni stockage écrit avant le choix | `server/test/browser/stats-collect.js` « pas de choix = panneau visible, AUCUN événement… » |
| Aucun identifiant optionnel créé avant le choix (navigateur : rien d'écrit ; serveur : `sid`/`vkey` n'existent que pour un événement reçu) | même test + `stats.test.js` |
| Tout accepter / Tout refuser / Personnaliser, mêmes style et taille ; panneau en bas à droite (bureau, tablette, mobile) | « panneau compact en bas à droite… » |
| Personnaliser : nécessaire toujours actif, mesure d'audience désactivée par défaut, Confirmer applique sans quitter la page | « Personnaliser — nécessaire toujours actif… » |
| Refus et retrait interrompent immédiatement la collecte ; ré-accord la reprend | « Refuser = aucun événement… », « retirer son accord arrête immédiatement… » |
| Choix de plus de six mois redemandé ; valeur invalide = pas de choix | « un choix de plus de six mois est redemandé… » |
| DNT et GPC l'emportent (aucun panneau, aucun événement), même avec un accord mémorisé | « « Ne pas me suivre » et GPC l'emportent… » |
| Gestion des cookies accessible à tout moment, retrait appliqué au site | « page « Gestion des cookies »… », « gestion des cookies accessible… » |
| Aucun suivi nominal : nom, e-mail, téléphone jamais envoyés ; corps limité à `t` et `g` ; aucune colonne IP/UA | « aucun suivi nominal… », `legal-stats-privacy.test.js` |
| Devis comptés depuis les enregistrements réels (`quotes.status = 'sent'`), jamais depuis le navigateur | `stats-report.test.js`, `stats-admin.test.js` |
| Collecteur inerte si `stats:false` (aucun panneau, aucune requête) | « stats=false : aucune requête… » |

## 2. Contrôles de configuration avant d'activer (lecture seule)
```bash
cd /opt/devis-vectis
# Variable actuelle (compte seulement : le fichier d'environnement n'est jamais affiché)
grep -c '^STATS_ENABLED=' /etc/devis-vectis/api.env
# TRUST_PROXY effectif dans le conteneur (valeur non secrète, attendue : 172.16.11.1)
docker compose exec -T api printenv TRUST_PROXY
# Route de collecte exclue du journal d'accès Nginx (déjà appliqué le 22/11/2026)
nginx -T 2>/dev/null | grep -A4 'location = /api/stats/e'
# La page publiée correspond à la politique : « stats » toujours faux avant l'activation
curl -s http://127.0.0.1:3100/api/site/content | grep -o '"stats":[a-z]*'
```

## 3. Activation (API seule ; sauvegarde du fichier d'environnement d'abord)
```bash
cp -p /etc/devis-vectis/api.env /root/backups-devis-vectis/api.env.$(date +%F-%H%M)   # copie ; ne pas l'afficher
# Si la ligne existe déjà :
sed -i 's/^STATS_ENABLED=.*/STATS_ENABLED=true/' /etc/devis-vectis/api.env
# Sinon (le compte du contrôle ci-dessus vaut 0) :
echo 'STATS_ENABLED=true' >> /etc/devis-vectis/api.env
cd /opt/devis-vectis && docker compose up -d --no-deps api      # service api uniquement
```
Aucune commande Docker globale, aucun volume touché.

## 4. Vérification après activation
```bash
curl -s http://127.0.0.1:3100/api/health
curl -s http://127.0.0.1:3100/api/site/content | grep -o '"stats":[a-z]*'      # attendu : "stats":true
docker compose logs --tail=50 api                                               # aucune donnée personnelle attendue
```
Dans un navigateur : le panneau s'affiche à la première visite ; aucun appel à `/api/stats/e` avant « Tout accepter » (onglet Réseau) ; après acceptation, premiers événements puis tableau de bord (icône Statistiques, connexion administrateur habituelle).

## 5. Retour arrière
Remettre `STATS_ENABLED=false` (ou supprimer la ligne) puis `docker compose up -d --no-deps api` : plus de panneau, plus de collecte (`"stats":false`).

## 6. Rappels
- Les données sont **pseudonymisées**, jamais anonymes : aucun visiteur n'est identifié par son nom, son e-mail ou son identité.
- Aucun chiffre de visiteurs n'existe avant l'activation et les premières visites consenties.
