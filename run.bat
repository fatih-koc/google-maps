@echo off
echo Enhanced Google Maps Scraper
echo ===========================

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo Error: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install underscore chalk @vitalets/google-translate-api cli-progress ora fs-extra minimist dotenv xlsx csv-writer puppeteer
    if errorlevel 1 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Run the scraper with arguments
echo Starting scraper...
node scraper.js %*

pause