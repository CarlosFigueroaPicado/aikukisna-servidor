#!/usr/bin/env bash
# Obtiene el primer certificado HTTPS de Let's Encrypt. Ejecutar UNA vez en /opt/aikukisna:
#   bash scripts/certificado.sh tu-correo@ejemplo.com
# Nginx no arranca sin certificado, así que primero se crea uno temporal autofirmado.
set -euo pipefail
cd "$(dirname "$0")/.."

CORREO="${1:?Uso: bash scripts/certificado.sh tu-correo@ejemplo.com}"
DOMINIO="$(grep -E '^DOMINIO=' .env | cut -d= -f2-)"
[ -n "$DOMINIO" ] || { echo "Falta DOMINIO en .env" >&2; exit 1; }
RUTA="/etc/letsencrypt/live/$DOMINIO"

echo "==> Certificado temporal para $DOMINIO"
docker compose run --rm --entrypoint sh certbot -c "
  mkdir -p $RUTA &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=localhost \
    -keyout $RUTA/privkey.pem -out $RUTA/fullchain.pem"

echo "==> Arrancando Nginx"
docker compose up -d nginx

echo "==> Borrando el temporal y pidiendo el certificado real"
docker compose run --rm --entrypoint sh certbot -c "
  rm -rf /etc/letsencrypt/live/$DOMINIO /etc/letsencrypt/archive/$DOMINIO /etc/letsencrypt/renewal/$DOMINIO.conf"
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMINIO" --email "$CORREO" --agree-tos --no-eff-email --non-interactive

echo "==> Recargando Nginx con el certificado real"
docker compose exec nginx nginx -s reload
echo "Listo: https://$DOMINIO"
