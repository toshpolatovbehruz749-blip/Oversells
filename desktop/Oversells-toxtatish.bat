@echo off
rem Stops Oversells (your projects stay saved).
chcp 65001 >nul
cd /d "%~dp0.."
docker compose -f docker-compose.desktop.yml stop
echo Oversells to'xtatildi. Loyihalaringiz saqlangan.
pause
