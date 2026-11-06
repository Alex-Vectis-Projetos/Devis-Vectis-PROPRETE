#!/usr/bin/env bash
# Préparation UNIQUE du serveur pour l'API Devis VECTIS. À exécuter en root, une seule fois :
#   sudo bash /opt/devis-vectis/deploy/setup-server.sh
# Idempotent. Ne touche à aucun autre service ni projet. Ne lit ni n'affiche aucun secret.
set -euo pipefail

APP=/opt/devis-vectis
DOMAIN=devis.mrprop.fr
SVC=devis-vectis-api
ENV_DIR=/etc/devis-vectis
ENV_FILE=$ENV_DIR/api.env
DEPLOY_USER=${DEPLOY_USER:-devis-deploy}
SNIPPET=/etc/nginx/snippets/devis-vectis-api.conf

[ "$(id -u)" -eq 0 ] || { echo "Exécutez ce script en root (sudo)."; exit 1; }
command -v node >/dev/null || { echo "Node.js introuvable"; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo "Node.js >= 20 requis"; exit 1; }
[ -d "$APP/server" ] || { echo "$APP/server introuvable : déployez d'abord la branche."; exit 1; }
id "$DEPLOY_USER" >/dev/null

echo "1/7 Utilisateur système dédié"
id "$SVC" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC"

echo "2/7 Dépendances de l'API"
sudo -u "$DEPLOY_USER" bash -c "cd $APP/server && npm ci --omit=dev --no-audit --no-fund"

echo "3/7 Configuration (secrets hors dépôt)"
install -d -m 750 -o root -g "$SVC" "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<ENVEOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3100
PUBLIC_ORIGIN=https://$DOMAIN
DB_PATH=/var/lib/devis-vectis/devis.db
ADMIN_EMAILS=vectis.adm@hotmail.com
MAIL_SENDER=vectis.adm@hotmail.com
COOKIE_SECURE=true
SESSION_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n=+/')
# Identifiant (client) de l'application Microsoft Entra — à renseigner, voir README
MS_CLIENT_ID=
MS_TENANT=consumers
ENVEOF
  echo "   api.env créé (SESSION_SECRET généré localement, jamais affiché)."
else
  echo "   api.env existe déjà : conservé tel quel."
fi
chown root:"$SVC" "$ENV_FILE"; chmod 640 "$ENV_FILE"

echo "4/7 Service systemd"
install -m 644 "$APP/deploy/$SVC.service" /etc/systemd/system/$SVC.service
systemctl daemon-reload
systemctl enable $SVC >/dev/null

echo "5/7 Droit minimal de redémarrage pour le déploiement automatique"
SYSTEMCTL=$(command -v systemctl)
echo "$DEPLOY_USER ALL=(root) NOPASSWD: $SYSTEMCTL restart $SVC, $SYSTEMCTL is-active $SVC" > /etc/sudoers.d/devis-vectis-deploy
chmod 440 /etc/sudoers.d/devis-vectis-deploy
visudo -cf /etc/sudoers.d/devis-vectis-deploy >/dev/null

echo "6/7 Nginx (sauvegarde, test, retour arrière automatique)"
install -d /etc/nginx/snippets
install -m 644 "$APP/deploy/nginx-devis-vectis-api.conf" "$SNIPPET"
VHOST=$(grep -RIl --include='*' -E "server_name[^;]*\b$DOMAIN\b" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -n1 || true)
[ -n "$VHOST" ] || { echo "Vhost de $DOMAIN introuvable dans /etc/nginx."; exit 1; }
VHOST=$(readlink -f "$VHOST")
if grep -q "snippets/devis-vectis-api.conf" "$VHOST"; then
  echo "   include déjà présent dans $VHOST"
else
  BACKUP="$VHOST.bak-devis-vectis-$(date +%Y%m%d%H%M%S)"
  cp -p "$VHOST" "$BACKUP"
  python3 - "$VHOST" <<'PYEOF'
import re, sys
path = sys.argv[1]
src = open(path).read()
inc = "    include /etc/nginx/snippets/devis-vectis-api.conf;\n"
out, i, done = [], 0, False
# insère l'include juste après l'ouverture du bloc server qui écoute en 443 pour ce domaine
for m in re.finditer(r'\bserver\s*\{', src):
    start = m.end(); depth = 1; j = start
    while depth and j < len(src):
        depth += {'{': 1, '}': -1}.get(src[j], 0); j += 1
    block = src[start:j]
    if 'devis.mrprop.fr' in block and re.search(r'listen\s+[^;]*443', block) and not done:
        out.append(src[i:start] + "\n" + inc); i = start; done = True
out.append(src[i:])
if not done:
    sys.exit("bloc HTTPS introuvable")
open(path, 'w').write(''.join(out))
PYEOF
  if nginx -t 2>/tmp/nginx-test.log; then
    systemctl reload nginx
    echo "   Nginx rechargé. Sauvegarde : $BACKUP"
  else
    cp -p "$BACKUP" "$VHOST"
    cat /tmp/nginx-test.log; echo "nginx -t a échoué : configuration restaurée."; exit 1
  fi
fi

echo "7/7 Démarrage"
chmod o-rwx "$APP/.git" 2>/dev/null || true
if grep -q '^MS_CLIENT_ID=.\+' "$ENV_FILE"; then :; else echo "   MS_CLIENT_ID vide : l'API démarre, l'envoi d'e-mail restera inactif jusqu'à sa configuration."; fi
systemctl restart $SVC
sleep 2
systemctl is-active $SVC
curl -fsS http://127.0.0.1:3100/api/health && echo
echo "Terminé."
