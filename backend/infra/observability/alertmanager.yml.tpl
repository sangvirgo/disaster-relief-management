# Rendered by alertmanager-entrypoint.sh: the Telegram chat id is substituted; the bot token is read from a file
# written at start-up from TELEGRAM_BOT_TOKEN. Neither value is committed.
route:
  receiver: telegram
  group_by: [alertname, service, job]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
receivers:
  - name: telegram
    telegram_configs:
      - bot_token_file: /tmp/telegram-token
        chat_id: __TELEGRAM_CHAT_ID__
        send_resolved: true
        parse_mode: ''
        message: |-
          {{ if eq .Status "firing" }}CẢNH BÁO{{ else }}ĐÃ KHẮC PHỤC{{ end }} · Reliva
          {{ range .Alerts }}
          [{{ .Labels.severity }}] {{ .Annotations.summary }}
          {{ .Annotations.description }}
          {{ end }}
