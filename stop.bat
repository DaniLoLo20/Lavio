@echo off
cd /d "%~dp0"
docker compose down
echo Contenedores detenidos. Los datos y fotografias se conservan en los volumenes Docker.
pause
