/**
 * Main.gs - Main Orchestration
 * Coordinates between API and HTML sources
 * Entry points for menu items and triggers
 */

/**
 * Smart fetch - tries one source first, falls back to the other.
 * Order is controlled by Config.DATA_SOURCE_PRIORITY (see
 * getDataSourcePriority() in Config.gs); defaults to API first.
 * @param {string} dateStr - Date in yyyy-mm-dd format, or blank for today
 * @param {string} targetSheet - Sheet name (defaults to FLIGHT_LOG_SHEET_NAME)
 */
function smartFetchFlights(dateStr, targetSheet) {
  const sheetName = targetSheet || FLIGHT_LOG_SHEET_NAME;

  // Initialize sheet if needed
  const sheet = initializeSheet(sheetName);

  const isoDate = dateStr || getTodayISO();

  const priority = getDataSourcePriority();
  const sources = priority === DATA_SOURCE_PRIORITY.HTML_FIRST
    ? [{ name: 'HTML', fn: fetchFlightsFromHTML }, { name: 'API',  fn: fetchFlightsFromAPI  }]
    : [{ name: 'API',  fn: fetchFlightsFromAPI  }, { name: 'HTML', fn: fetchFlightsFromHTML }];

  Logger.log(`=== Smart Fetch for ${isoDate} (priority: ${priority}) ===`);

  let lastError = null;
  for (const source of sources) {
    try {
      Logger.log(`Attempting ${source.name} fetch...`);
      const result = source.fn(isoDate, sheetName);

      if (result.success && result.count > 0) {
        Logger.log(`✓ ${source.name} fetch successful: ${result.count} flights`);
        return result;
      } else {
        Logger.log(`${source.name} returned no flights, trying next source...`);
      }
    } catch (err) {
      Logger.log(`${source.name} fetch failed: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error(`Both API and HTML sources failed or returned no flights.` +
    (lastError ? ` Last error: ${lastError.message}` : ''));
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
