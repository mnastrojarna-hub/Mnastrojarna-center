# Lokální spuštění CNC Sales OS na Windows (PowerShell)
# Spuštění: ve složce projektu napiš   ./start.ps1
# (případně:  powershell -ExecutionPolicy Bypass -File .\start.ps1 )

Set-Location -Path $PSScriptRoot

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "Vytvoren .env.local z .env.example (doplnte tajne klice v Nastaveni nebo v souboru)."
}

Write-Host "Instaluji / aktualizuji zavislosti..."
npm install --no-audit --no-fund

Write-Host "Spoustim vyvojovy server -> http://localhost:3000  (Ctrl+C pro ukonceni)"
npm run dev
