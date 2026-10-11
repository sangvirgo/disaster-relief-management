ROOT="$(cd -- "$(dirname -- "$0")/../../.." && pwd)"
MAIN_COMPOSE_FILE="$ROOT/backend/infra/compose.yaml"
TEST_COMPOSE_FILE="$ROOT/backend/infra/compose.test.yaml"
main_compose() {
  docker compose -p c48 --env-file "$ROOT/backend/.env" -f "$MAIN_COMPOSE_FILE" "$@"
}
test_compose() {
  docker compose --profile test -p "$C48_TEST_PROJECT" -f "$TEST_COMPOSE_FILE" "$@"
}
require_env_file() {
  if [[ ! -f "$ROOT/backend/.env" ]]; then
    printf 'Missing backend/.env. Copy backend/.env.example and fill local values first.\n' >&2
    exit 1
  fi
}
