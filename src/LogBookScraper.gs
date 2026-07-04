/**
 * LogbookScraper.gs - HTML Scraper (Fallback)
 * Scrapes flight data from logbook.glidernet.org HTML page
 * Used when API is unavailable
 */

/**
 * Scrape flights from HTML logbook page
 * @param {string} dateStr - Date in yyyy-mm-dd format, or blank for today
 * @param {string} targetSheet - Sheet name to write to
 */
function fetchFlightsFromHTML(dateStr, targetSheet) {
  const config = getConfig();
  const airportCode = config.AIRPORT_CODE;
  const timezone = config.TIMEZONE;
  const sheetName = targetSheet || config.SHEET_NAME || "Flight Log";
  
  if (!airportCode || !timezone) {
    throw new Error("AIRPORT_CODE and TIMEZONE must be configured in Config sheet");
  }
  
  // Determine date
  const isoDate = dateStr || getTodayISO();
  
  // Parse date for URL
  const parts = isoDate.split("-");
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  const formattedDateForURL = Utilities.formatDate(date, timezone, "ddMMyyyy"); // Format: 04122025
  
  // Get timezone offset
  const timezoneOffset = getTimezoneOffset();
  
  Logger.log("Scraping HTML for " + airportCode + " on " + isoDate);
  Logger.log("Timezone offset: " + timezoneOffset);
  
  // Build URL
  const url = `https://logbook.glidernet.org/index.php?t=0&a=${airportCode}&d=${formattedDateForURL}&s=QFE&u=m&z=${timezoneOffset}`;
  Logger.log("URL: " + url);
  
  try {
    const html = UrlFetchApp.fetch(url).getContentText();
    const flights = parseHTMLFlights(html, isoDate);
    
    Logger.log("Parsed " + flights.length + " flights from HTML");
    
    // Write to sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    flights.forEach(flight => {
      writeFlightToSheet(sheet, flight);
    });
    
    return { success: true, count: flights.length, source: "HTML" };
    
  } catch (e) {
    Logger.log("Error fetching from HTML: " + e.toString());
    throw e;
  }
}

/**
 * Parse HTML table into flight objects
 */
function parseHTMLFlights(rawHtml, isoDate) {
  // Find the second table in the HTML (the flight data table)
  const tableMatches = rawHtml.match(/<TABLE[\s\S]*?<\/TABLE>/gi);
  if (!tableMatches || tableMatches.length < 2) {
    Logger.log("Could not find flight data table");
    return [];
  }
  
  const tableHtml = tableMatches[1];
  
  // Extract all table rows
  const rowMatches = tableHtml.match(/<TR>[\s\S]*?<\/TR>/gi);
  if (!rowMatches) {
    Logger.log("No rows found in table");
    return [];
  }
  
  const flights = [];
  
  rowMatches.forEach(rowHtml => {
    // Extract all cells (both TH and TD)
    const cellMatches = rowHtml.match(/<T[HD][^>]*>([\s\S]*?)<\/T[HD]>/gi);
    if (!cellMatches || cellMatches.length < 5) return;
    
    // Extract text content from each cell
    const cells = cellMatches.map(cell => extractTextFromCell(cell));
    
    // First cell should be a number (row ID)
    const rowID = cells[0].trim();
    if (!/^\d+$/.test(rowID)) return; // Skip header rows and totals
    
    // Check for colspan (totals row)
    if (rowHtml.includes('colspan')) return;
    
    // Get glider registration
    const glider = cells[3] || "";
    
    // Get takeoff time
    const takeOff = cells[6] || "";
    
    // Generate FlightKey using new format
    const flightKey = generateFlightKey(glider, isoDate, takeOff);
    
    // Parse the flight data
    const flight = {
      flightKey: flightKey,
      date: isoDate,
      glider: glider,
      cn: cells[4] || "",
      type: cells[5] || "",
      takeOff: takeOff,
      gLanding: cells[7] || "",
      gTime: cells[8] || "",
      pLanding: cells[9] || "",
      pTime: cells[10] || "",
      maxAlt: cells[11] || "",
      remarks: cells[12] || "",
      source: "HTML",
      // HTML scraper doesn't have quality or code data
      startCode: "",
      stopCode: "",
      startQuality: "",
      stopQuality: "",
      warn: ""
    };
    
    flights.push(flight);
  });
  
  Logger.log("Extracted " + flights.length + " flights from HTML");
  return flights;
}

/**
 * Extract plain text content from a table cell
 */
function extractTextFromCell(cellHtml) {
  // Remove the opening and closing TD/TH tags
  let text = cellHtml.replace(/<\/?T[HD][^>]*>/gi, '');
  
  // Remove all HTML tags but keep the text content
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&apos;/g, "'")
             .replace(/&amp;/g, '&');
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Test function - scrape today's flights from HTML
 */
function testHTMLToday() {
  const result = fetchFlightsFromHTML(null, "Testing");
  Logger.log("Result: " + JSON.stringify(result));
}

/**
 * Test function - scrape specific date from HTML
 */
function testHTMLDate() {
  const result = fetchFlightsFromHTML("2025-12-09", "Testing");
  Logger.log("Result: " + JSON.stringify(result));
}
