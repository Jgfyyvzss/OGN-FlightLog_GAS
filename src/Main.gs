/**
 * Main.gs - Main Orchestration
 * Coordinates between API and HTML sources
 * Entry points for menu items and triggers
 */

/**
 * Smart fetch - try API first, fall back to HTML
 * @param {string} dateStr - Date in yyyy-mm-dd format, or blank for today
 * @param {string} targetSheet - Sheet name (defaults to FLIGHT_LOG_SHEET_NAME)
 */
function smartFetchFlights(dateStr, targetSheet) {
  const sheetName = targetSheet || FLIGHT_LOG_SHEET_NAME;

  // Initialize sheet if needed
  const sheet = initializeSheet(sheetName);

  const isoDate = dateStr || getTodayISO();

  Logger.log("=== Smart Fetch for " + isoDate + " ===");

  // Try API first
  try {
    Logger.log("Attempting API fetch...");
    const result = fetchFlightsFromAPI(isoDate, sheetName);

    if (result.success && result.count > 0) {
      Logger.log("✓ API fetch successful: " + result.count + " flights");
      return result;
    } else {
      Logger.log("API returned no flights, trying HTML...");
    }
  } catch (apiError) {
    Logger.log("API fetch failed: " + apiError.message);
    Logger.log("Falling back to HTML scraper...");
  }

  // Fall back to HTML
  try {
    Logger.log("Attempting HTML scrape...");
    const result = fetchFlightsFromHTML(isoDate, sheetName);

    if (result.success) {
      Logger.log("✓ HTML scrape successful: " + result.count + " flights");
      return result;
    }
  } catch (htmlError) {
    Logger.log("HTML scrape also failed: " + htmlError.message);
    throw new Error("Both API and HTML sources failed");
  }
}

/**
 * Fetch today's flights (for menu/trigger)
 */
function fetchTodayFlights() {
  return smartFetchFlights(null, null);
}

/**
 * Custom menu
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const flightLogMenu = ui.createMenu("Flight Log")
    .addItem("Fetch Today's Flights", "fetchTodayFlights")
    .addSeparator()
    .addItem("Update UserGuide Links", "updateUserGuideLinks")
    .addSeparator()
    .addSubMenu(
      ui.createMenu("Test Sources")
        .addItem("Test API", "testAPIToday")
        .addItem("Test HTML", "testHTMLToday")
    );

  // Export submenu
  try {
    const exportMenu = ui.createMenu("Exports");
    if (typeof X_ExportRegistry !== 'undefined') {
      X_ExportRegistry.all().forEach(e => {
        exportMenu.addItem(e.name, e.run.name);
      });
      flightLogMenu
        .addSeparator()
        .addSubMenu(exportMenu);
    }
  } catch (error) {
    Logger.log("Export registry not available: " + error.toString());
  }

  flightLogMenu.addToUi();
}

/**
 * Test smart fetch with today's date
 */
function testSmartFetchToday() {
  const result = smartFetchFlights(null, "Testing");
  Logger.log("Final result: " + JSON.stringify(result));
}

/**
 * Test smart fetch with specific date
 */
function testSmartFetchDate() {
  const result = smartFetchFlights("2025-12-29", FLIGHT_LOG_SHEET_NAME);
  Logger.log("Final result: " + JSON.stringify(result));
}
