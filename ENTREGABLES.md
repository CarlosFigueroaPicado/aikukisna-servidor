# Entregables del despliegue — dónde está cada uno

Guía para la defensa: para cada entregable, **qué se hizo**, **dónde está** (código, servidor y portal de
Azure) y **cómo comprobarlo** en vivo.

| Dato | Valor |
|---|---|
| Sitio | https://aikukisna.chilecentral.cloudapp.azure.com |
| Repositorio del servidor | https://github.com/CarlosFigueroaPicado/aikukisna-servidor (rama `main`) |
| Repositorio de la app | https://github.com/CarlosFigueroaPicado/Aikukisna |
| Portal de Azure | Suscripción **Azure for Students** → grupo de recursos **`rg-aikukisna`** → VM **`vm-aikukisna`** |
| Carpeta del proyecto en el servidor | `/opt/aikukisna` (clon de este repositorio) |

Para entrar al servidor (PowerShell):

```powershell
ssh -o IdentitiesOnly=yes -i "$HOME\.ssh\aikukisna" aikuadmin@aikukisna.chilecentral.cloudapp.azure.com
```

---

## 1. Compilación final

> Entregar la app (web o móvil) ultra rápida, comprimida y lista para producción.

**Qué se hizo**

- **APK de producción firmada** (versión 1.0.1) con la llave de entrega. La firma tiene el SHA-1
  `99:24:E1:35:20:80:CD:86:60:31:A7:B1:5A:8E:1D:F2:83:0A:CE:46`, registrado en Google para el inicio de sesión.
- **R8:** minifica y ofusca el código.
- **Reducción de recursos:** elimina los recursos que la app no usa.
- **Un APK por arquitectura:** `arm64-v8a` para los teléfonos actuales y `armeabi-v7a` para los antiguos. Se quitan
  las librerías x86 de emulador (unos 175 MB menos).
- **El modelo de Tuki va incluido:** la app funciona sin conexión desde la primera apertura. Pesa 798 MB en total;
  el modelo ocupa 546 MB y no se puede comprimir más, porque ya está cuantizado a 4 bits.
- **Sitio web:** imágenes optimizadas (de 524 KB a 218 KB), compresión gzip y caché de 7 días en Nginx. La landing
  carga en menos de 0,5 s.

**Dónde está**

| Qué | Dónde |
|---|---|
| Configuración de la compilación | Repositorio de la app: `app/build.gradle.kts`. R8 y reducción de recursos en las líneas 71–72, firma en la 77, división por arquitectura en la 85, versión en la 35 |
| APK publicada | https://aikukisna.chilecentral.cloudapp.azure.com/descargas/aikukisna-android-1.0.1.apk |
| Lista de versiones publicadas | Panel `/admin/` → pestaña **Cargar** · API: `/api/versiones` |
| Optimización web | `nginx/templates/aikukisna.conf.template` (gzip y caché) · `web/img/` |

**Cómo comprobarlo**

```bash
# Comando para compilar la APK (en el repositorio de la app)
./gradlew :app:assembleRelease -PapkPorArquitectura=true

# Versión publicada, tamaño y huella SHA-256
curl https://aikukisna.chilecentral.cloudapp.azure.com/api/versiones
```

---

## 2. Servidor seguro

> Crear y administrar el servidor en Azure usando un usuario estándar (no 'root') e incluir monitoreo básico.

**Qué se hizo**

| Medida | Detalle |
|---|---|
| Servidor | Máquina virtual Ubuntu Server 24.04 LTS, tamaño **Standard_B2as_v2** (2 vCPU, 8 GB), región **Chile Central**, disco SSD de 64 GiB, IP fija |
| Usuario estándar | **`aikuadmin`** (`uid=1000`). Usa `sudo` solo cuando hace falta; nunca se trabaja como `root` |
| SSH | Solo con llave Ed25519. Contraseñas desactivadas, `root` sin acceso, máximo 3 intentos |
| Firewall del sistema | `ufw`: solo permite los puertos 22, 80 y 443 |
| Firewall de Azure | Grupo de seguridad de red `vm-aikukisna-nsg`: SSH solo desde la red del equipo; HTTP y HTTPS abiertos |
| Protección contra ataques | `fail2ban` bloquea las IP que intentan adivinar el acceso SSH |
| Actualizaciones | `unattended-upgrades` aplica solo los parches de seguridad |
| Monitoreo en Azure | **Azure Monitor / Insights** con métricas OpenTelemetry (CPU, memoria, disco, red y procesos). **Alertas recomendadas** por correo: disponibilidad de la VM y 7 reglas de métricas |
| Monitoreo en el servidor | `scripts/vigilar.sh` cada 5 minutos (cron): estado de los contenedores, salud de la API, disco y memoria |
| Respaldos | `scripts/respaldo_bd.sh` todos los días a las 3:30 (cron); guarda 14 días |
| Costos | Presupuesto `presupuesto-aikukisna` de 20 USD con aviso al 80 % |

**Dónde está**

| Qué | Dónde |
|---|---|
| Script que deja el servidor seguro | `scripts/preparar_servidor.sh`: SSH en las líneas 22–23, `ufw` en la 33 y siguientes, `fail2ban` en la 39 |
| Configuración de SSH en el servidor | `/etc/ssh/sshd_config.d/90-aikukisna.conf` |
| Máquina virtual | Portal → `rg-aikukisna` → **vm-aikukisna** → Información general |
| Reglas de red | Portal → vm-aikukisna → **Redes** → Configuración de red |
| Monitoreo | Portal → vm-aikukisna → **Supervisión** (disponibilidad y alertas) · Supervisión → **Insights** (gráficas) |
| Alertas | Portal → vm-aikukisna → Supervisión → **Alertas** → Reglas de alerta |
| Presupuesto | Portal → **Administración de costos** → Presupuestos |
| Registro de vigilancia | Servidor: `/opt/aikukisna/vigilancia.log` |

**Cómo comprobarlo** (en el servidor)

```bash
whoami; id                                   # aikuadmin, uid=1000 (no root)
sudo sshd -T | grep -E "permitrootlogin|passwordauthentication"   # no / no
sudo ufw status                              # 22, 80, 443
sudo fail2ban-client status sshd
crontab -l                                   # vigilar.sh y respaldo_bd.sh
bash /opt/aikukisna/scripts/vigilar.sh       # OK disco=..% memoria_libre=..MB
```

---

## 3. Proxy inverso

> Usar Nginx o Apache para recibir el tráfico web; nunca exponer el código directamente a internet.

**Qué se hizo**

- **Nginx 1.27 es el único servicio expuesto a internet**, en los puertos 80 y 443.
- La API (Node.js, puerto 3000) y PostgreSQL (5432) **no publican puertos**. Solo Nginx los alcanza, por la red
  interna de Docker.
- Nginx se encarga de:
  - **HTTPS** con Let's Encrypt, renovado automáticamente.
  - Redirigir de HTTP a HTTPS.
  - Las cabeceras de seguridad: HSTS, X-Frame-Options y nosniff.
  - El límite de peticiones a la API.
  - Las páginas de error amigables (404 y 50x).
  - Servir la landing, el panel y las descargas.

**Dónde está**

| Qué | Dónde |
|---|---|
| Configuración de Nginx | `nginx/templates/aikukisna.conf.template`: HTTP→HTTPS en las líneas 8–17, HTTPS en la 22, certificado en la 27, proxy a la API en las 86 y 99, errores desde la 45 |
| Cabeceras de seguridad | `nginx/templates/seguridad.inc` |
| Único puerto publicado | `docker-compose.yml`, servicio `nginx` (`ports:` 80 y 443) |
| Certificado | Contenedor `certbot`, que lo renueva cada 12 h. Vence el 7 de enero de 2027 y se renueva solo |

**Cómo comprobarlo**

```bash
curl -I http://aikukisna.chilecentral.cloudapp.azure.com     # 301 → https://
curl -I https://aikukisna.chilecentral.cloudapp.azure.com    # Server: nginx, Strict-Transport-Security
docker compose ps --format "table {{.Service}}\t{{.Ports}}"  # solo nginx tiene puertos publicados
```

```powershell
# Desde una PC: la base y la API no son accesibles desde internet
Test-NetConnection aikukisna.chilecentral.cloudapp.azure.com -Port 5432   # False
Test-NetConnection aikukisna.chilecentral.cloudapp.azure.com -Port 3000   # False
```

---

## 4. Contenedores

> Usar Docker o entornos estrictamente aislados para ejecutar el proyecto y la base de datos.

**Qué se hizo**

| Contenedor | Imagen | Función | Aislamiento |
|---|---|---|---|
| `nginx` | nginx:1.27-alpine | Proxy inverso y archivos estáticos | Redes `web`; archivos en solo lectura; `no-new-privileges` |
| `api` | Construida desde `api/Dockerfile` (Node 22) | API REST | Redes `interna` y `web`; **sistema de archivos de solo lectura**; usuario sin privilegios `node`; `no-new-privileges` |
| `bd` | postgres:17-alpine | Base de datos | **Solo red `interna`, sin salida a internet** (`internal: true`) |
| `certbot` | certbot/certbot:v3.1.0 | Certificado HTTPS | Red `web` |

- Todos tienen **reinicio automático** (`restart: unless-stopped`) y registros con rotación.
- La API y la base tienen **chequeos de salud**: la API no arranca hasta que PostgreSQL responde.
- Los datos viven en **volúmenes de Docker** (`datos_bd`, `descargas`, `certbot_*`) y sobreviven a reinicios y
  actualizaciones.

**Dónde está**

| Qué | Dónde |
|---|---|
| Definición de los contenedores | `docker-compose.yml`: red interna en la línea 84, API en solo lectura en la 45, reinicio automático en las 15, 32, 52 y 72 |
| Imagen de la API | `api/Dockerfile` (usuario `node`, chequeo de salud) |
| En el servidor | `/opt/aikukisna` |

**Cómo comprobarlo** (en el servidor)

```bash
cd /opt/aikukisna
docker compose ps            # 4 contenedores Up; bd y api (healthy)
docker network inspect aikukisna_interna --format '{{.Internal}}'   # true
docker compose exec api whoami                                     # node (no root)
```

---

## 5. Conexión y CORS

> La app debe funcionar en Azure usando variables ocultas y con los permisos de red (CORS) correctamente configurados.

**Qué se hizo**

- **Variables ocultas.** Todos los secretos (contraseña de PostgreSQL, secreto JWT, hash de la contraseña del
  panel) y la configuración (dominio, orígenes CORS) están en **`/opt/aikukisna/.env`**:
  - Solo existe en el servidor, con permisos `600`: únicamente el usuario `aikuadmin` lo puede leer.
  - Está excluido de git (`.gitignore`).
  - En el repositorio solo está la plantilla sin valores, `.env.example`.
  - Docker Compose entrega las variables a cada contenedor.
- **CORS.** La API solo acepta llamadas desde navegador de los orígenes listados en `CORS_ORIGENES`. Un sitio
  ajeno no recibe la cabecera `Access-Control-Allow-Origin`, así que su navegador bloquea la respuesta.
- **Otras protecciones de la conexión:**
  - Las sesiones del panel usan **JWT** en una cookie `HttpOnly`, `Secure` y `SameSite=Strict`.
  - La contraseña del panel se guarda solo como hash **bcrypt**.
  - Límite de peticiones en el formulario (5 cada 15 min) y en el inicio de sesión (10 cada 15 min).
- **La app funciona en Azure:**
  - La landing, el formulario y el panel consumen la API a través de Nginx.
  - La app Android se descarga desde el servidor.
  - `/api/salud` confirma la API, la conexión con la base y el commit desplegado.

**Dónde está**

| Qué | Dónde |
|---|---|
| Variables reales | Servidor: `/opt/aikukisna/.env` (permisos 600) |
| Plantilla sin valores | `.env.example` |
| Exclusión de git | `.gitignore` (línea `.env`) |
| Cómo llegan a los contenedores | `docker-compose.yml` (`env_file: .env` y `${...}`) |
| Configuración de CORS | `api/src/app.js`, líneas 33–35 |
| Sesión JWT y bcrypt | `api/src/app.js`, líneas 93–97 |
| Límite de peticiones | `api/src/app.js`, líneas 59 y 86 |
| Prueba automática de CORS | `api/pruebas/api.test.js`, prueba "CORS solo permite el origen configurado" |
| Verlas desde Azure | Portal → vm-aikukisna → **Operaciones** → **Ejecutar comando** → RunShellScript (comando abajo) |

**Cómo comprobarlo**

Desde el portal (Ejecutar comando → RunShellScript). Muestra los nombres y oculta los valores:

```bash
cd /opt/aikukisna && ls -l .env && sed -E 's/^([A-Z_]+)=.*/\1=********/' .env | grep -v '^#' | grep -v '^$'
```

Desde cualquier PC, para CORS:

```bash
# Origen permitido: responde con Access-Control-Allow-Origin
curl -sI -H "Origin: https://aikukisna.chilecentral.cloudapp.azure.com" https://aikukisna.chilecentral.cloudapp.azure.com/api/salud | grep -i access-control

# Origen ajeno: no recibe la cabecera (el navegador lo bloquea)
curl -sI -H "Origin: https://sitio-ajeno.com" https://aikukisna.chilecentral.cloudapp.azure.com/api/salud | grep -i access-control

# Conexión API ↔ base de datos y commit desplegado
curl https://aikukisna.chilecentral.cloudapp.azure.com/api/salud
```

---

## Operación diaria

| Tarea | Cómo |
|---|---|
| Apagar el servidor (ahorra crédito) | Portal → vm-aikukisna → **Detener** (estado "Desasignada") |
| Encenderlo | Portal → vm-aikukisna → **Iniciar**. Los contenedores arrancan solos |
| Actualizar desde GitHub | En el servidor: `cd /opt/aikukisna && bash scripts/desplegar.sh` |
| Publicar una APK nueva | `scp` al servidor y `bash scripts/publicar_version.sh <apk> android <versión> "<notas>"` |
| Ver los registros de la API | `docker compose logs -f api` |
