#!/bin/sh
set -eu

# Imagens antigas gravavam o SQLite como root. Corrige apenas os dois volumes
# conhecidos e então substitui o PID 1 pelo processo Node sem privilégios.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data /app/backups
  chown -R node:node /app/data /app/backups
  exec su-exec node:node "$@"
fi

exec "$@"
