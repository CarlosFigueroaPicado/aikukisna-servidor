#!/usr/bin/env bash
# Monitoreo básico desde el servidor: estado de los contenedores, salud de la API, disco y memoria.
#   bash scripts/vigilar.sh
# Programado cada 5 minutos (crontab -e):
#   */5 * * * * bash /opt/aikukisna/scripts/vigilar.sh >> /opt/aikukisna/vigilancia.log 2>&1
cd "$(dirname "$0")/.."
DOMINIO="$(grep -E '^DOMINIO=' .env | cut -d= -f2-)"
ahora="$(date '+%F %T')"
problemas=0

while read -r nombre estado; do
  case "$estado" in
    *unhealthy*|*Exited*|*Restarting*) echo "$ahora ALERTA contenedor $nombre: $estado"; problemas=1 ;;
  esac
done < <(docker compose ps --all --format '{{.Service}} {{.Status}}')

if ! curl -fsS --max-time 10 "https://$DOMINIO/api/salud" >/dev/null; then
  echo "$ahora ALERTA https://$DOMINIO/api/salud no responde"; problemas=1
fi

disco="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
[ "$disco" -ge 85 ] && { echo "$ahora ALERTA disco al $disco %"; problemas=1; }

memoria="$(free -m | awk '/^Mem:/ {print $7}')"
[ "$memoria" -lt 400 ] && { echo "$ahora ALERTA solo $memoria MB de memoria disponible"; problemas=1; }

[ "$problemas" -eq 0 ] && echo "$ahora OK disco=${disco}% memoria_libre=${memoria}MB"
exit "$problemas"
