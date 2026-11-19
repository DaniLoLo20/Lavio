#!/usr/bin/env bash
# Detiene Lavio (equivalente a stop.bat). Los datos se conservan en los volumenes Docker.
set -euo pipefail
cd "$(dirname "$0")"
docker compose down
echo "Contenedores detenidos. Los datos y fotografias se conservan en los volumenes Docker."
