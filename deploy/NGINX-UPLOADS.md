# Nginx : limites d'envoi de fichiers (à appliquer sur la VPS)

Le déploiement automatique (`deploy.yml`) met à jour le code et le conteneur de l'API, **jamais le vhost Nginx**.
Constat en production (sondes du 12/11/2026) : `POST /api/admin/site/assets` et `POST /api/quotes…` reçoivent
**HTTP 413 (page HTML Nginx) dès 30 Ko** → le vhost n'a que `location ^~ /api/ { client_max_body_size 8k; }`.

## Politique de limites (une valeur par couche)

| Couche | Route | Limite |
|---|---|---|
| Navigateur (devis) | photos | 10 fichiers/propriété, 40 par demande, 20 propriétés, 10 Mo par fichier d'origine ; allègement auto > 2,5 Mo ou > 3200 px (JPEG 2560 px max, q 0,86), original conservé sur l'appareil |
| Nginx | `/api/quotes*` | `client_max_body_size 11m` (une photo par requête) |
| Nginx | `/api/admin/site/*` | `client_max_body_size 11m` (déjà dans `nginx-devis-vectis-api.conf`) |
| Nginx | reste de `/api/` | `8k` (inchangé) |
| Fastify | `POST /api/quotes` | corps JSON 128 Ko |
| Fastify | `POST /api/quotes/:id/photos` | 10 Mo + 1 Ko, signature JPG/PNG/WEBP contrôlée ; total par demande 150 Mo ; débit par IP |
| Fastify | `POST /api/quotes/:id/finalize` | 2 Ko |
| Fastify | `POST /api/admin/site/assets` | 10 Mo (+ session et CSRF vérifiés avant lecture du corps) |
| Gmail | e-mails | pièces jointes réparties en e-mails de 12 Mo max. |

## Procédure (sudo requis ; ne pas utiliser `setup-server.sh`)

1. Sauvegarde du vhost : `sudo cp /etc/nginx/sites-available/<vhost devis> /var/backups/devis-vectis/<vhost>.$(date +%F-%H%M).bak`
2. Dans le `server { }` HTTPS de `devis.mrprop.fr`, ajouter **uniquement** les deux blocs
   `location ^~ /api/admin/site/ { … }` et `location ^~ /api/quotes { … }` copiés tels quels de
   `deploy/nginx-devis-vectis-api.conf` (ils ont `client_max_body_size 11m`). Ne pas toucher `location ^~ /api/` (8k).
   L'ordre n'importe pas : `^~` avec le préfixe le plus long l'emporte.
3. `sudo nginx -t` → doit afficher `syntax is ok` / `test is successful`.
4. `sudo systemctl reload nginx` (rechargement seul ; pas de redémarrage, pas de Docker).
5. Vérifier : un envoi de 30 Ko vers `/api/quotes/<id>/photos` ne doit plus renvoyer la page HTML 413 (l'API répond en JSON).
   En cas de problème : restaurer la sauvegarde puis `sudo nginx -t && sudo systemctl reload nginx`.
