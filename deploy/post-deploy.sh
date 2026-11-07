#!/usr/bin/env bash
# Exécuté sur le VPS par GitHub Actions après `git pull`, sous l'utilisateur devis-deploy (sans root).
# Les messages ::notice apparaissent dans des journaux PUBLICS : ils ne contiennent que des codes d'état.
set -uo pipefail
APP=${APP:-/opt/devis-vectis}
SVC=devis-vectis-api
cd "$APP/server" || exit 0
note() { echo "::notice title=post-deploy::$*"; }

if [ ! -f /etc/systemd/system/$SVC.service ]; then
  note "service non installé (installation initiale à faire par l'administrateur). Site statique déployé."
  exit 0
fi

# Dépendances : installation dans un dossier de travail, puis échange atomique. En cas d'échec,
# l'ancien node_modules reste intact et le service n'est pas touché.
want=$(sha256sum package-lock.json | cut -d' ' -f1)
have=$(cat node_modules/.lock-sha256 2>/dev/null || true)
if [ "$want" != "$have" ] || [ ! -d node_modules ]; then
  stage=$(mktemp -d "$PWD/.nm-stage.XXXXXX") || { note "dépendances: dossier temporaire impossible"; exit 1; }
  trap 'rm -rf "$stage"' EXIT
  cp package.json package-lock.json "$stage/"
  if ! (cd "$stage" && npm ci --omit=dev --no-audit --no-fund >"$stage/npm.log" 2>&1); then
    note "dépendances: npm ci a échoué (ancienne version conservée)"; exit 1
  fi
  echo "$want" > "$stage/node_modules/.lock-sha256"
  rm -rf node_modules.old
  [ -d node_modules ] && mv node_modules node_modules.old
  mv "$stage/node_modules" node_modules
  rm -rf node_modules.old
  note "dépendances: installées"
else
  note "dépendances: inchangées"
fi

out=$(sudo -n /usr/bin/systemctl restart "$SVC" 2>&1) || out=$(sudo -n "$(command -v systemctl)" restart "$SVC" 2>&1) || {
  case "$out" in
    *"password is required"*|*"not allowed"*|*"may not run"*) note "redémarrage refusé: droit sudo absent (installation initiale incomplète)";;
    *) note "redémarrage échoué";;
  esac
  exit 1
}
sleep 3
for _ in 1 2 3 4 5 6 7 8; do
  if curl -fsS http://127.0.0.1:3100/api/health >/dev/null 2>&1; then note "service actif, health OK"; exit 0; fi
  sleep 1
done
note "health indisponible après redémarrage"
exit 1
