#!/bin/bash

echo "Enhanced Google Maps Scraper"
echo "==========================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install underscore chalk @vitalets/google-translate-api cli-progress ora fs-extra minimist dotenv xlsx csv-writer puppeteer
    if [ $? -ne 0 ]; then
        echo "Error: Failed to install dependencies"
        exit 1
    fi
fi