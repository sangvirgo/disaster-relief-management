#!/bin/sh
# Grafana falls back to admin/admin when no password is set: refuse to start instead.
set -eu
if [ -z "${GF_SECURITY_ADMIN_PASSWORD:-}" ]; then
  echo "grafana: GRAFANA_ADMIN_PASSWORD is empty in backend/.env; refusing to start with the default password" >&2
  exit 1
fi
exec /run.sh
