#!/usr/bin/env bash
# Tests de deploy/setup-server.sh avec de FAUX nginx/systemctl/visudo... dans un répertoire temporaire.
# Aucun fichier système réel n'est lu ni modifié (DEVIS_SETUP_TEST=1 redirige tous les chemins).
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok - $*"; }
bad()  { FAIL=$((FAIL+1)); echo "not ok - $*"; }
check(){ local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

# B3 : le mode test doit être REFUSÉ pour root. Ce contrôle exige les droits root (direct ou via sudo -n).
root_refusal() {
  local out rc
  if [ "$(id -u)" -eq 0 ]; then
    out=$(DEVIS_SETUP_TEST=1 bash "$ROOT/deploy/setup-server.sh" --check 2>&1); rc=$?
  elif command -v sudo >/dev/null && sudo -n true 2>/dev/null; then
    out=$(sudo -n env DEVIS_SETUP_TEST=1 bash "$ROOT/deploy/setup-server.sh" --check 2>&1); rc=$?
  else
    echo "ok - B3 : refus du mode test pour root # SKIP (pas de root ni de sudo -n dans cet environnement)"; return
  fi
  check "B3 : DEVIS_SETUP_TEST=1 est refusé quand le script tourne en root (code != 0)" test $rc -ne 0
  check "B3 : message de refus explicite" bash -c "grep -q 'refusé pour root' <<<\"\$1\"" _ "$out"
  check "B3 : aucun fichier de test n'a pu être pris en compte (pas de contrôle de propriétaire contourné)" bash -c "! grep -q 'Sources root-only' <<<\"\$1\"" _ "$out"
}
[ "${1:-}" = --unprivileged ] || root_refusal
# Le reste des tests simule l'installation avec de faux binaires : il tourne SANS privilèges.
if [ "$(id -u)" -eq 0 ]; then
  command -v setpriv >/dev/null || { echo "setpriv requis pour exécuter les tests en dehors de root"; exit 1; }
  chmod -R a+rX "$ROOT" 2>/dev/null
  TESTS_PASS=$PASS; TESTS_FAIL=$FAIL
  out=$(setpriv --reuid=65534 --regid=65534 --clear-groups env HOME=/tmp TMPDIR=/tmp bash "$0" --unprivileged 2>&1); rc=$?
  printf '%s\n' "$out" | grep -v '^# '
  sub_pass=$(printf '%s\n' "$out" | sed -n 's/^# pass //p'); sub_fail=$(printf '%s\n' "$out" | sed -n 's/^# fail //p')
  echo "# pass $((TESTS_PASS + ${sub_pass:-0}))"; echo "# fail $((TESTS_FAIL + ${sub_fail:-0}))"
  [ "$TESTS_FAIL" -eq 0 ] && [ $rc -eq 0 ]; exit $?
fi
[ "${1:-}" = --unprivileged ] && PASS=0 FAIL=0
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
new_world() {   # $1 = nom
  local d=$W/$1; rm -rf "$d"; mkdir -p "$d"/{bin,app/server,app/.git,nginx/sites-available,nginx/sites-enabled,nginx/conf.d,sudoers,systemd,etc,src}
  touch "$d/app/server/package-lock.json"; mkdir -p "$d/app/server/src"; touch "$d/app/server/src/index.js"
  cp "$ROOT"/deploy/{setup-server.sh,nginx-insert.py,devis-vectis-api.service,nginx-devis-vectis-api.conf} "$d/src/"
  chmod 700 "$d/src"; chmod 644 "$d/src"/*
  cat > "$d/nginx/sites-available/devis.mrprop.fr" <<'V'
server {
    server_name devis.mrprop.fr;
    root /opt/devis-vectis;
    location / { try_files $uri $uri/ =404; }
    listen [::]:443 ssl; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/devis.mrprop.fr/fullchain.pem; # managed by Certbot
}
server {
    listen 80;
    server_name devis.mrprop.fr;
    return 301 https://$host$request_uri;
}
V
  ln -s "$d/nginx/sites-available/devis.mrprop.fr" "$d/nginx/sites-enabled/devis.mrprop.fr"
  cat > "$d/nginx/sites-available/autre-site.example" <<'V'
server { listen 443 ssl; server_name autre.example.org; root /var/www/autre; }
V
  ln -s "$d/nginx/sites-available/autre-site.example" "$d/nginx/sites-enabled/autre-site.example"
  # --- faux binaires ---
  local b=$d/bin
  cat > "$b/nginx" <<S
#!/bin/bash
echo "nginx \$*" >> "$d/calls.log"
[ -f "$d/nginx.fail" ] && grep -q 'devis-vectis-api.conf' "$d/nginx/sites-enabled/devis.mrprop.fr" && { echo "nginx: [emerg] simulated failure" >&2; exit 1; }
[ -f "$d/nginx.broken" ] && { echo "nginx: [emerg] already broken" >&2; exit 1; }
exit 0
S
  cat > "$b/systemctl" <<S
#!/bin/bash
echo "systemctl \$*" >> "$d/calls.log"
[ "\$1" = reload ] && [ -f "$d/reload.fail" ] && exit 1
exit 0
S
  cat > "$b/visudo" <<S
#!/bin/bash
echo "visudo \$*" >> "$d/calls.log"
if [ "\$1" = -cf ]; then grep -q 'NOPASSWD' "\$2" || exit 1; [ -f "$d/sudoers.invalid" ] && exit 1; fi
exit 0
S
  for n in useradd chown journalctl; do printf '#!/bin/bash\necho "%s $*" >> "%s/calls.log"\nexit 0\n' "$n" "$d" > "$b/$n"; done
  cat > "$b/runuser" <<S
#!/bin/bash
[ "\$1" = -u ] && shift 2; [ "\$1" = -- ] && shift
echo "runuser \$*" >> "$d/calls.log"
# simule une modification concurrente du vhost pendant npm ci
if [ -f "$d/edit-during-npm" ] && [[ "\$*" == *"npm ci"* ]]; then cat "$d/edit-during-npm" >> "$d/nginx/sites-available/devis.mrprop.fr"; fi
exit 0
S
  printf '#!/bin/bash\nexit 0\n' > "$b/curl"
  printf '#!/bin/bash\n[ "$1" = "-p" ] && { echo 22; exit; }\necho 22\n' > "$b/node"
  cat > "$b/id" <<'S'
#!/bin/bash
# "id <utilisateur>" : l'utilisateur existe ; toute autre forme : vrai id (uid réel du lanceur).
if [ $# -eq 1 ] && [ "${1#-}" = "$1" ]; then exit 0; fi
exec /usr/bin/id "$@"
S
  chmod +x "$b"/*
}

run_setup() {   # $1 = monde, reste = arguments
  local d=$W/$1; shift
  ( cd "$d" && env PATH="$d/bin:$PATH" DEVIS_SETUP_TEST=1 T_GROUP=$(id -gn) T_OWNER_UID=$(id -u) T_OWNER_NAME=$(id -un) T_OWNER_GROUP=$(id -gn) T_APP="$d/app" T_NGINX_DIR="$d/nginx" T_SUDOERS_DIR="$d/sudoers" \
      T_SYSTEMD_DIR="$d/systemd" T_ENV_DIR="$d/etc" DEVIS_ADMIN_EMAIL=admin@example.test bash "$d/src/setup-server.sh" "$@" ) >"$d/out.log" 2>&1
}
sum() { (cd "$1" && find nginx -type f ! -name '*.bak-devis-vectis-*' -print0 | sort -z | xargs -0 sha256sum); }

# 1. --check ne modifie rien
new_world check; before=$(sum "$W/check")
run_setup check --check; rc=$?
check "--check réussit" test $rc -eq 0
check "--check ne modifie aucun fichier" test "$before" = "$(sum "$W/check")"
check "--check ne crée ni env, ni unit, ni sudoers" test ! -e "$W/check/etc/api.env" -a ! -e "$W/check/systemd/devis-vectis-api.service" -a -z "$(ls -A "$W/check/sudoers")"

# 2. installation nominale + autres sites intacts
new_world ok; other_before=$(sha256sum "$W/ok/nginx/sites-available/autre-site.example")
run_setup ok; rc=$?
check "installation nominale réussit" test $rc -eq 0
check "include ajouté au vhost du domaine" grep -q 'include .*devis-vectis-api.conf' "$W/ok/nginx/sites-available/devis.mrprop.fr"
check "include ajouté dans le bloc 443 uniquement" test "$(grep -c 'devis-vectis-api.conf' "$W/ok/nginx/sites-available/devis.mrprop.fr")" -eq 1
check "lignes Certbot conservées" grep -q 'ssl_certificate /etc/letsencrypt/live/devis.mrprop.fr/fullchain.pem; # managed by Certbot' "$W/ok/nginx/sites-available/devis.mrprop.fr"
check "autre site strictement inchangé" test "$other_before" = "$(sha256sum "$W/ok/nginx/sites-available/autre-site.example")"
check "snippet installé" cmp -s "$ROOT/deploy/nginx-devis-vectis-api.conf" "$W/ok/nginx/snippets/devis-vectis-api.conf"
check "api.env en mode 640" test "$(stat -c %a "$W/ok/etc/api.env")" = 640
check "api.env : secrets de 40+ caractères, admin fourni, pas de MS_CLIENT_ID inventé" bash -c "grep -qE '^SESSION_SECRET=.{40,}' '$W/ok/etc/api.env' && grep -q '^ADMIN_EMAILS=admin@example.test' '$W/ok/etc/api.env' && grep -qE '^MS_CLIENT_ID=$' '$W/ok/etc/api.env' && grep -qE '^MAIL_SETUP_TOKEN=.{24,}' '$W/ok/etc/api.env'"
check "sudoers : règle exacte, aucune autre permission" bash -c "[ \$(wc -l < '$W/ok/sudoers/devis-vectis-deploy') -eq 1 ] && grep -qE '^devis-deploy ALL=\(root\) NOPASSWD: [^ ]+/systemctl restart devis-vectis-api, [^ ]+/systemctl is-active devis-vectis-api\$' '$W/ok/sudoers/devis-vectis-deploy'"
check "sudoers : aucun fichier temporaire restant" test -z "$(ls -A "$W/ok/sudoers" | grep '^\.')"
check "nginx -t exécuté avant et après" test "$(grep -c "^nginx -t" "$W/ok/calls.log")" -ge 2
check "Nginx rechargé" grep -q '^systemctl reload nginx' "$W/ok/calls.log"
check "service activé et redémarré" bash -c "grep -q '^systemctl enable devis-vectis-api' '$W/ok/calls.log' && grep -q '^systemctl restart devis-vectis-api' '$W/ok/calls.log'"
check "npm ci lancé par devis-deploy via runuser (pas root)" grep -q "^runuser.*npm ci" "$W/ok/calls.log"
check "aucun secret affiché dans la sortie" bash -c "! grep -qE 'SESSION_SECRET|MAIL_SETUP_TOKEN=[A-Za-z0-9]{20}' '$W/ok/out.log'"

# 3. idempotence : 2e exécution sans différence, nginx -t quand même exécuté, pas de reload
secret1=$(grep '^SESSION_SECRET=' "$W/ok/etc/api.env"); snap=$(sum "$W/ok"); : > "$W/ok/calls.log"
run_setup ok; rc=$?
check "2e exécution réussit" test $rc -eq 0
check "2e exécution : configuration Nginx identique" test "$snap" = "$(sum "$W/ok")"
check "2e exécution : secret conservé" test "$secret1" = "$(grep '^SESSION_SECRET=' "$W/ok/etc/api.env")"
check "2e exécution : include non dupliqué" test "$(grep -c 'devis-vectis-api.conf' "$W/ok/nginx/sites-available/devis.mrprop.fr")" -eq 1
check "2e exécution : nginx -t exécuté même sans changement" grep -q '^nginx -t' "$W/ok/calls.log"
check "2e exécution : pas de reload inutile" bash -c "! grep -q '^systemctl reload nginx' '$W/ok/calls.log'"

# 4. rerun avec include présent mais snippet modifié/cassé : nginx -t échoue -> retour arrière
echo "# corrompu" >> "$W/ok/nginx/snippets/devis-vectis-api.conf"; touch "$W/ok/nginx.fail"; : > "$W/ok/calls.log"
snip_before=$(cat "$W/ok/nginx/snippets/devis-vectis-api.conf")
run_setup ok; rc=$?
check "rerun + nginx -t en échec : le script échoue" test $rc -ne 0
check "rerun + nginx -t en échec : snippet restauré tel quel" test "$snip_before" = "$(cat "$W/ok/nginx/snippets/devis-vectis-api.conf")"
check "rerun + nginx -t en échec : aucun reload" bash -c "! grep -q '^systemctl reload nginx' '$W/ok/calls.log'"
rm -f "$W/ok/nginx.fail"

# 5. échec de nginx -t à la première installation : tout est restauré à l'octet près
new_world rb; before=$(sum "$W/rb"); touch "$W/rb/nginx.fail"
run_setup rb; rc=$?
check "nginx -t en échec : script en échec" test $rc -ne 0
check "nginx -t en échec : vhost restauré à l'identique" test "$before" = "$(sum "$W/rb")"
check "nginx -t en échec : snippet supprimé" test ! -e "$W/rb/nginx/snippets/devis-vectis-api.conf"
check "nginx -t en échec : pas de reload" bash -c "! grep -q '^systemctl reload nginx' '$W/rb/calls.log'"
check "nginx -t en échec : message explicite" grep -q 'nginx -t a échoué' "$W/rb/out.log"

# 6. reload refusé -> retour arrière
new_world rl; before=$(sum "$W/rl"); touch "$W/rl/reload.fail"
run_setup rl; rc=$?
check "reload refusé : script en échec" test $rc -ne 0
check "reload refusé : vhost restauré" test "$before" = "$(sum "$W/rl")"

# 7. configuration déjà cassée avant le script : rien n'est touché
new_world br; before=$(sum "$W/br"); touch "$W/br/nginx.broken"
run_setup br; rc=$?
check "config déjà invalide : refus" test $rc -ne 0
check "config déjà invalide : aucun fichier touché" test "$before" = "$(sum "$W/br")"
check "config déjà invalide : pas de sudoers, pas de service" test -z "$(ls -A "$W/br/sudoers")" -a ! -e "$W/br/systemd/devis-vectis-api.service"

# 8. sudoers invalide : jamais installé
new_world su; touch "$W/su/sudoers.invalid"
run_setup su; rc=$?
check "sudoers invalide : script en échec" test $rc -ne 0
check "sudoers invalide : aucun fichier dans sudoers.d" test -z "$(ls -A "$W/su/sudoers")"
check "sudoers invalide : Nginx non touché" bash -c "! grep -q 'devis-vectis-api.conf' '$W/su/nginx/sites-available/devis.mrprop.fr'"

# 9. vhost partagé avec d'autres noms : refus
new_world sh; sed -i 's/server_name devis.mrprop.fr;/server_name devis.mrprop.fr autre.mrprop.fr;/' "$W/sh/nginx/sites-available/devis.mrprop.fr" ; before=$(sum "$W/sh")
run_setup sh; rc=$?
check "vhost partagé : refus" test $rc -ne 0
check "vhost partagé : rien modifié" test "$before" = "$(sum "$W/sh")"

# 10. sources modifiables par d'autres / non root : refus
new_world pm; chmod 666 "$W/pm/src/nginx-devis-vectis-api.conf"
run_setup pm; rc=$?
check "source modifiable par tous : refus" test $rc -ne 0
check "source modifiable : rien installé" test ! -e "$W/pm/etc/api.env"
new_world gw; chmod 770 "$W/gw/src"
run_setup gw; rc=$?
check "dossier source modifiable par le groupe : refus" test $rc -ne 0

# 11. première installation sans adresse administrateur : refus
new_world na
( cd "$W/na" && env -u DEVIS_ADMIN_EMAIL PATH="$W/na/bin:$PATH" DEVIS_SETUP_TEST=1 T_GROUP=$(id -gn) T_OWNER_UID=$(id -u) T_OWNER_NAME=$(id -un) T_OWNER_GROUP=$(id -gn) T_APP="$W/na/app" T_NGINX_DIR="$W/na/nginx" T_SUDOERS_DIR="$W/na/sudoers" T_SYSTEMD_DIR="$W/na/systemd" T_ENV_DIR="$W/na/etc" bash "$W/na/src/setup-server.sh" ) >"$W/na/out.log" 2>&1; rc=$?
check "sans DEVIS_ADMIN_EMAIL : refus" test $rc -ne 0
check "sans DEVIS_ADMIN_EMAIL : rien créé" test ! -e "$W/na/etc/api.env"

# 11b. B2 : un include seulement COMMENTÉ ne compte pas comme présent
new_world cm
sed -i "s|^    server_name devis.mrprop.fr;|    # include $W/cm/nginx/snippets/devis-vectis-api.conf;\n    server_name devis.mrprop.fr;|" "$W/cm/nginx/sites-available/devis.mrprop.fr"
check "B2 : le vhost de test contient bien l'include commenté" grep -q "^ *# include $W/cm/nginx/snippets/devis-vectis-api.conf;" "$W/cm/nginx/sites-available/devis.mrprop.fr"
run_setup cm; rc=$?
check "B2 : installation réussit malgré l'include commenté" test $rc -eq 0
check "B2 : un include ACTIF est ajouté (en plus du commentaire)" grep -qE '^ *include /.*/snippets/devis-vectis-api.conf;' "$W/cm/nginx/sites-available/devis.mrprop.fr"
check "B2 : un seul include actif" test "$(grep -cE '^ *include /.*devis-vectis-api.conf;' "$W/cm/nginx/sites-available/devis.mrprop.fr")" -eq 1
python3 -I "$ROOT/deploy/nginx-insert.py" "$W/cm/nginx/sites-available/devis.mrprop.fr" "$W/cm/again" devis.mrprop.fr "$W/cm/nginx/snippets/devis-vectis-api.conf"; rc=$?
check "B2 : l'include actif est reconnu à l'exécution suivante (code 10)" test $rc -eq 10

# 11c. M2 : une modification du vhost faite PENDANT npm ci n'est pas écrasée
new_world cc
printf '# ajout concurrent pendant npm ci\n' > "$W/cc/edit-during-npm"
run_setup cc; rc=$?
check "M2 : installation réussit" test $rc -eq 0
check "M2 : la modification concurrente est conservée" grep -q 'ajout concurrent pendant npm ci' "$W/cc/nginx/sites-available/devis.mrprop.fr"
check "M2 : l'include est ajouté une seule fois" test "$(grep -cE '^ *include /.*devis-vectis-api.conf;' "$W/cc/nginx/sites-available/devis.mrprop.fr")" -eq 1

# 11d. M2 : si le vhost change entre l'instantané et l'écriture, RIEN n'est écrasé ni restauré par-dessus
new_world cd
real_py=$(command -v python3)
cat > "$W/cd/bin/python3" <<S
#!/bin/bash
"$real_py" "\$@"; rc=\$?
# modification concurrente juste après le calcul de la version à appliquer (étape 6)
if [[ "\$*" == *vhost.apply* ]]; then printf '# edition concurrente apres instantane\n' >> "$W/cd/nginx/sites-available/devis.mrprop.fr"; fi
exit \$rc
S
chmod +x "$W/cd/bin/python3"
run_setup cd; rc=$?
check "M2 : vhost modifié entre instantané et écriture : le script s'arrête" test $rc -ne 0
check "M2 : la modification concurrente n'est ni écrasée ni annulée" grep -q 'edition concurrente apres instantane' "$W/cd/nginx/sites-available/devis.mrprop.fr"
check "M2 : aucun include écrit dans ce cas" bash -c "! grep -qE '^ *include /.*devis-vectis-api.conf;' '$W/cd/nginx/sites-available/devis.mrprop.fr'"
check "M2 : snippet retiré et pas de reload" bash -c "test ! -e '$W/cd/nginx/snippets/devis-vectis-api.conf' && ! grep -q '^systemctl reload nginx' '$W/cd/calls.log'"
check "M2 : message explicite" grep -q 'modifié pendant l.installation' "$W/cd/out.log"

# 12. aucune adresse administrateur codée en dur dans le dépôt
check "aucune adresse hotmail codée dans les scripts de déploiement" bash -c "! grep -rniE '[a-z0-9._-]+@(hotmail|outlook|live)\.' '$ROOT/deploy' '$ROOT/.github'"

echo "# pass $PASS"; echo "# fail $FAIL"
[ "$FAIL" -eq 0 ]
