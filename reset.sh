#!/usr/bin/env bash
# Borra datos y reinicia limpio (equivalente a reset.bat).
set -euo pipefail
cd "$(dirname "$0")"
echo "============================================================"
echo " ADVERTENCIA: esto BORRA la base de datos y las fotografias"
echo " (volumenes autolavado_pgdata y autolavado_uploads)."
echo "============================================================"
read -r -p "Escriba BORRAR para continuar: " CONFIRM
if [ "${CONFIRM,,}" != "borrar" ]; then echo "Cancelado."; exit 0; fi
docker compose down -v --remove-orphans
docker compose up -d --build
echo "Sistema reiniciado con datos limpios."
