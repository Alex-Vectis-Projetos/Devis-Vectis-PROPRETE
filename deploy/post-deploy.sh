#!/usr/bin/env bash
# Exécuté sur le VPS par GitHub Actions après `git pull`. Utilisateur : devis-deploy (sans root).
set -uo pipefail
APP=/opt/devis-vectis
SVC=devis-vectis-api
cd "$APP/server" || exit 0
note() { echo "::notice title=post-deploy::$*"; }

if [ ! -f /etc/systemd/system/$SVC.service ]; then
  note "service $SVC non installé : exécuter une fois deploy/setup-server.sh en root. Site statique déployé normalement."
  exit 0
fi
npm ci --omit=dev --no-audit --no-fund >/tmp/devis-npm.log 2>&1 && note "dépendances installées" || { note "npm ci a échoué : $(tail -n 3 /tmp/devis-npm.log | tr '\n' ' ')"; exit 1; }
if sudo -n /usr/bin/systemctl restart $SVC 2>/dev/null || sudo -n "$(command -v systemctl)" restart $SVC 2>/dev/null; then
  sleep 3
  note "service: $(systemctl is-active $SVC)"
  for i in 1 2 3 4 5 6 7 8; do
    out=$(curl -fsS http://127.0.0.1:3100/api/health 2>/dev/null) && { note "health: $out"; exit 0; }
    sleep 1
  done
  note "health: indisponible après redémarrage"; exit 1
else
  note "redémarrage refusé (droit sudo manquant) : relancer setup-server.sh en root"; exit 1
fi
