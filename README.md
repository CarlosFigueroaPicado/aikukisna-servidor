# Aikukisna — sitio web y servidor

Sitio público de **Aikukisna**, la app para aprender Miskito, Inglés Kriol e Inglés con Tuki (también sin
conexión). Incluye:

- **Landing page**: presenta la app y ofrece la descarga de la APK de Android.
- **Formulario de solicitud de demo**: al enviarlo aparece una tarjeta para descargar la app.
- **Panel administrativo** privado: gestiona las solicitudes y sube las versiones instalables
  (APK, EXE, DMG).

En producción: **https://aikukisna.chilecentral.cloudapp.azure.com**

| Ruta | Qué es |
|---|---|
| `/` | Landing |
| `/form.html` | Formulario de demostración |
| `/admin/` | Panel administrativo (requiere usuario y contraseña) |
| `/descargas/…` | Instalables publicados |
| `/api/salud` | Estado del servidor y **commit de GitHub desplegado** |

> La app Android vive en su propio repositorio (`Aikukisna`). Este repositorio contiene solo el sitio
> web y su infraestructura.

## Arquitectura

```
Internet ──► Nginx :443 (proxy inverso, HTTPS, páginas de error)
               ├─ /            landing (archivos estáticos de web/)
               ├─ /admin/      panel (archivos estáticos de admin/)
               ├─ /descargas/  instalables (volumen "descargas")
               └─ /api/  ──►  API Node.js + Express :3000 ──► PostgreSQL :5432
                              (red interna de Docker, sin acceso desde internet)
Certbot renueva el certificado de Let's Encrypt.
```

| Contenedor | Imagen | Expuesto a internet |
|---|---|---|
| `nginx` | nginx:1.27-alpine | Sí, puertos 80 y 443 (único) |
| `api` | construida desde `api/` (Node 22) | No |
| `bd` | postgres:17-alpine | No (red `internal`) |
| `certbot` | certbot/certbot:v3.1.0 | No |

**Seguridad**

- El panel usa sesiones **JWT** en una cookie `HttpOnly`, `Secure` y `SameSite=Strict`.
- La contraseña se guarda solo como hash **bcrypt**.
- **CORS** acepta solo los orígenes de `CORS_ORIGENES`.
- Límite de peticiones en el formulario, el inicio de sesión y la API.
- Cabeceras HSTS y X-Frame-Options.
- La API corre como usuario `node` en un contenedor de solo lectura.
- Los secretos solo existen en el `.env` del servidor (permisos 600, fuera de git).

## Estructura

```
api/            API (Express): solicitudes de demo, sesión del panel, versiones instalables
  src/app.js        rutas
  src/bd.js         conexión y tablas de PostgreSQL
  pruebas/          pruebas automáticas (base en memoria)
web/            landing, formulario, páginas de error 404 y 50x
admin/          panel administrativo
nginx/templates/  configuración de Nginx (el dominio se toma de .env)
scripts/
  preparar_servidor.sh  deja lista una VM Ubuntu nueva (usuario no root, firewall, Docker)
  certificado.sh        obtiene el primer certificado HTTPS
  desplegar.sh          actualiza el servidor con la rama main de GitHub
  publicar_version.sh   publica un instalable grande subido por scp
  vigilar.sh            monitoreo básico (contenedores, salud, disco, memoria)
  respaldo_bd.sh        respaldo diario de la base
docker-compose.yml
.env.example    plantilla de variables (el .env real nunca se sube)
GUIA_AZURE.md   paso a paso para crear el servidor en Azure desde cero
```

## Desarrollo local

Requisitos: Node.js 22.

```bash
cd api
npm install
npm run prueba     # pruebas de la API con base de datos en memoria
```

## Desplegar

### Servidor nuevo

Sigue **[GUIA_AZURE.md](GUIA_AZURE.md)**. Cubre:

- crear la VM en Azure;
- preparar el servidor;
- clonar este repositorio en `/opt/aikukisna`;
- crear el `.env`;
- obtener el certificado HTTPS;
- configurar el monitoreo.

### Actualizar el servidor (cada cambio en `main`)

1. Fusiona los cambios en `main` en GitHub.
2. En el servidor:

   ```bash
   cd /opt/aikukisna
   bash scripts/desplegar.sh
   ```

   El script trae `main`, reconstruye los contenedores, recarga Nginx sin cortar el servicio y comprueba que la API
   responda con el commit nuevo.

### Comprobar que Azure corre la rama `main`

```bash
curl https://aikukisna.chilecentral.cloudapp.azure.com/api/salud
# {"ok":true,"bd":true,"version":"<commit>"}
git log origin/main -1 --format=%h    # debe ser el mismo commit
```

## Publicar una versión de la app

- **Desde el panel** (`/admin/` → pestaña **Cargar**): para instalables de hasta unos cientos de MB.
- **APK grande** (la de Aikukisna pesa ~800 MB porque incluye el modelo de Tuki):

  ```powershell
  # En tu PC
  scp app-arm64-v8a-release.apk aikuadmin@<dominio>:~
  ```

  ```bash
  # En el servidor
  bash scripts/publicar_version.sh ~/app-arm64-v8a-release.apk android 1.0.1 "Notas de la versión"
  ```

La landing ofrece siempre la versión más reciente de cada plataforma.

## Variables de entorno (`.env`)

| Variable | Para qué |
|---|---|
| `DOMINIO` | Dominio del sitio (certificado y Nginx) |
| `CORS_ORIGENES` | Orígenes que pueden llamar a la API desde un navegador |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Base de datos |
| `ADMIN_USUARIO`, `ADMIN_CONTRASENA_HASH` | Acceso al panel (hash bcrypt; cada `$` se escribe `$$`) |
| `JWT_SECRETO` | Firma de las sesiones del panel |
| `MAX_INSTALABLE_MB` | Tamaño máximo de un instalable subido por el panel |

## Errores

Los visitantes nunca ven códigos ni mensajes técnicos:

- **Página inexistente:** muestra `web/404.html` (Tuki y el enlace al inicio).
- **Servidor caído o en mantenimiento:** muestra `web/50x.html`.
- **API:** siempre responde un JSON `{"error": "mensaje claro"}`, también cuando no está disponible.
