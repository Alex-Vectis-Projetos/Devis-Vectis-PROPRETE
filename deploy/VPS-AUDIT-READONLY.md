# Audit du VPS — commandes en LECTURE SEULE (à exécuter par l'administrateur)

Objectif : prouver ce que le dépôt ne peut pas prouver (`deploy/UPLOADS-AUDIT.md` §4 « Non prouvé »). **Aucune commande ne modifie Nginx, Docker, un volume, la base ou un fichier** :
pas de `reload`/`restart`/`rm`/`chmod`/`chown`/`prune`/`down`, pas d'écriture dans les dossiers du projet. Ne pas coller de secrets (`/etc/devis-vectis/api.env` n'est jamais lu).
À exécuter en `sudo` quand indiqué. Envoyer les sorties (adresses IP de visiteurs à masquer si une ligne de log est copiée).

## A. Configuration Nginx effective de devis.mrprop.fr

```bash
# A1. Fichiers où devis.mrprop.fr est déclaré
sudo nginx -T 2>/dev/null | awk '/^# configuration file /{f=$0} /server_name[^;]*devis\.mrprop\.fr/{print f " -> " $0}'

# A2. Racine, alias, listage de dossier, repli de fichiers, références aux uploads ou au volume (toute la configuration chargée)
sudo nginx -T 2>/dev/null | grep -nE '^\s*(root|alias|autoindex|try_files)\b|uploads|devis_vectis|/var/lib/(docker|devis-vectis)'

# A3. Le bloc exact de la route de statistiques (déjà appliqué selon l'administrateur, 22/11/2026)
sudo nginx -T 2>/dev/null | grep -n -A8 'location = /api/stats/e'

# A4. Validité (sans rechargement)
sudo nginx -t
```
Résultat attendu : A1 liste un fichier de `sites-enabled` ; A2 montre `root /opt/devis-vectis` (ou équivalent) pour ce site, **aucun** `alias`, **aucun** `autoindex on`, **aucune** ligne contenant `uploads`, `devis_vectis` ou `/var/lib/devis-vectis` ; A3 montre `access_log off;` ; A4 « syntax is ok / test is successful ».
Anomalie à signaler : tout `alias` ou `root` pointant vers `/var/lib/docker/volumes/...` ou `.../uploads`.

## B. Exposition publique de `uploads/quotes` (depuis n'importe quel poste, lecture HTTP seule)

```bash
for p in uploads/ uploads/quotes/ var/lib/devis-vectis/uploads/quotes/ api/site/assets/00000000000000000000000000000000 zz-chemin-inexistant; do
  printf '%s -> ' "$p"; curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "https://devis.mrprop.fr/$p"
done
```
Résultat attendu : tous les chemins renvoient le même code que `zz-chemin-inexistant` (404, ou la page d'accueil si un repli existe : dans ce cas le type est `text/html`) ; aucun `image/*`, aucun listage de dossier.

## C. Permissions réelles du volume `devis_vectis_data`

```bash
# C1. Emplacement et propriétaire
MP=$(docker volume inspect devis_vectis_data --format '{{.Mountpoint}}'); echo "$MP"
sudo stat -c '%A %U:%G %n' "$MP" "$MP/uploads" "$MP/uploads/quotes"

# C2. Dossiers et fichiers : modes présents (comptage, sans lister de noms)
sudo find "$MP/uploads" -type d -printf '%m %u:%g\n' | sort | uniq -c
sudo find "$MP/uploads/quotes" -type f -printf '%m %u:%g\n' | sort | uniq -c
sudo du -sh "$MP/uploads" "$MP/uploads/quotes"

# C3. Vue depuis le conteneur
docker exec devis-vectis-api id
docker exec devis-vectis-api ls -ld /var/lib/devis-vectis /var/lib/devis-vectis/uploads /var/lib/devis-vectis/uploads/quotes

# C4. Quels conteneurs montent ce volume (lecture des montages uniquement)
docker ps -q | xargs -r docker inspect --format '{{.Name}} {{range .Mounts}}{{.Name}} {{end}}' | grep devis_vectis_data
```
Résultat attendu : propriétaire = l'utilisateur `node` du conteneur (uid souvent 1000) ; `uploads` et `uploads/quotes` en `700`, fichiers de photos en `600` ; **aucun mode avec droits pour « autres »** (dernier chiffre non nul) ; C4 ne liste que `/devis-vectis-api`. Le dossier parent `/var/lib/docker/volumes` est normalement en `710` root.

## D. Journaux Nginx et Docker

```bash
# D1. Journaux déclarés par Nginx (site et global)
sudo nginx -T 2>/dev/null | grep -nE '^\s*(access_log|error_log)\b'
sudo ls -l --time-style=long-iso /var/log/nginx/

# D2. Date du plus ancien journal conservé (durée effective)
sudo ls -ltr --time-style=long-iso /var/log/nginx/ | head -4

# D3. Docker : pilote, options de rotation, fichier de log du conteneur
docker info --format 'driver={{.LoggingDriver}}'
docker inspect devis-vectis-api --format '{{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}'
sudo ls -l --time-style=long-iso "$(docker inspect devis-vectis-api --format '{{.LogPath}}')"
sudo grep -n 'log' /etc/docker/daemon.json 2>/dev/null || echo "pas de réglage de log dans daemon.json"
```
Résultat attendu : `access_log off` seulement pour `/api/stats/e` ; `/var/log/nginx/access.log` et `error.log` présents ; Docker en `json-file`. **Si `max-size`/`max-file` sont absents, les journaux Docker ne tournent pas** (conservation illimitée) : à signaler (marqueur P10).

## E. Rotation des journaux (simulation, sans rotation réelle)

```bash
cat /etc/logrotate.d/nginx
sudo logrotate -d /etc/logrotate.d/nginx 2>&1 | head -40     # -d = débogage, aucune rotation n'est effectuée
sudo ls -l /var/log/nginx/*.gz 2>/dev/null | head -5
grep -nE '^(daily|weekly|monthly|rotate|compress|maxage)' /etc/logrotate.conf
```
Résultat attendu : directives `daily`/`weekly` et `rotate N` (durée ≈ N jours ou semaines) pour Nginx ; la durée effective de conservation est le produit période × N. Reporter ces valeurs (marqueurs P9 et P10).

## F. En-têtes `Set-Cookie` en production (marqueur C2)

```bash
for u in / /api/site/content /api/health /index.html; do
  echo "== $u"; curl -s -D - -o /dev/null "https://devis.mrprop.fr$u" | grep -i '^set-cookie' || echo "(aucun Set-Cookie)"
done
```
Résultat attendu : « (aucun Set-Cookie) » pour toutes les URL publiques. Le cookie `__Host-vectis_admin` n'apparaît qu'après une connexion administrateur réussie (ne pas se connecter pour ce test).

## G. Indice sur l'entité d'hébergement (indicatif, ne remplace pas le contrat)

```bash
whois "$(dig +short devis.mrprop.fr | tail -1)" | grep -iE 'orgname|org-name|netname|address|country|abuse'
```
Le propriétaire du bloc d'adresses peut aider à retrouver l'entité, mais **la raison sociale, l'adresse et le téléphone à publier (M3-M5, P4) doivent venir de la facture ou des conditions de service Hostinger**.

## Retour attendu
Pour chaque section : sortie brute (sans secret), et mention « conforme à l'attendu » ou l'écart constaté. Les résultats servent à fermer P9, P10, C2 et la section « Non prouvé » de `deploy/UPLOADS-AUDIT.md`.
