ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
MAIN_COMPOSE_FILE="$ROOT/backend/infra/compose.yaml"
main_compose() {
  docker compose -p c48 --env-file "$ROOT/backend/.env" -f "$MAIN_COMPOSE_FILE" "$@"
}
image_source() {
  local source="${C48_IMAGE_SOURCE:-}"
  if [[ -z "$source" ]]; then
    source="$(awk -F= '$1 == "C48_IMAGE_SOURCE" { print $2; found = 1; exit } END { if (!found) print "local" }' "$ROOT/backend/.env")"
  fi
  case "$source" in
    local|registry) printf '%s\n' "$source" ;;
    *) printf 'C48_IMAGE_SOURCE must be local or registry.\n' >&2; return 2 ;;
  esac
}
main_compose_prepare_images() {
  if [[ "$(image_source)" == registry ]]; then main_compose pull "$@"; else main_compose build "$@"; fi
}
main_compose_up() {
  local global_args=()
  if [[ "${1:-}" == --profile ]]; then global_args=("$1" "$2"); shift 2; fi
  local build_args=()
  if [[ "$(image_source)" == registry ]]; then build_args+=(--no-build); fi
  main_compose "${global_args[@]}" up "${build_args[@]}" "$@"
}
require_env_file() {
  if [[ ! -f "$ROOT/backend/.env" ]]; then
    printf 'Missing backend/.env. Copy backend/.env.example and fill local values first.\n' >&2
    exit 1
  fi
}
load_backend_env() {
  set -a
  # The local .env values are project-generated and use shell-safe base64/url-safe secrets.
  source "$ROOT/backend/.env"
  set +a
}
require_nonproduction_env() {
  if [[ "${NODE_ENV:-}" == "production" ]] || awk -F= '
    $1 ~ /^[[:space:]]*NODE_ENV[[:space:]]*$/ {
      value = $2
      sub(/[[:space:]]*#.*/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/"/, "", value)
      gsub(sprintf("%c", 39), "", value)
      if (tolower(value) == "production") found = 1
    }
    END { exit !found }
  ' "$ROOT/backend/.env"; then
    printf 'Refusing to reset a production environment.\n' >&2
    exit 1
  fi
}
export_smoke_env() {
  local port="${POSTGRES_HOST_PORT:-55432}"
  local public_port="${PUBLIC_PORT:-8080}"
  export C48_IDENTITY_DATABASE_URL="postgresql://identity_migrator:${IDENTITY_MIGRATOR_PASSWORD}@127.0.0.1:${port}/c48_identity"
  export C48_IDENTITY_APP_DATABASE_URL="postgresql://identity_app_login:${IDENTITY_APP_PASSWORD}@127.0.0.1:${port}/c48_identity"
  export C48_RESPONSE_DATABASE_URL="postgresql://response_migrator:${RESPONSE_MIGRATOR_PASSWORD}@127.0.0.1:${port}/c48_response"
  export C48_LOGISTICS_DATABASE_URL="postgresql://logistics_migrator:${LOGISTICS_MIGRATOR_PASSWORD}@127.0.0.1:${port}/c48_logistics"
  export C48_IDENTITY_BASE_URL='http://127.0.0.1:3001/api/v1/identity'
  export C48_RESPONSE_BASE_URL='http://127.0.0.1:3002/api/v1/response'
  export C48_LOGISTICS_BASE_URL='http://127.0.0.1:3003/api/v1/logistics'
  export C48_RESPONSE_PROXY_BASE_URL="http://127.0.0.1:${public_port}/api/v1/response"
  export C48_SMOKE_ORIGIN="${C48_SMOKE_ORIGIN:-${WEB_ALLOWED_ORIGINS%%,*}}"
}
