#!/usr/bin/env bash
# Préparation du serveur pour l'API Devis VECTIS. À exécuter en root, depuis une COPIE appartenant à root :
#
#   sudo install -d -m 700 /root/devis-setup
#   sudo cp /opt/devis-vectis/deploy/{setup-server.sh,nginx-insert.py,devis-vectis-api.service,nginx-devis-vectis-api.conf} /root/devis-setup/
#   sudo DEVIS_ADMIN_EMAIL='adresse.admin@exemple.fr' bash /root/devis-setup/setup-server.sh --check   # aucun changement
#   sudo DEVIS_ADMIN_EMAIL='adresse.admin@exemple.fr' bash /root/devis-setup/setup-server.sh           # installation
#
# Le script refuse de s'exécuter si ses fichiers sources ne sont pas la propriété de root ou sont modifiables
# par d'autres : le compte de déploiement (devis-deploy) ne doit jamais pouvoir influencer ce que root exécute.
# Idempotent. Ne touche à aucun autre site ni service. N'affiche aucun secret.
set -Eeuo pipefail
umask 077

MODE=install
case "${1:-}" in
  "") ;;
  --check) MODE=check ;;
  *) echo "Usage: $0 [--check]" >&2; exit 2 ;;
esac

# --- chemins (modifiables UNIQUEMENT pour les tests automatisés) ---
APP=/opt/devis-vectis
NGINX_DIR=/etc/nginx
SUDOERS_DIR=/etc/sudoers.d
SYSTEMD_DIR=/etc/systemd/system
ENV_DIR=/etc/devis-vectis
if [ "${DEVIS_SETUP_TEST:-}" = 1 ]; then
  # Le mode test déplace tous les chemins et désactive le contrôle du propriétaire : il n'a aucune raison
  # d'exister pour root, et ne doit jamais s'activer lors d'une vraie installation.
  if [ "$EUID" -eq 0 ]; then
    echo "ERREUR : DEVIS_SETUP_TEST=1 est refusé pour root (mode réservé aux tests non privilégiés)." >&2
    exit 1
  fi
  APP=${T_APP:-$APP}; NGINX_DIR=${T_NGINX_DIR:-$NGINX_DIR}; SUDOERS_DIR=${T_SUDOERS_DIR:-$SUDOERS_DIR}
  SYSTEMD_DIR=${T_SYSTEMD_DIR:-$SYSTEMD_DIR}; ENV_DIR=${T_ENV_DIR:-$ENV_DIR}; T_GROUP=${T_GROUP:-}
  OWNER_UID=${T_OWNER_UID:-0}; OWNER_NAME=${T_OWNER_NAME:-root}; OWNER_GROUP=${T_OWNER_GROUP:-root}
fi
OWNER_UID=${OWNER_UID:-0}; OWNER_NAME=${OWNER_NAME:-root}; OWNER_GROUP=${OWNER_GROUP:-root}
DOMAIN=devis.mrprop.fr
SVC=devis-vectis-api
SVC_GROUP=${T_GROUP:-$SVC}
ENV_FILE=$ENV_DIR/api.env
DEPLOY_USER=${DEVIS_DEPLOY_USER:-devis-deploy}
SNIPPET=$NGINX_DIR/snippets/devis-vectis-api.conf
SRC_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

TMP=$(mktemp -d)
NGINX_DIRTY=0
VHOST=""; VHOST_PREV=""; SNIPPET_PREV=""; SNIPPET_HAD=0; BACKUP=""; VHOST_WRITTEN=0

log()  { printf '%s\n' "$*"; }
die()  { printf 'ERREUR : %s\n' "$*" >&2; exit 1; }

nginx_restore() {
  [ "$NGINX_DIRTY" = 1 ] || return 0
  log "   Retour arrière de la configuration Nginx…"
  if [ -n "$VHOST" ] && [ -f "$VHOST_PREV" ]; then
    if [ "$VHOST_WRITTEN" = 1 ] && ! cmp -s "$VHOST" "$TMP/vhost.apply"; then
      log "   Le vhost a été modifié par ailleurs depuis notre écriture : laissé tel quel (instantané : $VHOST_PREV)."
      cp -p "$VHOST_PREV" "$VHOST.devis-vectis-snapshot" 2>/dev/null || true
    elif [ "$VHOST_WRITTEN" = 1 ]; then
      cat "$VHOST_PREV" > "$VHOST"
    fi
  fi
  if [ "$SNIPPET_HAD" = 1 ]; then cat "$SNIPPET_PREV" > "$SNIPPET"; else rm -f "$SNIPPET"; fi
  NGINX_DIRTY=0
  if nginx -t >/dev/null 2>&1; then log "   Configuration d'origine restaurée et valide."; else log "   ATTENTION : nginx -t échoue même après restauration (état antérieur au script ?)."; fi
}
cleanup() { local rc=$?; trap - EXIT; nginx_restore || true; rm -rf "$TMP"; exit "$rc"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

# ------------------------------------------------------------------ 0. contrôles préalables
log "0/7 Contrôles préalables ($MODE)"
[ "$(id -u)" -eq "$OWNER_UID" ] || die "exécuter en root (sudo)."
command -v node >/dev/null || die "Node.js introuvable."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node.js >= 20 requis."
command -v nginx >/dev/null || die "nginx introuvable."
command -v python3 >/dev/null || die "python3 introuvable."
[ -f "$APP/server/package-lock.json" ] || die "$APP/server introuvable : déployez d'abord le code."
# Validation stricte AVANT tout usage dans un fichier de configuration (sudoers, api.env, commandes).
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || die "nom d'utilisateur de déploiement invalide (attendu : ^[a-z_][a-z0-9_-]{0,31}\$)."
[ "$DEPLOY_USER" != root ] || die "l'utilisateur de déploiement ne peut pas être root."
id "$DEPLOY_USER" >/dev/null 2>&1 || die "utilisateur $DEPLOY_USER introuvable."

for f in setup-server.sh nginx-insert.py devis-vectis-api.service nginx-devis-vectis-api.conf; do
  [ -f "$SRC_DIR/$f" ] || die "fichier source manquant : $SRC_DIR/$f"
  owner=$(stat -c %u "$SRC_DIR/$f"); mode=$(stat -c %a "$SRC_DIR/$f")
  [ "$owner" = "$OWNER_UID" ] || die "$SRC_DIR/$f n'appartient pas à root : utilisez une copie root (voir l'en-tête du script)."
  case "$mode" in *[2367]?|*[2367]) die "$SRC_DIR/$f est modifiable par d'autres (mode $mode).";; esac
done
dir_owner=$(stat -c %u "$SRC_DIR"); dir_mode=$(stat -c %a "$SRC_DIR")
[ "$dir_owner" = "$OWNER_UID" ] || die "$SRC_DIR n'appartient pas à root."
case "$dir_mode" in *[2367]?|*[2367]) die "$SRC_DIR est modifiable par d'autres (mode $dir_mode).";; esac
log "   Sources root-only vérifiées. Empreintes :"
(cd "$SRC_DIR" && sha256sum setup-server.sh nginx-insert.py devis-vectis-api.service nginx-devis-vectis-api.conf | sed 's/^/   /')

NEW_ENV=0
if [ ! -f "$ENV_FILE" ]; then
  NEW_ENV=1
  ADMIN_EMAIL=${DEVIS_ADMIN_EMAIL:-}
  ADMIN_EMAIL=${ADMIN_EMAIL,,}
  # Liste blanche stricte de caractères : l'adresse est écrite dans api.env (lu par systemd) et n'est jamais interprétée.
  [ "${#ADMIN_EMAIL}" -le 254 ] \
    && [[ "$ADMIN_EMAIL" =~ ^[a-z0-9._%+-]{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] \
    || die "première installation : DEVIS_ADMIN_EMAIL=<adresse administrateur valide> requis (lettres, chiffres et . _ % + - uniquement ; aucune adresse n'est stockée dans le dépôt)."
fi

# Nginx : repérer le vhost de CE domaine uniquement, et exiger une configuration saine avant toute modification.
VHOST=$(grep -RIlE "server_name[^;]*[[:space:]]$DOMAIN([[:space:];])" "$NGINX_DIR/sites-enabled" "$NGINX_DIR/conf.d" 2>/dev/null | head -n1 || true)
[ -n "$VHOST" ] || die "vhost de $DOMAIN introuvable dans $NGINX_DIR."
VHOST=$(readlink -f "$VHOST")
nginx -t >/dev/null 2>"$TMP/nginx-baseline.log" || { cat "$TMP/nginx-baseline.log" >&2; die "nginx -t échoue AVANT toute modification : rien n'est touché."; }
python3 -I "$SRC_DIR/nginx-insert.py" "$VHOST" "$TMP/vhost.check" "$DOMAIN" "$SNIPPET" && INS=0 || INS=$?
case "$INS" in 0|10) ;; *) die "impossible de préparer le vhost (code $INS).";; esac   # simple contrôle : recalculé à l'étape 6

SUDO_RULE_FILE="$TMP/sudoers"
SYSTEMCTL=$(command -v systemctl) || die "systemctl introuvable."
[[ "$SYSTEMCTL" =~ ^/[A-Za-z0-9/._-]+$ ]] || die "chemin de systemctl inattendu."
printf '%s ALL=(root) NOPASSWD: %s restart %s, %s is-active %s\n' "$DEPLOY_USER" "$SYSTEMCTL" "$SVC" "$SYSTEMCTL" "$SVC" > "$SUDO_RULE_FILE"
visudo -cf "$SUDO_RULE_FILE" >/dev/null || die "règle sudoers invalide : rien n'est installé."
VISUDO_BASE=0; visudo -c -q >/dev/null 2>&1 || VISUDO_BASE=$?

log "   Vhost cible : $VHOST (include $( [ "$INS" = 10 ] && echo déjà présent || echo à ajouter ))"
if [ "$MODE" = check ]; then
  log "Mode --check : toutes les validations sont passées, aucun changement effectué."
  exit 0
fi

# ------------------------------------------------------------------ 1. utilisateur
log "1/7 Utilisateur système dédié"
id "$SVC" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SVC"

# ------------------------------------------------------------------ 2. dépendances
log "2/7 Dépendances de l'API (installées par $DEPLOY_USER, pas par root)"
runuser -u "$DEPLOY_USER" -- bash -c "cd '$APP/server' && npm ci --omit=dev --no-audit --no-fund" >"$TMP/npm.log" 2>&1 \
  || { tail -n 15 "$TMP/npm.log" >&2; die "npm ci a échoué."; }
runuser -u "$SVC" -- test -r "$APP/server/src/index.js" || die "$SVC ne peut pas lire $APP/server (permissions)."

# ------------------------------------------------------------------ 3. configuration
log "3/7 Configuration (secrets hors dépôt)"
install -d -m 750 -o "$OWNER_NAME" -g "$SVC_GROUP" "$ENV_DIR"
rand() { head -c "$1" /dev/urandom | base64 | tr -d '\n=+/'; }
if [ "$NEW_ENV" = 1 ]; then
  {
    echo "NODE_ENV=production"
    echo "HOST=127.0.0.1"
    echo "PORT=3100"
    echo "PUBLIC_ORIGIN=https://$DOMAIN"
    echo "DB_PATH=/var/lib/devis-vectis/devis.db"
    echo "ADMIN_EMAILS=$ADMIN_EMAIL"
    echo "MAIL_SENDER=$ADMIN_EMAIL"
    echo "COOKIE_SECURE=true"
    echo "SESSION_SECRET=$(rand 48)"
    echo "# Jeton à saisir une seule fois dans le site pour autoriser la messagerie (lire : sudo grep MAIL_SETUP_TOKEN $ENV_FILE)"
    echo "MAIL_SETUP_TOKEN=$(rand 32)"
    echo "# ID d'application Microsoft Entra, à renseigner (voir deploy/README-AUTH.md)"
    echo "MS_CLIENT_ID="
    echo "MS_TENANT=consumers"
  } > "$TMP/api.env"
  install -m 640 -o "$OWNER_NAME" -g "$SVC_GROUP" "$TMP/api.env" "$ENV_FILE"
  log "   api.env créé (secrets générés ici, jamais affichés)."
else
  log "   api.env existe : conservé. Clés manquantes ajoutées sans toucher aux autres."
  grep -q '^MAIL_SETUP_TOKEN=' "$ENV_FILE" || printf 'MAIL_SETUP_TOKEN=%s\n' "$(rand 32)" >> "$ENV_FILE"
  grep -q '^MS_TENANT=' "$ENV_FILE" || echo 'MS_TENANT=consumers' >> "$ENV_FILE"
  chown "$OWNER_NAME":"$SVC_GROUP" "$ENV_FILE"; chmod 640 "$ENV_FILE"
fi

# ------------------------------------------------------------------ 4. systemd
log "4/7 Service systemd"
install -m 644 "$SRC_DIR/$SVC.service" "$SYSTEMD_DIR/.$SVC.service.tmp"
mv -f "$SYSTEMD_DIR/.$SVC.service.tmp" "$SYSTEMD_DIR/$SVC.service"
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null

# ------------------------------------------------------------------ 5. sudoers
log "5/7 Droit minimal de redémarrage du service (validé avant installation)"
install -d -m 750 "$SUDOERS_DIR" 2>/dev/null || true
# Nom commençant par un point : ignoré par sudo tant que le fichier n'est pas validé et renommé.
install -m 440 -o "$OWNER_NAME" -g "$OWNER_GROUP" "$SUDO_RULE_FILE" "$SUDOERS_DIR/.devis-vectis-deploy.tmp"
visudo -cf "$SUDOERS_DIR/.devis-vectis-deploy.tmp" >/dev/null || { rm -f "$SUDOERS_DIR/.devis-vectis-deploy.tmp"; die "sudoers invalide : non installé."; }
mv -f "$SUDOERS_DIR/.devis-vectis-deploy.tmp" "$SUDOERS_DIR/devis-vectis-deploy"
if [ "$VISUDO_BASE" = 0 ] && ! visudo -c -q >/dev/null 2>&1; then
  rm -f "$SUDOERS_DIR/devis-vectis-deploy"
  die "la configuration sudo globale est devenue invalide : règle retirée."
fi

# ------------------------------------------------------------------ 6. nginx
log "6/7 Nginx (validation à chaque exécution, retour arrière automatique)"
install -d -m 755 "$NGINX_DIR/snippets"
VHOST_PREV="$TMP/vhost.prev"; cp -p "$VHOST" "$VHOST_PREV"
if [ -f "$SNIPPET" ]; then SNIPPET_HAD=1; SNIPPET_PREV="$TMP/snippet.prev"; cp -p "$SNIPPET" "$SNIPPET_PREV"; fi
# La modification du vhost est CALCULÉE ICI, à partir de l'instantané qui sert aussi au retour arrière :
# ce que le script écrit est exactement « instantané + include », jamais une copie ancienne prise avant le
# `npm ci` (qui peut durer des minutes pendant lesquelles le vhost a pu être modifié par ailleurs).
python3 -I "$SRC_DIR/nginx-insert.py" "$VHOST_PREV" "$TMP/vhost.apply" "$DOMAIN" "$SNIPPET" && INS=0 || INS=$?
case "$INS" in 0|10) ;; *) die "impossible de préparer le vhost (code $INS) : rien n'a été modifié.";; esac
CHANGED=0
cmp -s "$SRC_DIR/nginx-devis-vectis-api.conf" "$SNIPPET" 2>/dev/null || CHANGED=1
[ "$INS" = 0 ] && CHANGED=1

if [ "$CHANGED" = 1 ]; then
  BACKUP="$VHOST.bak-devis-vectis-$(date +%Y%m%d%H%M%S)"
  cp -p "$VHOST" "$BACKUP"
  NGINX_DIRTY=1
  cat "$SRC_DIR/nginx-devis-vectis-api.conf" > "$SNIPPET.tmp"; chmod 644 "$SNIPPET.tmp"; mv -f "$SNIPPET.tmp" "$SNIPPET"
  if [ "$INS" = 0 ]; then
    # Dernier contrôle : si le vhost a encore changé depuis l'instantané, on n'écrase rien.
    cmp -s "$VHOST" "$VHOST_PREV" || die "le vhost a été modifié pendant l'installation : aucune écriture, relancez le script."
    cat "$TMP/vhost.apply" > "$VHOST"
    VHOST_WRITTEN=1
  fi
fi
# nginx -t à TOUTE exécution, y compris quand rien n'a changé.
if ! nginx -t 2>"$TMP/nginx-test.log"; then
  cat "$TMP/nginx-test.log" >&2
  nginx_restore
  die "nginx -t a échoué : configuration restaurée, rien n'a été rechargé."
fi
if [ "$CHANGED" = 1 ]; then
  if ! systemctl reload nginx; then
    nginx_restore; systemctl reload nginx || true
    die "reload de Nginx refusé : configuration restaurée."
  fi
  NGINX_DIRTY=0
  log "   Nginx rechargé. Sauvegarde du vhost : $BACKUP"
else
  log "   Nginx déjà à jour (nginx -t : OK, aucun rechargement nécessaire)."
fi

# ------------------------------------------------------------------ 7. démarrage
log "7/7 Démarrage"
chmod o-rwx "$APP/.git" 2>/dev/null || log "   (chmod du .git ignoré)"
grep -q '^MS_CLIENT_ID=.\+' "$ENV_FILE" || log "   MS_CLIENT_ID vide : l'API démarre, l'envoi d'e-mail reste inactif tant qu'il n'est pas renseigné."
systemctl restart "$SVC"
sleep 2
if ! systemctl is-active --quiet "$SVC"; then
  journalctl -u "$SVC" -n 20 --no-pager >&2 || true
  die "le service ne démarre pas (journal ci-dessus)."
fi
ok=0
for _ in 1 2 3 4 5 6 7 8; do curl -fsS http://127.0.0.1:3100/api/health >/dev/null 2>&1 && { ok=1; break; }; sleep 1; done
[ "$ok" = 1 ] || die "l'API ne répond pas sur 127.0.0.1:3100."
log "   Service actif, /api/health : OK."
log "Terminé."
