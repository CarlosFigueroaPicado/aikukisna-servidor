# Despliegue de Aikukisna en Azure — guía paso a paso

Qué se despliega: la **landing page** (descarga de la APK), el **formulario de solicitud de demo** y el
**panel administrativo** (gestiona las solicitudes y sube los instalables). La app Android sigue usando
Supabase para sus datos; este servidor es el sitio web del proyecto.

```
Internet ──► Nginx :443 (proxy inverso, HTTPS) ──► API Node.js :3000 ──► PostgreSQL :5432
              │  sirve la landing, /admin y /descargas      (red interna de Docker, sin acceso desde internet)
              └─ Certbot renueva el certificado
```

| Entregable | Cómo se cumple | Dónde |
|---|---|---|
| 1. Compilación final | APK de entrega firmada, con R8, recursos reducidos y un APK por arquitectura | Paso 8 |
| 2. Servidor seguro | VM Ubuntu con usuario estándar (no root), SSH solo con llave, firewall, fail2ban, monitoreo y alertas de Azure | Pasos 1–3 y 9 |
| 3. Proxy inverso | Nginx es lo único expuesto (80/443); la API y la base no publican puertos | `nginx/`, `docker-compose.yml` |
| 4. Contenedores | 4 contenedores aislados: `nginx`, `api`, `bd`, `certbot`; la base en una red `internal` | `docker-compose.yml` |
| 5. Conexión y CORS | Variables ocultas en `.env` (permisos 600, fuera de git) y CORS solo para los orígenes permitidos | Pasos 5 y 7 |

---

## Paso 0 — Antes de empezar (en tu PC, una sola vez)

1. Abre **Git Bash** (o PowerShell) y crea una llave SSH para el servidor:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/aikukisna -C "aikukisna-azure"
   ```
   Ponle una frase de contraseña. Se crean `~/.ssh/aikukisna` (privada: **nunca la compartas**) y
   `~/.ssh/aikukisna.pub` (pública: es la que se pega en Azure).
2. Muestra la llave pública para copiarla en el paso 2:
   ```bash
   cat ~/.ssh/aikukisna.pub
   ```

## Paso 1 — Grupo de recursos

Portal de Azure → buscar **Grupos de recursos** → **Crear**:

- Suscripción: **Azure for Students**
- Nombre: `rg-aikukisna`
- Región: **Chile Central**

**Revisar y crear** → **Crear**.

## Paso 2 — Máquina virtual

Portal → **Máquinas virtuales** → **Crear** → **Máquina virtual de Azure**.

**Pestaña Básico**

| Campo | Valor |
|---|---|
| Grupo de recursos | `rg-aikukisna` |
| Nombre | `vm-aikukisna` |
| Región | **(South America) Chile Central** |
| Opciones de disponibilidad | No se requiere redundancia de infraestructura |
| Tipo de seguridad | Inicio seguro (Trusted launch) |
| Imagen | **Ubuntu Server 24.04 LTS – x64 Gen2** |
| Tamaño | **Standard_B2as_v2** (2 vCPU, 8 GB de RAM) — "Ver todos los tamaños" si no aparece |
| Tipo de autenticación | **Clave pública SSH** |
| Nombre de usuario | `aikuadmin` (usuario estándar; Azure no permite `root`) |
| Origen de clave pública SSH | **Usar la clave pública existente** → pega el contenido de `aikukisna.pub` |
| Puertos de entrada públicos | Permitir los puertos seleccionados → **SSH (22)** (HTTP/HTTPS se abren en el paso 2.3) |

**Pestaña Discos**: Disco del SO **SSD estándar**, tamaño **64 GiB** (cada APK pesa cientos de MB).

**Pestaña Redes**: deja la red virtual y la IP pública que propone. Marca **Eliminar IP pública y NIC
cuando se elimine la VM**.

**Pestaña Administración**: activa **Apagado automático** si quieres ahorrar crédito (por ejemplo 23:00).

**Pestaña Supervisión**: **Diagnóstico de arranque** habilitado (cuenta administrada).

**Revisar y crear** → **Crear**. Tarda 1–2 minutos.

### 2.1 IP fija y nombre DNS

1. VM → **Información general** → clic en la **dirección IP pública**.
2. **Configuración**:
   - Asignación: **Estática**
   - Etiqueta de nombre DNS: `aikukisna` (si está ocupado, `aikukisna-hackathon`)
3. **Guardar**. Tu dominio queda como `aikukisna.chilecentral.cloudapp.azure.com`; anótalo, es el `DOMINIO` del paso 5.

### 2.2 Restringir SSH a tu IP

VM → **Redes** → **Configuración de red** → regla **SSH** → Origen: **Mi dirección IP** → Guardar.
(Si cambias de red, actualiza la regla o no podrás entrar).

### 2.3 Abrir HTTP y HTTPS

En la misma pantalla → **Crear regla de puerto** → **Regla de puerto de entrada**:

- Servicio: **HTTP** → Agregar
- Repetir con **HTTPS**

El puerto 80 es necesario para que Let's Encrypt valide el certificado y para redirigir a HTTPS.

## Paso 3 — Preparar el servidor y clonar el repositorio

Entra al servidor desde tu PC (PowerShell):

```powershell
ssh -o IdentitiesOnly=yes -i "$HOME\.ssh\aikukisna" aikuadmin@aikukisna.chilecentral.cloudapp.azure.com
```

Ya dentro del servidor, descarga solo el script de preparación y ejecútalo (cambia la URL por la de tu
repositorio):

```bash
curl -fsSLO https://raw.githubusercontent.com/CarlosFigueroaPicado/aikukisna-servidor/main/scripts/preparar_servidor.sh
bash preparar_servidor.sh
```

El script deja el servidor así:

- **Actualizaciones automáticas** de seguridad.
- **SSH sin root y sin contraseñas.**
- **Firewall `ufw`**: solo 22, 80 y 443.
- **fail2ban** activo.
- **Docker** y **git** instalados.
- Carpeta **`/opt/aikukisna`** creada.

Al terminar **sal y vuelve a entrar** (para usar Docker sin `sudo`) y clona el repositorio:

```bash
exit
```

```bash
git clone https://github.com/CarlosFigueroaPicado/aikukisna-servidor.git /opt/aikukisna
cd /opt/aikukisna
```

> Usa siempre `-o IdentitiesOnly=yes` en `ssh` y `scp`: sin eso, Windows prueba otras llaves guardadas y el
> servidor puede rechazar la conexión.

## Paso 4 — Comprobar el usuario (evidencia del entregable 2)

```bash
whoami                     # aikuadmin
id                         # sin uid=0; grupos sudo y docker
sudo sshd -T | grep -E "permitrootlogin|passwordauthentication"   # no / no
sudo ufw status verbose    # 22, 80, 443
```

Toma captura de esta salida.

## Paso 5 — Variables ocultas (`.env`)

```bash
cd /opt/aikukisna
cp .env.example .env
chmod 600 .env
openssl rand -hex 24    # → POSTGRES_PASSWORD
openssl rand -hex 48    # → JWT_SECRETO
nano .env
```

Completa `DOMINIO`, `CORS_ORIGENES` (`https://` + tu dominio), `POSTGRES_PASSWORD` y `JWT_SECRETO`.
Guarda con `Ctrl+O`, `Enter`, `Ctrl+X`.

Contraseña del panel (se guarda solo su hash):

```bash
docker compose build api
docker compose run --rm --no-deps api npm run hash -- 'una-contraseña-larga-de-12-o-mas'
```

Copia el resultado (`$2b$12$...`) en `ADMIN_CONTRASENA_HASH` **duplicando cada `$`**
(`$$2b$$12$$...`): Docker Compose interpreta `$` como variable.

## Paso 6 — Levantar los contenedores y el HTTPS

```bash
docker compose up -d bd api
bash scripts/certificado.sh tu-correo@ejemplo.com
docker compose up -d
docker compose ps
```

Los 4 servicios deben salir `running` (la API y la base, además, `healthy`).

## Paso 7 — Verificar (evidencias de los entregables 3, 4 y 5)

```bash
# HTTPS y salud de la API a través de Nginx
curl -s https://aikukisna.chilecentral.cloudapp.azure.com/api/salud      # {"ok":true,"bd":true}

# La API y la base NO son accesibles desde fuera (solo Nginx publica puertos)
docker compose ps --format "table {{.Service}}\t{{.Ports}}"

# CORS: un origen permitido recibe la cabecera; uno ajeno no
curl -sI -H "Origin: https://aikukisna.chilecentral.cloudapp.azure.com" https://aikukisna.chilecentral.cloudapp.azure.com/api/salud | grep -i access-control
curl -sI -H "Origin: https://sitio-ajeno.com" https://aikukisna.chilecentral.cloudapp.azure.com/api/salud | grep -i access-control || echo "bloqueado (correcto)"
```

Desde tu PC, comprueba que el puerto de la base está cerrado: `Test-NetConnection aikukisna.chilecentral.cloudapp.azure.com -Port 5432` → `TcpTestSucceeded : False`.

En el navegador:

- `https://<dominio>/` → landing (provisional hasta que tu compañero entregue la suya)
- `https://<dominio>/admin/` → panel: inicia sesión con `ADMIN_USUARIO` y la contraseña del paso 5

## Paso 8 — Compilación final de la APK (entregable 1)

En tu PC, en `D:\Aikukisna` (con `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS` y `KEY_PASSWORD` en
`local.properties`):

```bash
./gradlew :app:assembleRelease -PapkPorArquitectura=true
```

Sale en `app/build/outputs/apk/release/`:

| Archivo | Para quién |
|---|---|
| `app-arm64-v8a-release.apk` | Teléfonos de 2017 en adelante (el que se publica) |
| `app-armeabi-v7a-release.apk` | Teléfonos antiguos de 32 bits |

La versión de entrega ya tiene:

- **R8** (minificación y ofuscación).
- **Reducción de recursos.**
- **Solo ARM**, sin x86.
- El **modelo de Tuki incluido**: funciona sin conexión desde la primera apertura.

Súbela en el panel → **Versiones instalables** → plataforma Android, versión (ej. `1.0.0`) → **Subir**. La landing
mostrará el botón de descarga con esa versión. Cada versión publica su SHA-256 para verificar la descarga.

> La APK de entrega usa otra firma que la de depuración: para instalarla sobre una versión de Android
> Studio hay que desinstalar antes la de depuración.

## Paso 9 — Monitoreo básico (entregable 2)

**En Azure (portal):**

1. VM → **Supervisión** → **Insights** → **Habilitar**. Acepta Azure Monitor Agent y un área de trabajo de
   Log Analytics en Chile Central. Muestra CPU, memoria, disco y red.
2. VM → **Alertas** → **Crear** → **Regla de alertas**. Crea tres reglas:
   - **Percentage CPU** mayor que 80 % durante 5 minutos.
   - **Available Memory Bytes** menor que 500 MB.
   - **VM Availability** menor que 1.
   Para las tres, en **Grupo de acciones** crea `ag-aikukisna` con **correo electrónico** a tu cuenta.
3. **Cost Management** → **Presupuestos** → crea uno de 20 USD con aviso al 80 %, para no agotar el crédito
   de estudiante.

**En el servidor** (vigilancia de contenedores, salud de la API, disco y memoria, más el respaldo diario):

```bash
crontab -e
```

Agrega estas dos líneas:

```
*/5 * * * * bash /opt/aikukisna/scripts/vigilar.sh >> /opt/aikukisna/vigilancia.log 2>&1
30 3 * * * bash /opt/aikukisna/scripts/respaldo_bd.sh >> /opt/aikukisna/vigilancia.log 2>&1
```

Comandos útiles:

```bash
bash scripts/vigilar.sh            # estado actual
docker compose logs -f api         # registros de la API
docker stats --no-stream           # CPU y memoria por contenedor
tail -f vigilancia.log
```

## Paso 10 — Integrar la landing de tu compañero

- **Si se sirve desde este servidor:** copia sus archivos finales (HTML/CSS/JS ya compilados) a
  `/opt/aikukisna/web/`, reemplazando la provisional. No hace falta reiniciar.
- **Si se publica en otro dominio** (por ejemplo Azure Static Web Apps):
  1. Agrega ese origen a `CORS_ORIGENES` en `.env`, separado por coma.
  2. Ejecuta `docker compose up -d api`.
  3. Su código debe llamar a `https://<dominio>/api/...`.

Lo que debe conservar está descrito al inicio de `web/index.html`:

- La descarga sale de `GET /api/versiones`.
- El formulario envía `POST /api/demos` con `nombre`, `correo`, `organizacion`, `telefono` y `mensaje`, más el
  campo oculto `sitio_web` vacío.

## Actualizar el servidor

Cada cambio se fusiona primero en la rama `main` de GitHub; luego, en el servidor:

```bash
cd /opt/aikukisna
bash scripts/desplegar.sh
```

El script trae `main`, reconstruye los contenedores, recarga Nginx sin cortar el servicio y comprueba que
`/api/salud` responda con el commit nuevo. Limpieza ocasional de imágenes viejas: `docker image prune -f`.

## Problemas comunes

| Síntoma | Causa y solución |
|---|---|
| `ssh: connect ... timed out` | Cambió tu IP: actualiza la regla SSH (paso 2.2) |
| Certbot: `Timeout during connect` | Falta la regla HTTP 80 (paso 2.3) o el `DOMINIO` del `.env` no coincide con la etiqueta DNS |
| Nginx se reinicia en bucle | No hay certificado: ejecuta `scripts/certificado.sh` (paso 6) |
| El panel dice "Usuario o contraseña incorrectos" | En `.env` el hash debe llevar `$$` en vez de `$`; luego `docker compose up -d api` |
| La landing no puede enviar el formulario (CORS) | Su origen no está en `CORS_ORIGENES` |
| La subida de la APK se corta | Conexión lenta: el límite es 15 min por subida; súbela desde una red estable |
| `permission denied` con docker | No cerraste la sesión SSH después del paso 3 |

## Probar la API en tu PC (sin Docker)

```bash
cd D:/Aikukisna-servidor/api
npm install
npm run prueba      # 4 pruebas con base de datos en memoria
```
