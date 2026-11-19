#!/usr/bin/env bash
# Levanta Lavio con Docker (equivalente a start.bat). Uso: ./start.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] Docker no esta instalado. Instalelo con: curl -fsSL https://get.docker.com | sh" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "[ERROR] Docker no esta en ejecucion o su usuario no tiene permiso (pruebe: sudo ./start.sh, o sudo usermod -aG docker \$USER)." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "[ERROR] Falta el plugin 'docker compose' (v2)." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  # Genera secretos aleatorios si el .env.example trae marcadores de ejemplo
  gen() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40; }
  for key in POSTGRES_PASSWORD JWT_SECRET SUPERADMIN_PASSWORD; do
    if grep -q "^${key}=" .env; then sed -i "s|^${key}=.*|${key}=$(gen)|" .env; fi
  done
  echo "Se creo .env con secretos aleatorios."\n  echo "Superadmin: $(grep '^SUPERADMIN_EMAIL=' .env | cut -d= -f2-) / $(grep '^SUPERADMIN_PASSWORD=' .env | cut -d= -f2-)  (guardela; tambien esta en .env)"
fi

echo "Construyendo e iniciando contenedores..."
docker compose up -d --build

echo
echo " App:      http://localhost:3000"
echo " API docs: http://localhost:3001/api/docs"
echo
echo " Demo admin:   admin@demo.com / Admin123!"
echo " Demo lavador: lavador@demo.com / Lavador123!"
echo
echo "(La primera vez el backend tarda unos segundos en preparar la base de datos.)"
echo "En un VPS: abra los puertos 3000/3001 o ponga un proxy con HTTPS (necesario para PWA, camara y voz)."
