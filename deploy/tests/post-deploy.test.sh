#!/usr/bin/env bash
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

PASS=0
FAIL=0

ok() { PASS=$((PASS+1)); echo "ok - $*"; }
bad() { FAIL=$((FAIL+1)); echo "not ok - $*"; }
check() { local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

new_world() {
  local d=$W/$1
  mkdir -p "$d/bin" "$d/app"
  touch "$d/app/docker-compose.yml" "$d/api.env"
  cat > "$d/bin/docker" <<'MOCK'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
case "$*" in
  "compose build api") [ "${DOCKER_FAIL:-}" != build ] ;;
  "compose up -d --no-deps api") [ "${DOCKER_FAIL:-}" != up ] ;;
  *) exit 0 ;;
esac
MOCK
  cat > "$d/bin/curl" <<'MOCK'
#!/usr/bin/env bash
echo "curl $*" >> "$CALLS"
[ "${CURL_OK:-1}" = 1 ]
MOCK
  printf '#!/usr/bin/env bash\nexit 0\n' > "$d/bin/sleep"
  chmod +x "$d/bin/"*
}

run_test() {
  local name=$1
  shift
  local d=$W/$name
  ( 
    export CALLS="$d/calls.log"
    export PATH="$d/bin:$PATH"
    export APP="$d/app"
    export ENV_FILE="$d/api.env"
    export CURL_OK="${CURL_OK:-1}"
    export DOCKER_FAIL="${DOCKER_FAIL:-}"
    bash "$ROOT/deploy/post-deploy.sh"
  ) > "$d/output.log" 2>&1
}

new_world success
run_test success
rc=$?
check "sucesso: script termina com código 0" test "$rc" -eq 0
check "sucesso: build da API executado" grep -q '^docker compose build api$' "$W/success/calls.log"
check "sucesso: somente API atualizada" grep -q '^docker compose up -d --no-deps api$' "$W/success/calls.log"
check "sucesso: health check executado" grep -q '^curl ' "$W/success/calls.log"

new_world build_fail
DOCKER_FAIL=build run_test build_fail
rc=$?
check "falha no build: script termina com erro" test "$rc" -ne 0
check "falha no build: atualização não é executada" bash -c "! grep -q '^docker compose up ' '$W/build_fail/calls.log'"

new_world up_fail
DOCKER_FAIL=up run_test up_fail
rc=$?
check "falha na atualização: script termina com erro" test "$rc" -ne 0
check "falha na atualização: health check não é executado" bash -c "! grep -q '^curl ' '$W/up_fail/calls.log'"

new_world health_fail
CURL_OK=0 run_test health_fail
rc=$?
check "health indisponível: script termina com erro" test "$rc" -ne 0
check "health indisponível: 30 tentativas executadas" test "$(grep -c '^curl ' "$W/health_fail/calls.log")" -eq 30

echo "# pass $PASS"
echo "# fail $FAIL"
[ "$FAIL" -eq 0 ]
