#!/usr/bin/env bash
# Read-only diagnostic for the Devis VECTIS VPS. Changes nothing.
# Output is emitted as GitHub Actions notices so the results are visible in the run.
set -u
note() { printf '::notice title=%s::%s\n' "$1" "$(printf '%s' "$2" | tr '\n\r' '  ' | cut -c1-900)"; }

note identity "user=$(id -un) uid=$(id -u) groups=$(id -Gn) | os=$(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}")"
note sudo "$(sudo -n -l 2>&1 | head -12 | tr '\n' ';')"
note node "node=$(command -v node || echo none) $(node -v 2>&1 | head -1) npm=$(npm -v 2>&1 | head -1) | gcc=$(command -v gcc || echo no) make=$(command -v make || echo no) python3=$(command -v python3 || echo no)"
note paths "$(ls -ld /opt/devis-vectis /var/lib/devis-vectis /etc/devis-vectis 2>&1 | tr '\n' ';') | repo: $(ls -A /opt/devis-vectis 2>&1 | tr '\n' ' ') | $(git -C /opt/devis-vectis log -1 --format='%h %s' 2>&1)"
note systemd "units: $(systemctl list-unit-files --no-pager 2>/dev/null | grep -i devis | tr '\n' ';') | devis-vectis-api active: $(systemctl is-active devis-vectis-api 2>&1)"
note nginx "$(nginx -v 2>&1) | files mentioning the domain: $(grep -RIl 'devis.mrprop.fr' /etc/nginx 2>/dev/null | tr '\n' ' ')"
f=$(grep -RIl 'devis.mrprop.fr' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | head -1)
if [ -n "$f" ]; then
  note "nginx-vhost" "$(basename "$f"): $(grep -nE '^\s*(server_name|root|index|listen|location|proxy_pass|include|return|try_files|ssl_certificate )' "$f" 2>&1 | tr -s ' ' | tr '\n' ';')"
fi
code() { curl -sk -m 6 --resolve devis.mrprop.fr:443:127.0.0.1 -o /dev/null -w '%{http_code}' "https://devis.mrprop.fr$1" 2>/dev/null; }
note exposure "HTTP codes via local vhost: / =$(code /) | /.git/HEAD =$(code /.git/HEAD) | /.github/workflows/deploy.yml =$(code /.github/workflows/deploy.yml) | /deploy/diagnose.sh =$(code /deploy/diagnose.sh) | /README.md =$(code /README.md)"
note ports "listeners on :3100 = $(ss -ltn 2>/dev/null | awk '$4 ~ /:3100$/' | wc -l) | on :80/:443 = $(ss -ltn 2>/dev/null | awk '$4 ~ /:(80|443)$/' | wc -l) | disk: $(df -h /var/lib /opt 2>&1 | tail -n +2 | awk '{print $6" free "$4}' | tr '\n' ';')"
note perms "$(ls -la /opt/devis-vectis 2>&1 | tail -n +2 | awk '{print $1" "$3":"$4" "$9}' | tr '\n' ';') | nginx workers: $(ps -o user= -C nginx 2>/dev/null | sort -u | tr '\n' ' ') | snippets dir: $(ls -ld /etc/nginx/snippets 2>&1 | awk '{print $1" "$3}')"
