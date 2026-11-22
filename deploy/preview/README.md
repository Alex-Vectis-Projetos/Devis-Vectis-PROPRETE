# Preview « Statistiques » — roteiro de mise en place

Projet Docker **séparé** (`vectis-preview`), port `127.0.0.1:3101`, réseau `172.28.77.0/24`, volume `vectis_preview_data`. Rien n'est partagé avec la production
(`/opt/devis-vectis`, `/etc/devis-vectis`, `devis-vectis-api`, `devis_vectis_data`, `devis_vectis_network`, port 3100, vhost `devis.mrprop.fr`).
Aucune commande Docker globale (`prune`, `system`, `volume rm`, `compose down -v`) n'est utilisée.

## Fase 1 — conteneur local (aucune exposition publique)
```
# 1. Contrôles (lecture seule) — tout doit être « libre » ; sinon arrêter.
sudo ss -ltnp | grep -E ':3101\b' || echo "3101 libre"
docker network ls --format '{{.Name}}' | grep -x vectis_preview_network || echo "réseau preview absent (normal)"
docker network inspect $(docker network ls -q) --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' | tr ' ' '\n' | grep -E '^172\.28\.77\.' || echo "172.28.77.0/24 libre"
ip route | grep -E '172\.28\.77\.' || echo "aucune route 172.28.77.0/24"
docker volume ls --format '{{.Name}}' | grep -x vectis_preview_data || echo "volume preview absent (normal)"
docker ps -a --format '{{.Names}}' | grep -x devis-vectis-preview-api || echo "conteneur preview absent (normal)"

# 2. Clone séparé de la branche (jamais dans /opt/devis-vectis).
sudo git clone --branch feat/stats-2-dashboard --single-branch "$(git -C /opt/devis-vectis remote get-url origin)" /opt/devis-vectis-preview
git -C /opt/devis-vectis-preview rev-parse --short HEAD     # doit afficher f923906 (ou plus récent validé)

# 3. Environnement du preview (valeurs de test, 0600, jamais committé).
sudo install -d -m 0750 /etc/devis-vectis-preview
sudo sh -c 'umask 077; printf "SESSION_SECRET=%s\nADMIN_EMAILS=preview-admin@preview.invalid\n" "$(openssl rand -hex 32)" > /etc/devis-vectis-preview/api.env'

# 4. Mot de passe d'accès (saisi au terminal, jamais dans l'historique).
sudo sh -c 'umask 027; printf "preview:%s\n" "$(openssl passwd -apr1)" > /etc/nginx/preview-stats.htpasswd'
sudo chgrp www-data /etc/nginx/preview-stats.htpasswd && sudo chmod 640 /etc/nginx/preview-stats.htpasswd   # groupe = utilisateur nginx vérifié

# 5. Conteneur (projet isolé).
cd /opt/devis-vectis-preview
docker compose -p vectis-preview -f deploy/preview/docker-compose.preview.yml config -q && echo "compose valide"
docker compose -p vectis-preview -f deploy/preview/docker-compose.preview.yml up -d --build

# 6. Vérifications locales.
curl -s http://127.0.0.1:3101/api/health                       # {"ok":true}
curl -s http://127.0.0.1:3101/api/site/content | head -c 200   # "stats":false
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3101/api/admin/stats/status   # 401
docker inspect devis-vectis-preview-api --format '{{.State.Status}} {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'   # running vectis_preview_network
```

## Fases suivantes (autorisation spécifique pour chacune)
2. DNS : `A preview-stats.mrprop.fr → 72.62.27.129` (TTL 300), pas d'AAAA.
3. Nginx phase A (`nginx-preview-stats-http.conf`) + `certbot certonly --webroot -w /var/www/html -d preview-stats.mrprop.fr`.
4. Nginx phase B (`nginx-preview-stats.conf`) : `nginx -t` puis `reload`.
5. Validation visuelle (login de test, icône du dock, tableau de bord simulé).

## Retour arrière (la production n'est jamais touchée)
```
cd /opt/devis-vectis-preview
docker compose -p vectis-preview -f deploy/preview/docker-compose.preview.yml down      # SANS -v : le volume est conservé
# si le vhost a été installé :
sudo rm /etc/nginx/sites-enabled/preview-stats.mrprop.fr && sudo nginx -t && sudo systemctl reload nginx
```
La suppression du volume `vectis_preview_data`, du clone, du certificat, de l'environnement et de l'enregistrement DNS n'est faite que sur autorisation expresse.
