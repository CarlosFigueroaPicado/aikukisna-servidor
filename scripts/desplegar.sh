#!/usr/bin/env bash
# Actualiza el servidor con la rama main de GitHub. Ejecutar en /opt/aikukisna:
#   bash scripts/desplegar.sh
# El commit desplegado queda visible en https://<dominio>/api/salud ("version"), para comprobar que
# Azure corre exactamente el código de la rama main.
set -euo pipefail
cd "$(dirname "$0")/.."

RAMA="${RAMA:-main}"

echo "==> 1/4 Trayendo la rama $RAMA de GitHub"
git fetch --quiet origin "$RAMA"
# Los cambios locales se descartan: el servidor debe ser idéntico a GitHub (.env y respaldos no están en git).
git checkout --quiet -B "$RAMA" "origin/$RAMA"
git reset --quiet --hard "origin/$RAMA"
VERSION_CODIGO="$(git rev-parse --short HEAD)"
echo "VERSION_CODIGO=$VERSION_CODIGO" > .version.env
echo "    commit $VERSION_CODIGO: $(git log -1 --format=%s)"

echo "==> 2/4 Construyendo y levantando los contenedores"
docker compose up -d --build --remove-orphans

echo "==> 3/4 Recargando Nginx con la configuración nueva (sin cortar el servicio)"
docker compose exec -T nginx sh -c '/docker-entrypoint.d/20-envsubst-on-templates.sh >/dev/null && nginx -t -q && nginx -s reload'

echo "==> 4/4 Comprobando"
DOMINIO="$(grep -E '^DOMINIO=' .env | cut -d= -f2-)"
for intento in $(seq 1 15); do
  if salud="$(curl -fsS --max-time 5 "https://$DOMINIO/api/salud" 2>/dev/null)"; then
    echo "    $salud"
    case "$salud" in
      *"\"version\":\"$VERSION_CODIGO\""*) echo "Listo: Azure corre el commit $VERSION_CODIGO de $RAMA"; exit 0 ;;
    esac
  fi
  sleep 2
done
echo "La API no respondió con el commit $VERSION_CODIGO. Revisa: docker compose logs --tail 50 api" >&2
exit 1
