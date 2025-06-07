#!/usr/bin/env node

/*
Enhanced Google Maps Scraper with Fault-Tolerant Features
Install required packages:
npm install underscore chalk @vitalets/google-translate-api cli-progress ora fs-extra minimist dotenv xlsx csv-writer puppeteer

Usage:
node scraper.js --query "Irrigation Equipment" --countries "IT,ES,MK" --include-cities --localize --parallel 3 --export json,csv,xlsx
*/

import * as _ from 'underscore';
import chalk from 'chalk';
import { translate } from '@vitalets/google-translate-api';
import cliProgress from 'cli-progress';
import ora from 'ora';
import fs from 'fs-extra';
import minimist from 'minimist';
import dotenv from 'dotenv';
import XLSX from 'xlsx';
import createCsvWriter from 'csv-writer';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// User Scripts (preserved and commented)
import { allCountries, statesByCountry, citiesByCountry, citiesByCountryState } from "./utils/countrystatecity.js";
import { countrylocalemap } from "./utils/countrylocalemap.js";
import { searchGoogleMaps } from "./maps/maps.js";
import { getRandomInt } from './utils/helpers.js';
// import { addContactIfNotExists } from "./db/query.js"; // do not use this import

// Configuration
const CONFIG = {
  query: process.env.QUERY || "Irrigation Equipment",
  countries: process.env.COUNTRIES ? process.env.COUNTRIES.split(',') : [],
  includeCities: process.env.INCLUDE_CITIES === 'true' || false,
  localize: process.env.LOCALIZE === 'true' || false,
  parallel: parseInt(process.env.PARALLEL) || 1,
  minDelay: parseInt(process.env.MIN_DELAY) || 10,
  maxDelay: parseInt(process.env.MAX_DELAY) || 100,
  retryCount: parseInt(process.env.RETRY_COUNT) || 0,
  exportFormats: process.env.EXPORT_FORMATS ? process.env.EXPORT_FORMATS.split(',') : ['json']
};

// Parse CLI arguments
const argv = minimist(process.argv.slice(2));

if (argv.query) CONFIG.query = argv.query;
if (argv.countries) CONFIG.countries = argv.countries.split(',');
if (argv['include-cities']) CONFIG.includeCities = true;
if (argv.localize) CONFIG.localize = true;
if (argv.parallel) CONFIG.parallel = parseInt(argv.parallel);
if (argv['min-delay']) CONFIG.minDelay = parseInt(argv['min-delay']);
if (argv['max-delay']) CONFIG.maxDelay = parseInt(argv['max-delay']);
if (argv.retry) CONFIG.retryCount = parseInt(argv.retry);
if (argv.export) CONFIG.exportFormats = argv.export.split(',');

// Help message
if (argv.help || argv.h) {
  console.log(chalk.cyan(`
Enhanced Google Maps Scraper

Usage: node scraper.js [options]

Options:
  --query "search term"         Search query
  --countries "US,CA,UK"        Comma-separated country codes
  --include-cities              Include city-level scraping
  --localize                    Translate queries to local language
  --parallel <number>           Number of parallel tasks (default: 1)
  --min-delay <ms>              Minimum delay between requests (default: 10)
  --max-delay <ms>              Maximum delay between requests (default: 100)
  --retry <number>              Retry count for failed requests (default: 0)
  --export "json,csv,xlsx"      Export formats (default: json)
  --help                        Show this help message

Environment variables can also be used (see .env file)
  `));
  process.exit(0);
}

// Global variables
let allBusinesses = [];
let progressData = {};
let allowedCategories = [];
let currentSpinner = null;
let progressBar = null;

// Colors for different log types
const colors = {
  success: chalk.green,
  error: chalk.red,
  info: chalk.cyan,
  warning: chalk.yellow,
  working: chalk.blue
};

// Graceful shutdown handler
let isShuttingDown = false;
process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(colors.warning('\n\nGraceful shutdown initiated...'));
  if (currentSpinner) currentSpinner.stop();
  if (progressBar) progressBar.stop();
  
  await saveCurrentProgress();
  console.log(colors.success('Progress saved successfully. Exiting...'));
  process.exit(0);
});

// Load allowed categories
async function loadAllowedCategories() {
  try {
    const categoriesPath = path.join(__dirname, 'allowed_categories.txt');
    if (await fs.pathExists(categoriesPath)) {
      const content = await fs.readFile(categoriesPath, 'utf8');
      allowedCategories = content.split('\n').map(line => line.trim()).filter(line => line);
      console.log(colors.info(`Loaded ${allowedCategories.length} allowed categories`));
    }
  } catch (error) {
    console.log(colors.warning('No allowed_categories.txt found, skipping category filtering'));
  }
}

// This saves businesses found in a city to a dedicated file.
async function saveCityResults(businesses, query, country, state, city) {
  try {
    const cityDir = path.join(__dirname, 'output', query, country.iso2, 'cities', state.iso2);
    await fs.ensureDir(cityDir);
    const fileName = `${city.name.replace(/\s+/g, '_')}.json`;
    const filePath = path.join(cityDir, fileName);
    await fs.writeJson(filePath, businesses, { spaces: 2 });
    console.log(colors.success(`Saved ${businesses.length} businesses for city: ${city.name}`));
  } catch (error) {
    console.log(colors.error(`Failed to save city results for ${city.name}: ${error.message}`));
  }
}

// This saves state-level results and calls updateCumulativeResults().
async function saveStateResults(businesses, query, country, state) {
  try {
    const stateDir = path.join(__dirname, 'output', query, country.iso2, 'states');
    await fs.ensureDir(stateDir);
    const fileName = `${state.name.replace(/\s+/g, '_')}.json`;
    const filePath = path.join(stateDir, fileName);
    await fs.writeJson(filePath, businesses, { spaces: 2 });
    console.log(colors.success(`Saved ${businesses.length} businesses for state: ${state.name}`));

    // Update country-level cumulative data
    await updateCumulativeResults(businesses, query, country);
  } catch (error) {
    console.log(colors.error(`Failed to save state results for ${state.name}: ${error.message}`));
  }
}


// This appends new businesses to the country-level cumulative file, avoiding duplicates.
async function updateCumulativeResults(newBusinesses, query, country) {
  const filePath = path.join(__dirname, 'output', query, country.iso2, 'cumulative.json');

  try {
    let existing = [];
    if (await fs.pathExists(filePath)) {
      existing = await fs.readJson(filePath);
    }

    const combined = removeDuplicates([...existing, ...newBusinesses]);
    await fs.writeJson(filePath, combined, { spaces: 2 });
    console.log(colors.info(`Updated cumulative results for ${country.name} with ${combined.length} total businesses.`));
  } catch (error) {
    console.log(colors.error(`Failed to update cumulative results for ${country.name}: ${error.message}`));
  }
}


// Filter businesses by allowed categories
function filterByCategory(businesses) {
  if (allowedCategories.length === 0) return businesses;
  
  return businesses.filter(business => {
    if (!business.category) return true;
    return allowedCategories.some(allowed => 
      business.category.toLowerCase().includes(allowed.toLowerCase())
    );
  });
}

// Remove duplicates
function removeDuplicates(businesses) {
  const seen = new Set();
  return businesses.filter(business => {
    const key = `${business.name}-${business.address}-${business.phone}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Load progress data
async function loadProgress(query, countryCode) {
  try {
    const progressPath = path.join(__dirname, 'output', query, countryCode, 'progress.json');
    if (await fs.pathExists(progressPath)) {
      const data = await fs.readJson(progressPath);
      return data;
    }
  } catch (error) {
    console.log(colors.warning(`Could not load progress for ${countryCode}: ${error.message}`));
  }
  return { completed: { countries: {}, states: {}, cities: {} } };
}

// Save progress data
async function saveProgress(query, countryCode, progressData) {
  try {
    const progressPath = path.join(__dirname, 'output', query, countryCode, 'progress.json');
    await fs.ensureDir(path.dirname(progressPath));
    await fs.writeJson(progressPath, progressData, { spaces: 2 });
  } catch (error) {
    console.log(colors.error(`Failed to save progress: ${error.message}`));
  }
}

// Export functions
async function exportJSON(data, filePath) {
  await fs.writeJson(filePath, data, { spaces: 2 });
}

async function exportCSV(data, filePath) {
  if (data.length === 0) return;
  
  const headers = Object.keys(data[0]).map(key => ({ id: key, title: key }));
  const csvWriter = createCsvWriter.createObjectCsvWriter({
    path: filePath,
    header: headers
  });
  
  await csvWriter.writeRecords(data);
}

async function exportXLSX(data, filePath) {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Businesses');
  XLSX.writeFile(workbook, filePath);
}

// Export results in multiple formats
async function exportResults(businesses, query, countryCode, countryName) {
  const outputDir = path.join(__dirname, 'output', query, countryCode, 'results');
  await fs.ensureDir(outputDir);
  
  for (const format of CONFIG.exportFormats) {
    const filePath = path.join(outputDir, `${countryName.replace(/\s+/g, '_')}.${format}`);
    
    try {
      switch (format.toLowerCase()) {
        case 'json':
          await exportJSON(businesses, filePath);
          break;
        case 'csv':
          await exportCSV(businesses, filePath);
          break;
        case 'xlsx':
          await exportXLSX(businesses, filePath);
          break;
      }
      console.log(colors.success(`Exported ${businesses.length} businesses to ${format.toUpperCase()}: ${filePath}`));
    } catch (error) {
      console.log(colors.error(`Failed to export ${format}: ${error.message}`));
    }
  }
}

// Enhanced search function with retry logic
async function searchMapsWithRetry(query, cityname, statename, countryname, countrycode, retries = CONFIG.retryCount) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const searchQuery = cityname 
        ? `${query} near ${cityname} ${statename} ${countryname}`
        : `${query} near ${statename} ${countryname}`;
      
      const businesses = await searchGoogleMaps(searchQuery, countrycode);
      
      if (businesses) {
        const updatedBusinesses = businesses.map(business => ({
          ...business,
          source_name: 'google',
          source_query: query,
          source_country: countrycode,
          country: countryname,
          state: statename,
          city: cityname || ''
        }));
        
        return filterByCategory(updatedBusinesses);
      }
      
      return [];
    } catch (error) {
      console.log(colors.error(`Attempt ${attempt + 1} failed: ${error.message}`));
      if (attempt === retries) {
        console.log(colors.error(`All retry attempts failed for ${countryname}-${statename}-${cityname}`));
        return [];
      }
      await new Promise(r => setTimeout(r, getRandomInt(1000, 3000)));
    }
  }
}

// Translate query to local language
async function translateQuery(query, targetLanguage) {
  if (!CONFIG.localize || targetLanguage === 'en') return query;
  
  try {
    const { text } = await translate(query, { to: targetLanguage });
    return text;
  } catch (error) {
    console.log(colors.warning(`Translation failed for ${targetLanguage}: ${error.message}`));
    return query;
  }
}

// Process cities concurrently
async function processCitiesConcurrently(cities, state, country, query, localizedQuery) {
  const semaphore = new Array(CONFIG.parallel).fill(null);
  let cityIndex = 0;
  const results = [];
  
  const processBatch = async () => {
    while (cityIndex < cities.length) {
      const city = cities[cityIndex++];
      if (!city) continue;
      
      const cityKey = `${country.iso2}-${state.iso2}-${city.name}`;
      if (progressData.completed?.cities?.[cityKey]) {
        continue; // Skip already completed cities
      }
      
      try {
        const businesses = await searchMapsWithRetry(
          localizedQuery, 
          city.name, 
          state.name, 
          country.name, 
          country.iso2
        );
        
        results.push(...businesses);
        
        // Mark city as completed
        if (!progressData.completed.cities) progressData.completed.cities = {};
        progressData.completed.cities[cityKey] = true;
        
        console.log(colors.working(`✓ ${city.name}, ${state.name}, ${country.name}: ${businesses.length} businesses`));
        
        // Save city results immediately if we have any
        if (businesses.length > 0) {
          await saveCityResults(businesses, query, country, state, city);
        }
        
        await new Promise(r => setTimeout(r, getRandomInt(CONFIG.minDelay, CONFIG.maxDelay)));
      } catch (error) {
        console.log(colors.error(`✗ Failed to process ${city.name}: ${error.message}`));
      }
    }
  };
  
  // Start concurrent processing
  await Promise.all(semaphore.map(() => processBatch()));
  return results;
}

// Process states concurrently
async function processStatesConcurrently(states, country, query, localizedQuery) {
  const results = [];
  
  for (const state of states) {
    if (!state) continue;
    
    const stateKey = `${country.iso2}-${state.name}`;
    if (progressData.completed?.states?.[stateKey]) {
      continue; // Skip already completed states
    }
    
    console.log(colors.info(`Processing state: ${state.name}, ${country.name}`));
    
    let stateBusinesses = [];
    
    if (CONFIG.includeCities) {
      const citiesByState = await citiesByCountryState(country.iso2, state.iso2);
      const shuffledCities = _.shuffle(citiesByState);
      
      if (shuffledCities.length > 0) {
        stateBusinesses = await processCitiesConcurrently(
          shuffledCities, 
          state, 
          country, 
          query, 
          localizedQuery
        );
      }
    } else {
      const businesses = await searchMapsWithRetry(
        localizedQuery, 
        '', 
        state.name, 
        country.name, 
        country.iso2
      );
      stateBusinesses = businesses;
      
      console.log(colors.working(`✓ ${state.name}, ${country.name}: ${businesses.length} businesses`));
    }
    
    results.push(...stateBusinesses);
    
    // Mark state as completed
    if (!progressData.completed.states) progressData.completed.states = {};
    progressData.completed.states[stateKey] = true;
    
    // Save and export results after each state
    if (stateBusinesses.length > 0) {
      await saveStateResults(stateBusinesses, query, country, state);
    }
    
    // Save progress after each state
    progressData.completed.cities[cityKey] = true;

    await saveProgress(query, country.iso2, progressData);
    
    await new Promise(r => setTimeout(r, getRandomInt(CONFIG.minDelay, CONFIG.maxDelay)));
  }
  
  return results;
}

// Save current progress
async function saveCurrentProgress() {
  if (allBusinesses.length > 0) {
    const uniqueBusinesses = removeDuplicates(allBusinesses);
    
    // Group by country and save
    const businessesByCountry = _.groupBy(uniqueBusinesses, 'source_country');
    
    for (const [countryCode, businesses] of Object.entries(businessesByCountry)) {
      const countryName = businesses[0]?.country || countryCode;
      await exportResults(businesses, CONFIG.query, countryCode, countryName);
    }
  }
  
  // Also save any partial progress data
  console.log(colors.info('Saving all partial progress data...'));
}

// Main processing function
async function processCountry(country, query) {
  const spinner = ora(`Processing ${country.name}...`).start();
  currentSpinner = spinner;
  
  try {
    // Load progress for this country
    progressData = await loadProgress(query, country.iso2);
    
    // Check if country is already completed
    if (progressData.completed?.countries?.[country.iso2]) {
      spinner.succeed(`${country.name} already completed, skipping...`);
      return [];
    }
    
    // Get country info and translate query
    const info = await countrylocalemap(country.iso2);
    const language = info.languages ? info.languages[0] : 'en';
    const localizedQuery = await translateQuery(query, language);
    
    if (localizedQuery !== query) {
      console.log(colors.info(`Query translated to ${language}: "${localizedQuery}"`));
    }
    
    // Get states for this country
    const allStates = await statesByCountry(country.iso2);
    const shuffledStates = _.shuffle(allStates);
    
    spinner.text = `Processing ${shuffledStates.length} states in ${country.name}...`;
    
    // Process states
    const countryBusinesses = await processStatesConcurrently(
      shuffledStates, 
      country, 
      query, 
      localizedQuery
    );
    
    // Remove duplicates and export
    const uniqueBusinesses = removeDuplicates(countryBusinesses);
    await exportResults(uniqueBusinesses, query, country.iso2, country.name);
    
    // Mark country as completed
    if (!progressData.completed.countries) progressData.completed.countries = {};
    progressData.completed.countries[country.iso2] = true;
    
    // Save progress
    await saveProgress(query, country.iso2, progressData);
    
    spinner.succeed(colors.success(`✓ ${country.name} completed: ${uniqueBusinesses.length} unique businesses found`));
    
    return uniqueBusinesses;
    
  } catch (error) {
    spinner.fail(colors.error(`✗ Failed to process ${country.name}: ${error.message}`));
    return [];
  } finally {
    currentSpinner = null;
  }
}

// Main execution function
async function main() {
  console.log(colors.info('Enhanced Google Maps Scraper Starting...'));
  console.log(colors.info(`Query: "${CONFIG.query}"`));
  console.log(colors.info(`Parallel tasks: ${CONFIG.parallel}`));
  console.log(colors.info(`Include cities: ${CONFIG.includeCities}`));
  console.log(colors.info(`Localization: ${CONFIG.localize}`));
  console.log(colors.info(`Export formats: ${CONFIG.exportFormats.join(', ')}`));
  
  // Load allowed categories
  await loadAllowedCategories();
  
  // Get all countries and filter by configuration
  let allCountriesData = await allCountries();
  allCountriesData = _.sortBy(allCountriesData, 'name');
  
  let targetCountries;
  if (CONFIG.countries.length > 0) {
    targetCountries = allCountriesData.filter(country => 
      CONFIG.countries.includes(country.iso2)
    );
  } else {
    // Default country codes if none specified
    const defaultCountries = ["IT", "ES", "MK"];
    targetCountries = allCountriesData.filter(country => 
      defaultCountries.includes(country.iso2)
    );
  }
  
  console.log(colors.info(`Processing ${targetCountries.length} countries: ${targetCountries.map(c => c.name).join(', ')}`));
  
  // Process each country
  const startTime = Date.now();
  let totalBusinesses = 0;
  let successfulCountries = 0;
  let failedCountries = 0;
  
  for (const country of targetCountries) {
    if (isShuttingDown) break;
    
    try {
      const businesses = await processCountry(country, CONFIG.query);
      allBusinesses.push(...businesses);
      totalBusinesses += businesses.length;
      successfulCountries++;
    } catch (error) {
      console.log(colors.error(`Failed to process ${country.name}: ${error.message}`));
      failedCountries++;
    }
  }
  
  // Final summary
  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);
  
  console.log(colors.success('\n' + '='.repeat(60)));
  console.log(colors.success('SCRAPING COMPLETE'));
  console.log(colors.success('='.repeat(60)));
  console.log(colors.success(`Total businesses found: ${totalBusinesses}`));
  console.log(colors.success(`Countries processed successfully: ${successfulCountries}`));
  if (failedCountries > 0) {
    console.log(colors.error(`Countries failed: ${failedCountries}`));
  }
  console.log(colors.success(`Total execution time: ${duration} seconds`));
  console.log(colors.success('='.repeat(60)));
}

// Start the scraper
main().catch(error => {
  console.error(colors.error('Fatal error:', error));
  process.exit(1);
});