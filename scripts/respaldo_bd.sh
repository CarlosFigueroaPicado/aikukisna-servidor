#!/usr/bin/env bash
# Respaldo diario de la base (solicitudes de demo y versiones). Guarda 14 días en /opt/aikukisna/respaldos.
# Programarlo con:  crontab -e   →   30 3 * * * bash /opt/aikukisna/scripts/respaldo_bd.sh
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env; set +a
mkdir -p respaldos
chmod 700 respaldos
archivo="respaldos/aikukisna-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T bd pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$archivo"
chmod 600 "$archivo"
find respaldos -name '*.sql.gz' -mtime +14 -delete
echo "Respaldo: $archivo"
