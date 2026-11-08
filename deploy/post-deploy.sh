#!/usr/bin/env bash
# Pós-deploy do Devis VECTIS usando exclusivamente Docker Compose.
set -Eeuo pipefail

APP=${APP:-/opt/devis-vectis}
COMPOSE_FILE="$APP/docker-compose.yml"
ENV_FILE="/etc/devis-vectis/api.env"

note() {
  echo "::notice title=post-deploy::$*"
}

fail() {
  note "falha: $1"
  exit 1
}

cd "$APP" || fail "diretório da aplicação indisponível"

[ -f "$COMPOSE_FILE" ] || fail "docker-compose.yml ausente"
[ -f "$ENV_FILE" ] || fail "arquivo de ambiente ausente"
command -v docker >/dev/null 2>&1 || fail "Docker indisponível"

docker compose version >/dev/null 2>&1 || fail "Docker Compose indisponível"

docker compose config --quiet || fail "configuração do Docker Compose inválida"

note "iniciando build da API"
docker compose build api || fail "build da API falhou"

note "atualizando somente o serviço api"
docker compose up -d --no-deps api || fail "atualização do serviço api falhou"

note "aguardando health check"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3100/api/health >/dev/null 2>&1; then
    note "API ativa, health OK"
    exit 0
  fi
  sleep 2
done

fail "health indisponível após atualização"
