#!/usr/bin/env bash
# Prepara la máquina virtual Ubuntu de Azure. Ejecutar UNA vez, conectado por SSH con el usuario
# estándar creado en Azure (no root):   bash scripts/preparar_servidor.sh
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "No lo ejecutes como root: usa tu usuario estándar (el script pide sudo cuando lo necesita)." >&2
  exit 1
fi

USUARIO="$(whoami)"
echo "==> Preparando el servidor para el usuario $USUARIO"

echo "==> 1/6 Actualizaciones del sistema y actualizaciones automáticas de seguridad"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git gnupg ufw fail2ban unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> 2/6 SSH: sin root y sin contraseñas (solo llave)"
sudo tee /etc/ssh/sshd_config.d/90-aikukisna.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
MaxAuthTries 3
X11Forwarding no
EOF
sudo systemctl reload ssh || sudo systemctl reload sshd

echo "==> 3/6 Firewall: solo SSH, HTTP y HTTPS"
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo "==> 4/6 fail2ban: bloquea IPs que prueban contraseñas por SSH"
sudo systemctl enable --now fail2ban

echo "==> 5/6 Docker Engine y Docker Compose (repositorio oficial de Docker)"
if ! command -v docker >/dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo systemctl enable --now docker
# Docker publica puertos saltándose ufw; por eso la base y la API no publican ninguno (ver docker-compose.yml).
sudo usermod -aG docker "$USUARIO"

echo "==> 6/6 Carpeta del proyecto"
sudo mkdir -p /opt/aikukisna
sudo chown "$USUARIO:$USUARIO" /opt/aikukisna
chmod 750 /opt/aikukisna

echo
echo "Listo. Cierra la sesión SSH y vuelve a entrar para usar docker sin sudo."
echo "Luego clona el repositorio en /opt/aikukisna (paso 3 de la guía)."
