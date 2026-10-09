#!/usr/bin/env bash
# Publica un instalable que ya está en el servidor (subido con scp), sin pasar por el navegador.
# Útil para la APK con el modelo de Tuki (~800 MB): por el panel la subida puede pasar del límite de tiempo.
#
#   bash scripts/publicar_version.sh ~/app-arm64-v8a-release.apk android 1.0.0 "Notas de la versión"
#
# Queda igual que si se hubiera subido desde el panel: aparece en "Versiones publicadas" y en la landing.
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVO="${1:?Uso: bash scripts/publicar_version.sh ARCHIVO PLATAFORMA VERSION [NOTAS]}"
PLATAFORMA="${2:?Falta la plataforma: android, windows o macos}"
VERSION="${3:?Falta la versión, por ejemplo 1.0.0}"
NOTAS="${4:-}"

case "$PLATAFORMA" in
  android) EXT=apk ;;
  windows) EXT=exe ;;
  macos) EXT=dmg ;;
  *) echo "Plataforma inválida (android, windows, macos)" >&2; exit 1 ;;
esac
[[ "$VERSION" =~ ^[0-9A-Za-z._-]{1,40}$ ]] || { echo "Versión inválida (ej. 1.0.0)" >&2; exit 1; }
[ -f "$ARCHIVO" ] || { echo "No existe el archivo $ARCHIVO" >&2; exit 1; }
[[ "${ARCHIVO,,}" == *."$EXT" ]] || { echo "Para $PLATAFORMA el archivo debe ser .$EXT" >&2; exit 1; }

# Solo las variables necesarias (el .env tiene valores con $$ que no deben interpretarse aquí).
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2-)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2-)"

NOMBRE="aikukisna-$PLATAFORMA-$VERSION.$EXT"
CARPETA="$(cd "$(dirname "$ARCHIVO")" && pwd)"
BASE="$(basename "$ARCHIVO")"
TAMANO="$(stat -c %s "$ARCHIVO")"

echo "==> Calculando SHA-256 de $BASE ($((TAMANO / 1048576)) MB)"
SHA="$(sha256sum "$ARCHIVO" | cut -d' ' -f1)"

echo "==> Copiando al volumen de descargas como $NOMBRE"
# Contenedor temporal: el de la API es de solo lectura. uid 1000 = usuario "node" de la API.
docker run --rm -v aikukisna_descargas:/destino -v "$CARPETA":/origen:ro alpine:3.20 \
  sh -c "cp '/origen/$BASE' '/destino/$NOMBRE' && chown 1000:1000 '/destino/$NOMBRE'"

echo "==> Registrando la versión en la base"
docker compose exec -T bd psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v plataforma="$PLATAFORMA" -v version="$VERSION" -v archivo="$NOMBRE" \
  -v tamano="$TAMANO" -v sha="$SHA" -v notas="$NOTAS" <<'SQL'
INSERT INTO version_app (plataforma, version, archivo, tamano_bytes, sha256, notas)
VALUES (:'plataforma', :'version', :'archivo', :'tamano', :'sha', NULLIF(:'notas', ''));
SQL

echo "Listo: /descargas/$NOMBRE"
echo "SHA-256: $SHA"
