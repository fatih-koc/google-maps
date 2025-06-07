Write-Host "Enhanced Google Maps Scraper" -ForegroundColor Cyan
Write-Host "===========================" -ForegroundColor Cyan

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "Error: Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if dependencies are installed
if (!(Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install underscore chalk @vitalets/google-translate-api cli-progress ora fs-extra minimist dotenv xlsx csv-writer puppeteer
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to install dependencies" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Run the scraper with arguments
Write-Host "Starting scraper..." -ForegroundColor Green
node scraper.js @args

if ($LASTEXITCODE -ne 0) {
    Write-Host "Scraper finished with errors" -ForegroundColor Red
} else {
    Write-Host "Scraper completed successfully" -ForegroundColor Green
}

Read-Host "Press Enter to exit"