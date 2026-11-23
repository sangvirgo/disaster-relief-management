#!/bin/sh
# Renders the Alertmanager config from the host .env values. Without Telegram settings it still starts (alerts are
# kept and shown in the Alertmanager UI) so a missing token never takes monitoring down.
set -eu
umask 077
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  case "$TELEGRAM_CHAT_ID" in
    *[!0-9-]*) echo "alertmanager: TELEGRAM_CHAT_ID must be a number (a group id starts with -)" >&2; exit 1 ;;
  esac
  printf '%s' "$TELEGRAM_BOT_TOKEN" > /tmp/telegram-token
  sed "s|__TELEGRAM_CHAT_ID__|$TELEGRAM_CHAT_ID|" /etc/alertmanager/alertmanager.yml.tpl > /tmp/alertmanager.yml
else
  echo "alertmanager: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are empty in backend/.env; notifications are disabled" >&2
  printf 'route:\n  receiver: none\nreceivers:\n  - name: none\n' > /tmp/alertmanager.yml
fi
exec /bin/alertmanager --config.file=/tmp/alertmanager.yml --storage.path=/alertmanager --web.listen-address=:9093 --data.retention=72h
