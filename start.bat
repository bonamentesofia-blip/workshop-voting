@echo off
echo.
echo  ================================
echo   Workshop Voting - Avvio
echo  ================================
echo.

:: Avvia il server Node in background
echo  [1/2] Avvio server...
start "Workshop Server" cmd /k "cd /d "%~dp0" && node server.js"

:: Aspetta 2 secondi
timeout /t 2 /nobreak >nul

:: Avvia Cloudflare tunnel
echo  [2/2] Avvio tunnel Cloudflare...
start "Cloudflare Tunnel" cmd /k ""%~dp0..\cloudflared.exe" tunnel --url http://localhost:3000"

:: Aspetta che il tunnel sia pronto
timeout /t 5 /nobreak >nul

:: Apri l'admin nel browser
echo.
echo  Apertura Admin nel browser...
start http://localhost:3000/admin

echo.
echo  ================================
echo   Fatto!
echo   1. Copia l'URL da "Cloudflare Tunnel"
echo   2. Incollalo nell'Admin e clicca "Aggiorna QR"
echo  ================================
echo.
pause
