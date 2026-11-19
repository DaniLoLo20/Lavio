@echo off
setlocal
cd /d "%~dp0"
docker version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker no esta en ejecucion. Abra Docker Desktop e intente de nuevo.
  pause
  exit /b 1
)
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Se creo .env desde .env.example. Cambie los secretos antes de produccion.
)
echo Construyendo e iniciando contenedores...
docker compose up -d --build
if errorlevel 1 (
  echo [ERROR] Fallo docker compose.
  pause
  exit /b 1
)
echo.
echo  App:      http://localhost:3000
echo  API docs: http://localhost:3001/api/docs
echo.
echo  Demo admin:   admin@demo.com / Admin123!
echo  Demo lavador: lavador@demo.com / Lavador123!
echo.
echo (La primera vez el backend tarda unos segundos en preparar la base de datos.)
start "" http://localhost:3000
endlocal
