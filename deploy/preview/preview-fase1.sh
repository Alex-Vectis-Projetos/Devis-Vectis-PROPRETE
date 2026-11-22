#!/usr/bin/env bash
# VECTIS — PREVIEW « Statistiques » — FASE 1 (conteneur local isolado, nenhuma exposição pública).
# Executar no VPS como root:  bash preview-fase1.sh <commit7>   (cópia do arquivo deploy/preview/preview-fase1.sh da branch; ele mesmo clona a branch)
# Para na primeira anomalia (nada é apagado, nenhum rollback automático). Não toca em DNS, Nginx (vhosts), certificados nem na produção.
set -euo pipefail

BR=feat/stats-2-dashboard
EXPECT="${1:-}"      # commit (7 caracteres) que Claude informa após o CI verde ; obrigatório
DIR=/opt/devis-vectis-preview
ENVDIR=/etc/devis-vectis-preview
HTP=/etc/nginx/preview-stats.htpasswd
CT=devis-vectis-preview-api
PROD=/opt/devis-vectis
COMPOSE="docker compose -p vectis-preview -f deploy/preview/docker-compose.preview.yml"

say() { printf '\n== %s ==\n' "$*"; }
die() { printf '\nABORTADO: %s\nNada foi apagado. Envie esta saída a Claude. Rollback (se o container existir):\n  cd %s && %s down   # sem -v\n' "$*" "$DIR" "$COMPOSE" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "executar como root"
printf '%s' "$EXPECT" | grep -Eq '^[0-9a-f]{7}$' || die "uso: bash preview-fase1.sh <commit de 7 caracteres, ex.: abc1234>"

say "ETAPA 0 — estado da produção ANTES (somente leitura)"
PROD_STARTED=$(docker inspect devis-vectis-api --format '{{.State.StartedAt}}') || die "container de produção não encontrado"
PROD_HEAD=$(git -C "$PROD" rev-parse --short HEAD)
echo "produção: devis-vectis-api iniciado em $PROD_STARTED ; commit $PROD_HEAD"

say "ETAPA 1 — recursos devem estar LIVRES"
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '[:.]3101$'; then die "porta 3101 ocupada"; fi
echo "porta 3101: livre"
SUBNETS=$(docker network ls -q | xargs -r docker network inspect --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}' | tr ' ' '\n' | sed '/^$/d')
if printf '%s\n' "$SUBNETS" | grep -Eq '^172\.28\.'; then die "há sub-rede Docker em 172.28.x.x: $(printf '%s\n' "$SUBNETS" | grep -E '^172\.28\.' | tr '\n' ' ')"; fi
echo "sub-redes Docker em uso: $(printf '%s\n' "$SUBNETS" | tr '\n' ' ')"; echo "172.28.77.0/24: livre"
if ip route | grep -Eq '172\.28\.'; then die "rota para 172.28.x.x existente: $(ip route | grep -E '172\.28\.')"; fi
echo "rotas 172.28.x.x: nenhuma"
docker network inspect vectis_preview_network >/dev/null 2>&1 && die "rede vectis_preview_network já existe"
docker volume inspect vectis_preview_data >/dev/null 2>&1 && die "volume vectis_preview_data já existe"
docker ps -a --format '{{.Names}}' | grep -qx "$CT" && die "container $CT já existe"
docker image inspect vectis-preview-api-preview >/dev/null 2>&1 && die "imagem vectis-preview-api-preview já existe"
for p in "$DIR" "$ENVDIR" "$HTP"; do [ -e "$p" ] && die "$p já existe"; done
echo "rede, volume, container, imagem, diretórios e htpasswd: livres"

say "ETAPA 2 — commit da branch (leitura remota) e clone separado"
REMOTE_URL=$(git -C "$PROD" remote get-url origin)
SHA=$(git ls-remote "$REMOTE_URL" "refs/heads/$BR" | cut -c1-7)
echo "origin/$BR = $SHA (esperado $EXPECT)"
[ "$SHA" = "$EXPECT" ] || die "a branch não está em $EXPECT — peça a Claude a validação do novo commit antes de continuar"
git clone --branch "$BR" --single-branch "$REMOTE_URL" "$DIR"
[ "$(git -C "$DIR" rev-parse --short=7 HEAD)" = "$EXPECT" ] || die "o clone não está em $EXPECT"
echo "clone em $(git -C "$DIR" rev-parse --short=7 HEAD)"

say "ETAPA 3 — ambiente do preview (0600; os valores NÃO são exibidos)"
install -d -m 0750 "$ENVDIR"
( umask 077; printf 'SESSION_SECRET=%s\nADMIN_EMAILS=preview-admin@preview.invalid\n' "$(openssl rand -hex 32)" > "$ENVDIR/api.env" )
stat -c '%a %U:%G %n' "$ENVDIR/api.env"
grep -c . "$ENVDIR/api.env" | sed 's/$/ linhas/'
if cut -d= -f1 "$ENVDIR/api.env" | grep -Eq '^(GOOGLE|MAIL|STATS|QUOTE)'; then die "api.env contém variável proibida"; fi

say "ETAPA 4 — senha de acesso (htpasswd): usuário 'preview'; digite a senha quando solicitado"
# Utilisateur et groupe de Nginx : explicitement www-data:www-data (workers confirmés ; on ne cherche PAS de processus nginx, qui pourraient être ceux de conteneurs).
getent passwd www-data >/dev/null && getent group www-data >/dev/null || die "utilisateur/groupe www-data introuvable"
( umask 027; printf 'preview:%s\n' "$(openssl passwd -apr1)" > "$HTP" )
chown www-data:www-data "$HTP"; chmod 640 "$HTP"
stat -c '%a %U:%G %n' "$HTP"

say "ETAPA 5 — compose (projeto isolado) : validação e subida"
cd "$DIR"
$COMPOSE config -q && echo "compose válido"
$COMPOSE up -d --build

say "ETAPA 6 — verificações"
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3101/api/health >/dev/null 2>&1 && break; sleep 2; done
echo "container:   $(docker inspect $CT --format '{{.State.Status}}')"
echo "health:      $(curl -fsS http://127.0.0.1:3101/api/health)"
CONTENT=$(curl -fsS http://127.0.0.1:3101/api/site/content)
echo "site/content: ...$(printf '%s' "$CONTENT" | tail -c 40)"
printf '%s' "$CONTENT" | grep -q '"stats":false' || die "/api/site/content não retornou stats:false"
CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/api/admin/stats/status)
echo "admin/stats/status sem sessão: HTTP $CODE"; [ "$CODE" = 401 ] || die "esperado 401"
echo "porta publicada: $(docker port $CT)"
docker port $CT | grep -q '127.0.0.1:3101' || die "porta não publicada em 127.0.0.1:3101"
docker port $CT | grep -Eq '(0\.0\.0\.0|\[::\])' && die "porta publicada em interface pública"
echo "escuta no host:"; ss -ltnp | grep ':3101' || true
NETS=$(docker inspect $CT --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}')
echo "redes do preview: $NETS"; [ "$NETS" = "vectis_preview_network " ] || die "redes inesperadas"
echo "sub-rede: $(docker network inspect vectis_preview_network --format '{{range .IPAM.Config}}{{.Subnet}} gw {{.Gateway}}{{end}}')"
echo "mounts:"; docker inspect $CT --format '{{range .Mounts}}  {{.Type}} {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
[ "$(docker inspect $CT --format '{{len .Mounts}} {{(index .Mounts 0).Name}}')" = "1 vectis_preview_data" ] || die "mounts inesperados"
echo "PREVIEW_MODE=$(docker exec $CT printenv PREVIEW_MODE)"
docker exec $CT sh -c 'env | cut -d= -f1 | grep -E "^(GOOGLE|MAIL|STATS|QUOTE)" || echo "variáveis GOOGLE/MAIL/STATS/QUOTE: nenhuma"'
echo "preview/info: $(curl -s -o /dev/null -w 'HTTP %{http_code}' http://127.0.0.1:3101/api/preview/info)"

say "ETAPA 7 — produção DEPOIS (deve estar idêntica)"
[ "$(docker inspect devis-vectis-api --format '{{.State.StartedAt}}')" = "$PROD_STARTED" ] || die "o container de produção foi reiniciado!"
echo "devis-vectis-api: mesmo início ($PROD_STARTED), não recriado"
echo "membros de devis_vectis_network: $(docker network inspect devis_vectis_network --format '{{range .Containers}}{{.Name}} {{end}}')"
[ "$(git -C "$PROD" rev-parse --short HEAD)" = "$PROD_HEAD" ] || die "commit de produção mudou"
echo "commit de produção: $PROD_HEAD (inalterado)"
echo "health produção: $(curl -fsS http://127.0.0.1:3100/api/health)"
echo; echo "FASE 1 CONCLUÍDA — preview apenas em 127.0.0.1:3101. DNS/Nginx/HTTPS: aguardam autorização."
