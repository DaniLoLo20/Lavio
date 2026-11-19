@echo off
cd /d "%~dp0"
echo ============================================================
echo  ADVERTENCIA: esto BORRA la base de datos y las fotografias
echo  (volumenes autolavado_pgdata y autolavado_uploads).
echo ============================================================
set /p CONFIRM=Escriba BORRAR para continuar: 
if /i not "%CONFIRM%"=="BORRAR" (
  echo Cancelado.
  pause
  exit /b 0
)
docker compose down -v --remove-orphans
docker compose up -d --build
echo Sistema reiniciado con datos limpios.
pause
