@echo off
rem Oversells: double-click to start (Windows). Needs Docker Desktop.
chcp 65001 >nul
title Oversells
cd /d "%~dp0.."

docker info >nul 2>&1
if not errorlevel 1 goto dockerok
if not exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" goto nodocker
echo Docker Desktop ishga tushirilmoqda...
start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
:waitdocker
timeout /t 3 /nobreak >nul
docker info >nul 2>&1
if errorlevel 1 goto waitdocker
:dockerok

echo Oversells ishga tushirilmoqda. Birinchi marta 15-30 daqiqa ketadi, keyin bir necha soniya...
docker compose -f docker-compose.desktop.yml up -d --build
if errorlevel 1 goto failed

echo Oversells tayyorlanmoqda...
:waitapp
timeout /t 2 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://localhost:3000/api/ready | findstr 200 >nul
if errorlevel 1 goto waitapp

rem Opens as an app window (no address bar) in Edge or Chrome.
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%EDGE%" goto edge
if exist "%CHROME%" goto chrome
start "" http://localhost:3000
goto :eof
:edge
start "" "%EDGE%" --app=http://localhost:3000
goto :eof
:chrome
start "" "%CHROME%" --app=http://localhost:3000
goto :eof

:nodocker
echo Docker Desktop topilmadi. Uni https://www.docker.com/products/docker-desktop/ saytidan o'rnating.
pause
exit /b 1

:failed
echo Xato yuz berdi. Yuqoridagi matnni nusxalab yuboring.
pause
exit /b 1
