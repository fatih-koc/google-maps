
You are a Node.js developer working with Puppeteer to maintain and optimize your custom Google Maps scraper. Your goal is to rewrite and improve the provided JavaScript script according to the following detailed requirements. At the end of the task, check your code thoroughly for errors and maintain readability.

---

#### Requirements:

1. **Fault-Tolerant Saving**

   * Save scraping results incrementally by country, state, and city at the end of each loop.
   * On script termination or interruption, gracefully save current progress and partial results to avoid data loss.

2. **Duplicate Filtering**

   * Remove any duplicate business entries before saving results.

3. **Persistent Progress Tracking**

   * Track which countries, states, and cities have been fully scraped. 
   * Store progress in `/output/{query}/{country}/progress.json`. Use nested structure for country,state,city. /Query folder name is dynamic given query in cli or enviroment.
   * Avoid re-scraping already completed locations.

4. **City Inclusion via CLI and `.env`**

   * Allow specifying if cities are looped or not both through command-line arguments and environment variables.

5. **Export Results**

   * Export or update results under `/output/{query}/{country}/{results}.(json,csv,xlsx)` folder, grouped by query name. /Query folder name is dynamic given query in cli or enviroment.
   * Support exporting data as JSON, CSV, and Excel (.xlsx).
   * Ensure export functions for all formats are implemented and run at the end of each country/state loop.


6. **Improved CLI UX**

   * Display businesses found after each city/state scraping.
   * Show progress bars with: current state and city, elapsed items, remaining items, estimated time, and status (success/error).
   * Provide a detailed summary after each country with total businesses found, using green text for success and red for errors.

7. **Colored Task Logs**

   * Use different colors for logs indicating states: success (green), working (blue/yellow), error (red), info (cyan).
   * Integrate `cli-progress` and `ora` packages for dynamic progress bars and spinners.

8. **Parallelism & Throttling**

   * Implement multithreaded scraping for faster execution without using `puppeteer-cluster` by default.
   * Allow configuring parallel task limits.

9. **Query Localization**

   * Optionally translate queries into the target country’s native language before scraping.
   * Save original query alongside translated queries.
   * Default to false (disabled).

10. **CLI Configuration Options**

    * Support CLI flags and `.env` variables for:

      * Query term(s)
      * Target countries
      * Min and max delay between requests
      * Localization toggle
      * Parallel task limit
      * Export format(s) (json, csv, xlsx) by country

11. **Category Filtering**

    * Use an `allowed_categories.txt` file at the project root to filter results by business categories.

12. **Retry Logic**

    * Implement retry mechanisms for transient scraping errors.
    * Make retry count configurable via CLI and `.env`, default 0 (disabled).

13. **Code Quality & Instructions**

    * Optimize for speed and error handling.
    * Maintain clear, readable, modular code.
    * Provide all code as a monolithic script, ready to copy-paste.
    * Include instructions for any required package installations.

14. **Respect Existing User Code**

    * Keep all user imports and existing functions under `/maps` and `/utils` intact and commented.
    * Avoid any breaking changes to user code.


14. **Implement Concurrency**
    * Maintain existing fault-tolerant saving and progress tracking mechanisms. 
    * Avoid external cluster libraries like puppeteer-cluster; use native Promise concurrency patterns.
    * Preserve graceful shutdown and retry logic.
    * Show progress bars and status updates during concurrent scraping.
    * Keep the concurrency logic modular and clean to integrate easily into the current scraper codebase.

<!-- THIS IS CODE TO BE REWRITING. CHECK FOR ERRORS. RETUN FINAL SCRIPT. -->


import * as _ from 'underscore';
import chalk from 'chalk';

import { translate } from '@vitalets/google-translate-api';


// User Scripts
import { allCountries, statesByCountry, citiesByCountry, citiesByCountryState } from "./utils/countrystatecity.js";
import { countrylocalemap } from "./utils/countrylocalemap.js";
import { searchGoogleMaps } from "./maps/maps.js";
import { getRandomInt } from './utils/helpers.js';
// import { addContactIfNotExists } from "./db/query.js"; // do not use this import


let query = "Irrigation Equipment";
const include_cities = false;

// const countrycode = 'GR';
// const countrycodes = ['AL', 'AD', 'AM', 'AT', 'BY', 'BE', 'BA', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FO', 'FI', 'FR', 'GB', 'GE', 'GI', 'GR', 'HU', 'HR', 'IE', 'IS', 'IT', 'LT', 'LU', 'LV', 'MC', 'MK', 'MT', 'NO', 'NL', 'PO', 'PT', 'RO', 'RU', 'SE', 'SI', 'SK', 'SM', 'TR', 'UA', 'VA'];
// const countrycodes = ['DZ', 'EG', 'SA', 'AE', 'TN'];
// const countrycodes = ['GT', 'MX', 'SA', 'AE', 'TN']; // Latin America


const latinAmericaISO2Codes = [
  // "AR", // Argentina // done
  // "BO", // Bolivia // done
  // "BR", // Brazil // done
  // "CL", // Chile // done
  // "CO", // Colombia // done
  // "CR", // Costa Rica // done
  // "CU", // Cuba // skip
  // "DO", // Dominican Republic // done
  // "EC", // Ecuador // done
  // "SV", // El Salvador // done
  // "GT", // Guatemala // done
  // "HN", // Honduras // done
  // "MX", // Mexico // done
  // "NI", // Nicaragua // done
  // "PA", // Panama // done
  // "PY", // Paraguay // done
  // "PE", // Peru // done
  // "PR", // Puerto Rico // done
  // "UY", // Uruguay // done
  // "VE"  // Venezuela // skip
];

const northAfricaISO2Codes = [
  // "DZ", // Algeria
  // "EG", // Egypt
  // "LY", // Libya // done
  // "MA", // Morocco // done
  // "SD", // Sudan // done
  // "TN"  // Tunisia // done
];

const southEuropeISO2Codes = [
  // "AL", // Albania
  // "AD", // Andorra
  // "BA", // Bosnia and Herzegovina
  // "HR", // Croatia
  // "CY", // Cyprus
  // "GR", // Greece
  // "VA", // Vatican City // skip
  // "IT", // Italy
  // "MT", // Malta
  // "ME", // Montenegro
  // "PT", // Portugal
  // "SM", // San Marino // skip
  // "RS", // Serbia
  // "SI", // Slovenia
  // "ES", // Spain
  // "MK"  // North Macedonia
];

const arabicSpeakingISO2Codes = [
  // "DZ", // Algeria
  // "BH", // Bahrain
  // "KM", // Comoros
  // "DJ", // Djibouti
  // "EG", // Egypt
  // "IQ", // Iraq
  // "JO", // Jordan
  // "KW", // Kuwait
  // "LB", // Lebanon
  // "LY", // Libya
  // "MR", // Mauritania
  // "MA", // Morocco
  // "OM", // Oman
  // "PS", // Palestine
  // "QA", // Qatar
  // "SA", // Saudi Arabia
  // "SO", // Somalia
  // "SD", // Sudan
  // "SY", // Syria
  // "TN", // Tunisia
  // "AE", // United Arab Emirates
  // "YE"  // Yemen
];


// const countrycodes = northAfricaISO2Codes;

// const countrycodes = northAfricaISO2Codes.concat(southEuropeISO2Codes);

const countrycodes = [
  // "DZ", // Algeria // done
  // "MA", // Morocco //  done  
  // "BA", // Bosnia and Herzegovina  // done
  // "GR", // Greece  // done
  "IT", // Italy  //
  // "RS", // Serbia  // done
  "ES", // Spain  //
  "MK",  // North Macedonia  //
  //"BG",  // Bulgaria  //
  "// AZ", // Azerbaijan (Azerbeycan)   // done
  // "UZ", // Uzbekistan (Özbekistan)   // done
  // "RO", // Romania (Romanya)   // done
  //"PL"  // Poland (Polonya)   //
];


const searchMaps = async (query, cityname, statename, countryname, countrycode) => {
  const businesses = await searchGoogleMaps(`${query} near ${cityname} ${statename} ${countryname}`, countrycode)

  let updated_businesses = []

  if (businesses) {
    businesses.forEach((business) => {
      const metadata = { source_name: 'google', source_query: query, source_country: countrycode, country: countryname, state: statename, city: cityname }
      const updated_business = { ...business, ...metadata }
      updated_businesses.push(updated_business)
      return updated_businesses;
    })
  }
  
  // console.log(`Searched ${query} in ${countryname} ${statename} ${cityname} -> ${updated_businesses.length} `)
  console.log(chalk.rgb(255, 136, 0).inverse.bold(`Searched ${query} in ${countryname} ${statename} ${cityname} -> ${updated_businesses.length} `));
  updated_businesses.forEach((contact) => {
    addContactIfNotExists(contact)
  })

}


let all_countries = await allCountries()
all_countries = _.sortBy(all_countries, 'name');

let countries = _.shuffle(all_countries.filter(country => countrycodes.includes(country.iso2)));




for (const country of countries.sort()) {


  // console.log(`${country.name}`)

  const info = await countrylocalemap(country.iso2);

  const language = info.languages ? info.languages[0] : 'en';
  const countrycode = country.iso2;

  // const { text } = await translate(query, { to: language });

  // try {
  //   const { text } =  await translate(query, { to: language });
  // } catch (e) {
  //   if (e.name === 'TooManyRequestsError') {
  //     // retry with another proxy agent
  //   }
  // }


  // let query = text;
  // console.log(language, text);

  const states_by_country = await statesByCountry(country.iso2)

  // const states = states_by_country;

  // const states = _.sortBy(states_by_country, 'name');
  const states = _.shuffle(states_by_country);




  // Main Code
  for (const state of states) {
    if (state) {


      // console.log(state.name)

      if (include_cities) {
        const cities_by_state = await citiesByCountryState(country.iso2, state.iso2);
        // const cities = _.sortBy(cities_by_state, 'name');
        const cities = _.shuffle(cities_by_state);
  
        for (const city of cities) {
          if (city) {
            const cityname = city.name;
            const statename = state.name;
            const countryname = country.name;
            // console.log(query, cityname, statename, countryname, countrycode);

            await searchMaps(query, cityname, statename, countryname, countrycode);
            await new Promise(r => setTimeout(r, getRandomInt(10, 100)));

          }

        }
        // await new Promise(r => setTimeout(r, getRandomInt(1000, 10000)));

      }
      else{
        const statename = state.name;
        const countryname = country.name;

        // console.log(query, statename, countryname, countrycode);

        await searchMaps(query, '', statename, countryname, countrycode);

        await new Promise(r => setTimeout(r, getRandomInt(10, 100)));
    
      }
    }



  }

  console.log(`${country.iso2} is done.`);

  // await new Promise(r => setTimeout(r, getRandomInt(1000, 30000)));

}


