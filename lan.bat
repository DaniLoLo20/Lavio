@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Ejecute este archivo como ADMINISTRADOR ^(clic derecho ^> Ejecutar como administrador^).
  pause
  exit /b 1
)
netsh advfirewall firewall delete rule name="Lavio LAN" >nul 2>&1
netsh advfirewall firewall add rule name="Lavio LAN" dir=in action=allow protocol=TCP localport=3000 profile=any >nul
echo Puerto 3000 permitido en el firewall de Windows.
echo.
echo Abra desde otro dispositivo de la misma red:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo    http://%%a:3000
echo.
echo Nota: sin HTTPS el navegador del celular no activa camara, microfono ^(Modo Voz^) ni instalacion PWA.
pause
endlocal