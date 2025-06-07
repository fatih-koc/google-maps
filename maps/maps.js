import chalk from "chalk";
import * as cheerio from "cheerio";
import puppeteerExtra from "puppeteer-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import chromium from "@sparticuz/chromium";
import { parseTextforPhoneNumber } from "../utils/phonecheck.js";
import os from "os";
import path from "path";

// Configure stealth plugin with enhanced settings
puppeteerExtra.use(stealthPlugin({
  enabledEvasions: new Set([
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    'defaultArgs',
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    'navigator.webdriver',
    'sourceurl',
    'user-agent-override',
    'webgl.vendor',
    'window.outerdimensions'
  ])
}));

// Browser configuration based on environment
const getBrowserConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isLinux = os.platform() === 'linux';
  const isWindows = os.platform() === 'win32';
  const isMac = os.platform() === 'darwin';
  
  const baseArgs = [
    '--lang=en-US',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=TranslateUI',
    '--disable-ipc-flooding-protection',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-plugins',
    '--disable-preconnect',
    '--disable-component-extensions-with-background-pages',
    '--mute-audio',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];

  // Add memory optimization for Linux/production
  if (isLinux || isProduction) {
    baseArgs.push(
      '--memory-pressure-off',
      '--max_old_space_size=4096'
    );
  }

  // Windows-specific args
  if (isWindows) {
    baseArgs.push('--disable-gpu-sandbox');
  }

  return {
    headless: process.env.PUPPETEER_HEADLESS !== 'false' ? 'new' : false,
    args: baseArgs,
    timeout: 90000,
    protocolTimeout: 90000,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 
                   (isProduction ? chromium.executablePath : undefined),
    defaultViewport: {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: true
    }
  };
};

// Enhanced error handling and retry logic
const withRetry = async (operation, maxRetries = 3, delay = 1000) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      console.log(chalk.yellow(`🔄 Retry ${attempt}/${maxRetries} after error: ${error.message}`));
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
};

// Smart scrolling function with performance optimization
const smartScroll = async (page) => {
  try {
    await page.evaluate(async () => {
      const wrapper = document.querySelector('div[role="feed"]');
      if (!wrapper) throw new Error('Feed wrapper not found');
      
      let totalHeight = 0;
      let stableCount = 0;
      const distance = 800;  // Reduced scroll distance for better loading
      const scrollDelay = 1500;  // Reduced delay
      const maxScrolls = 50;  // Prevent infinite scrolling
      const stabilityThreshold = 3;  // Number of consecutive unchanged heights
      let scrollCount = 0;
      
      let previousHeight = wrapper.scrollHeight;
      
      while (scrollCount < maxScrolls && stableCount < stabilityThreshold) {
        wrapper.scrollBy(0, distance);
        totalHeight += distance;
        scrollCount++;
        
        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, scrollDelay));
        
        const currentHeight = wrapper.scrollHeight;
        
        // Check if height changed
        if (currentHeight === previousHeight) {
          stableCount++;
        } else {
          stableCount = 0;  // Reset counter if height changed
        }
        
        previousHeight = currentHeight;
        
        // Optional: Log progress every 10 scrolls
        if (scrollCount % 10 === 0) {
          console.log(`Scrolled ${scrollCount} times, height: ${currentHeight}`);
        }
      }
      
      return { scrollCount, finalHeight: wrapper.scrollHeight, totalHeight };
    });
  } catch (error) {
    console.warn(chalk.yellow(`⚠️ Scrolling completed with warning: ${error.message}`));
  }
};

// Enhanced business data extraction
const extractBusinessData = ($, placeLinks, country) => {
  const businesses = [];
  const seenIds = new Set();
  
  placeLinks.forEach((el) => {
    try {
      const parent = $(el);
      const url = $(el).attr("href");
      
      if (!url) return;
      
      // Extract unique ID and prevent duplicates
      const sourceId = `ChI${url?.split("?")[0]?.split("ChI")[1]}`;
      if (seenIds.has(sourceId)) return;
      seenIds.add(sourceId);
      
      // Find the business container more reliably
      const businessContainer = parent.closest('div[jsaction]') || parent.parent();
      
      // Extract basic information
      const storeName = businessContainer.find("div.fontHeadlineSmall, .qBF1Pd.fontHeadlineSmall").first().text().trim();
      if (!storeName) return; // Skip if no name found
      
      // Extract rating information
      const ratingElement = businessContainer.find("span.fontBodyMedium > span[aria-label*='star'], .MW4etd");
      const ratingText = ratingElement.attr("aria-label") || ratingElement.text();
      
      // Extract stars and reviews with improved parsing
      let stars = null;
      let numberOfReviews = null;
      
      if (ratingText) {
        const starMatch = ratingText.match(/(\d+(?:\.\d+)?)\s*(?:stars?|★)/i);
        const reviewMatch = ratingText.match(/(\d+(?:,\d+)*)\s*(?:review|отзыв|reseña|avis|recensione)/i);
        
        stars = starMatch ? parseFloat(starMatch[1]) : null;
        numberOfReviews = reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null;
      }
      
      // Extract category and address information
      const bodyDiv = businessContainer.find("div.fontBodyMedium").first();
      const infoElements = bodyDiv.find('span, div').toArray();
      
      let category = '';
      let formattedAddress = '';
      let possiblePhoneText = '';
      
      // Parse information elements more robustly
      infoElements.forEach((elem) => {
        const text = $(elem).text().trim();
        if (!text) return;
        
        // Detect category (usually first non-rating element)
        if (!category && !text.includes('★') && !text.match(/\d+(?:\.\d+)?\s*(?:km|mi)/)) {
          const parts = text.split('·');
          if (parts.length > 0) {
            category = parts[0].trim();
            if (parts.length > 1) {
              formattedAddress = parts[1].trim();
            }
          }
        }
        
        // Detect address patterns
        if (!formattedAddress && (text.includes(',') || text.match(/\d+.*(?:street|st|avenue|ave|road|rd|boulevard|blvd)/i))) {
          formattedAddress = text;
        }
        
        // Collect potential phone number text
        if (text.match(/[\+\d\s\(\)\-\.]{7,}/)) {
          possiblePhoneText += ' ' + text;
        }
      });
      
      // Extract website
      const websiteElement = businessContainer.find('a[data-value="Website"], a[href*="http"]:not([href*="google.com"]):not([href*="maps"])').first();
      const website = websiteElement.attr("href");
      
      // Parse phone numbers
      const phoneNumbers = parseTextforPhoneNumber(possiblePhoneText, country);
      
      // Extract additional metadata
      const priceLevel = businessContainer.find('[aria-label*="Price"], .mgr77e').text().trim();
      const openHours = businessContainer.find('[data-value="Open hours"], .t39EBf').text().trim();
      
      // Build business object
      const business = {
        source_id: sourceId,
        name: storeName,
        category: category || 'Unknown',
        formatted_address: formattedAddress || '',
        phone_number: phoneNumbers || '',
        source_url: url.startsWith('http') ? url : `https://www.google.com${url}`,
        website_url: website || '',
        rating_text: ratingText || '',
        stars: stars,
        number_of_reviews: numberOfReviews,
        price_level: priceLevel || '',
        open_hours: openHours || '',
        extraction_timestamp: new Date().toISOString()
      };
      
      // Only add if we have essential information
      if (business.name && (business.formatted_address || business.phone_number)) {
        businesses.push(business);
      }
      
    } catch (error) {
      console.warn(chalk.yellow(`⚠️ Error extracting business data: ${error.message}`));
    }
  });
  
  return businesses;
};

// Main search function with comprehensive error handling
export async function searchGoogleMaps(query, country) {
  const start = Date.now();
  let browser = null;
  let page = null;
  
  try {
    console.log(chalk.blue(`🔍 Searching: "${query}" in ${country}`));
    
    // Launch browser with retry logic
    browser = await withRetry(async () => {
      const config = await getBrowserConfig();
      return await puppeteerExtra.launch(config);
    });
    
    page = await browser.newPage();
    
    // Set additional headers and user agent
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive'
    });
    
    // Set viewport and user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });
    
    // Navigate to Google Maps
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, {
      timeout: 90000,
      waitUntil: 'domcontentloaded'
    });
    
    // Wait for search results
    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
    } catch (error) {
      // Try alternative selectors
      await page.waitForSelector('[data-value="Directions"], .Nv2PK', { timeout: 10000 });
    }
    
    // Perform smart scrolling
    console.log(chalk.gray('📜 Scrolling to load all results...'));
    await smartScroll(page);
    
    // Extract HTML content
    const html = await page.content();
    console.log(chalk.green('✅ Page content extracted'));
    
    // Parse with Cheerio
    const $ = cheerio.load(html);
    
    // Find place links with multiple selectors
    const aTags = $("a").toArray();
    const placeLinks = aTags.filter(el => {
      const href = $(el).attr("href");
      return href && (
        href.includes("/maps/place/") || 
        href.includes("1s0x") || 
        href.includes("!1s")
      );
    });
    
    console.log(chalk.blue(`🔗 Found ${placeLinks.length} place links`));
    
    // Extract business data
    const businesses = extractBusinessData($, placeLinks, country);
    
    const end = Date.now();
    const duration = Math.floor((end - start) / 1000);
    
    console.log(chalk.green(`✅ Extracted ${businesses.length} businesses in ${duration}s`));
    
    return businesses;
    
  } catch (error) {
    const end = Date.now();
    const duration = Math.floor((end - start) / 1000);
    
    console.error(chalk.red(`❌ Search failed after ${duration}s: ${error.message}`));
    
    // Log additional error context
    if (error.name === 'TimeoutError') {
      console.error(chalk.red('⏰ Timeout occurred - Google Maps may be blocking requests'));
    } else if (error.message.includes('net::ERR_')) {
      console.error(chalk.red('🌐 Network error - Check internet connection'));
    } else if (error.message.includes('Protocol error')) {
      console.error(chalk.red('🔌 Browser protocol error - May need to restart'));
    }
    
    return []; // Return empty array instead of undefined
    
  } finally {
    // Ensure cleanup
    try {
      if (page) {
        await page.close();
      }
      if (browser) {
        await browser.close();
        console.log(chalk.gray('🔒 Browser closed'));
      }
    } catch (cleanupError) {
      console.warn(chalk.yellow(`⚠️ Cleanup warning: ${cleanupError.message}`));
    }
  }
}

// Utility function for batch processing
export async function searchGoogleMapsBatch(queries, country, options = {}) {
  const {
    delay = 2000,
    maxConcurrent = 1,
    onProgress = () => {},
    onError = () => {}
  } = options;
  
  const results = [];
  const chunks = [];
  
  // Split queries into chunks for concurrent processing
  for (let i = 0; i < queries.length; i += maxConcurrent) {
    chunks.push(queries.slice(i, i + maxConcurrent));
  }
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      const chunkPromises = chunk.map(query => searchGoogleMaps(query, country));
      const chunkResults = await Promise.allSettled(chunkPromises);
      
      chunkResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push({
            query: chunk[index],
            businesses: result.value,
            success: true
          });
        } else {
          results.push({
            query: chunk[index],
            businesses: [],
            success: false,
            error: result.reason.message
          });
          onError(chunk[index], result.reason);
        }
      });
      
      onProgress(i + 1, chunks.length, results.flat().length);
      
      // Delay between chunks
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
    } catch (error) {
      console.error(chalk.red(`❌ Batch chunk ${i + 1} failed:`, error.message));
    }
  }
  
  return results;
}