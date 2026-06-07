@echo off
REM Lokalni spusteni CNC Sales OS na Windows - staci dvojklik na tento soubor.
cd /d "%~dp0"

if not exist ".env.local" (
  copy ".env.example" ".env.local" >nul
  echo Vytvoren .env.local z .env.example.
)

echo Instaluji / aktualizuji zavislosti...
call npm install --no-audit --no-fund

echo Spoustim vyvojovy server -> http://localhost:3000  (Ctrl+C pro ukonceni)
call npm run dev
