/**
 * WebApp.gs - Web Application Functions
 * Handles webapp serving and API calls from webapp.
 *
 * Changes from original:
 * - getPilotList(), getPaxList(), getTugPilotList() replaced by getPeopleData() (People.gs)
 * - getWebappData() updated to use getPeopleData()
 * - submitPilotData() gains winchDriver parameter (writes to TowPilot column)
 * - updateFlight() gains winchDriver parameter (writes to TowPilot column)
 * - addManualGliderFlight() passes winchDriver through towPilot field (unchanged structurally)
 */

/**
 * Serve the webapp HTML
 */
function doGet(e) {
  if (e && (e.parameter.action === 'accountingExport' || e.parameter.action === 'managerExport')) {
    return serveAccountingExportsPage();
  }
  if (e && e.parameter.action === 'backup') {
    return HtmlService.createHtmlOutput(buildBackupPage())
      .setTitle('Script Backup')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  const clubAbbr = getConfigValue('CLUB_ABBREVIATION', false) || '';
  return HtmlService.createHtmlOutputFromFile('FlightLogForm')
    .setTitle((clubAbbr ? clubAbbr + ' ' : '') + 'Flight Log - Pilot Entry')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Handles button on flight export page
 */
function runManagerExportFromWebapp(password) {
  const expectedPassword = Config.get('EXPORT_PASSWORD');
  if (password !== expectedPassword) {
    return { error: 'Incorrect password.' };
  }

try {
    Costs.assertConfigured([
      'WINCH_FEE',
      'TOW_RATE_TIME',
      'TOW_RATE_ALT'
    ]);
    X_Audit.log('EXPORT_START', MANAGER_EXPORT_ID);

    const { tsv, batchId, eligible, noBillFlights } = generateManagerExport();

    getExportFolder().createFile(
      Utilities.newBlob(tsv, 'text/csv', 'ManagerExport_' + batchId + '.csv')
    );

    let summary = '';
    if (noBillFlights.length > 0) {
      summary = noBillFlights.length + " flight(s) marked 'No Bill' (included at $0):\n" +
        noBillFlights.map(f => '  ' + f.pilot + ' — ' + f.date + ' ' + f.glider +
          (f.remarks ? ' (' + f.remarks + ')' : '')).join('\n');
    }

    return { tsv: tsv, count: eligible.length, batchId: batchId, summary: summary };

  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Get all webapp data in a single call (performance optimisation).
 * Returns pilots, instructors, winchDrivers, tugPilots from the consolidated People sheet.
 */
function getWebappData() {
  try {
    const people = getPeopleData();
    return {
      config:       getConfig(),
      flights:      getFlightsForWebapp(),
      pilots:       people.pilots,
      instructors:  people.instructors,
      winchDrivers: people.winchDrivers,
      tugPilots:    people.tugPilots
    };
  } catch (error) {
    Logger.log("Error in getWebappData: " + error.toString());
    throw error;
  }
}

/**
 * Get today's flights for the webapp.
 * If no flights today, returns last 3 days of flights.
 */
function getFlightsForWebapp() {
  const config = getConfig();
  const sheetName = FLIGHT_LOG_SHEET_NAME;
  const timezone = config.TIMEZONE;

  const now = new Date();
  const todayISO = Utilities.formatDate(now, timezone, "yyyy-MM-dd");

  Logger.log("Getting flights for webapp - Today (local): " + todayISO);

  const flights = getFlightsFromSheet(sheetName, todayISO);

  if (flights.length === 0) {
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
    const threeDaysAgoISO = Utilities.formatDate(threeDaysAgo, timezone, "yyyy-MM-dd");
    Logger.log("No flights today, looking back to: " + threeDaysAgoISO);
    const allFlights = getFlightsFromSheet(sheetName, null);
    return allFlights.filter(f => f.date >= threeDaysAgoISO);
  }

  return flights;
}

/**
 * Merge away a duplicate/orphan flight row without deleting it.
 *
 * Reads back the fields worth carrying over from the row at mergeFlightKey,
 * then marks that row's Pilot as the ignore-placeholder and blanks its
 * other people/billing fields. The row is left in place (Glider, Date,
 * TakeOff, TowPlane etc. untouched) so a future fetch regenerates the same
 * FlightKey, finds the existing row, and updates it - Pilot is a `preserve`
 * column (see DataWriter SCHEMA), so the ignore marker survives every
 * subsequent refresh with no extra tracking needed.
 *
 * @param {Sheet} sheet
 * @param {Object} cols - column map from getColumnMap()
 * @param {string} mergeFlightKey - FlightKey of the row being merged away
 * @returns {{towPlane,towType,towMaxAlt,pLanding,pTime,towPilot}} fields
 *          captured from the merged-away row, or all-blank if not found
 */
function _mergeAwayRow(sheet, cols, mergeFlightKey) {
  const empty = { towPlane: "", towType: "", towMaxAlt: "", pLanding: "", pTime: "", towPilot: "" };
  if (!mergeFlightKey) return empty;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return empty;

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const rowIndex = data.findIndex(row => row[0] === mergeFlightKey);
  if (rowIndex === -1) return empty;

  const row = data[rowIndex];
  const captured = {
    towPlane:  row[cols.TowPlane - 1]     || "",
    towType:   row[cols.TowType - 1]      || "",
    towMaxAlt: row[cols.TowMaxAlt - 1]    || "",
    pLanding:  row[cols.PlaneLanding - 1] || "",
    pTime:     row[cols.PlaneTime - 1]    || "",
    towPilot:  row[cols.TowPilot - 1]     || ""
  };

  const sheetRow = rowIndex + 2;
  const ignorePilot = getConfigValue('IGNORE_PILOT', false) || IGNORE_PILOT_DEFAULT;

  sheet.getRange(sheetRow, cols.Pilot).setValue(ignorePilot);
  sheet.getRange(sheetRow, cols.Visitor).setValue("");
  sheet.getRange(sheetRow, cols.Pax).setValue("");
  sheet.getRange(sheetRow, cols.PaxVisitor).setValue("");
  sheet.getRange(sheetRow, cols.Payer).setValue("");
  sheet.getRange(sheetRow, cols.TowPilot).setValue("");
  sheet.getRange(sheetRow, cols.Remarks).setValue("");
  sheet.getRange(sheetRow, cols.Timestamp).setValue(new Date());

  Logger.log("Merged away row (marked ignore): " + mergeFlightKey);
  return captured;
}

/**
 * Submit pilot data from the main webapp form.
 * winchDriver writes to TowPilot column (a flight cannot be both aerotow and winch).
 *
 * @param {string} flightKey
 * @param {string} pilot
 * @param {string} pax
 * @param {string} payer
 * @param {string} pilotVisitor  - 'Y' or ''
 * @param {string} paxVisitor    - 'Y' or ''
 * @param {string} winchDriver   - name or '' (writes to TowPilot)
 */
function submitPilotData(flightKey, pilot, pax, payer, pilotVisitor, paxVisitor, winchDriver, remarks) {
  try {
    if (!flightKey || !pilot) {
      return { success: false, message: "Flight and Pilot are required" };
    }

    const sheetName = FLIGHT_LOG_SHEET_NAME;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      return { success: false, message: "Sheet not found: " + sheetName };
    }

    const cols = getColumnMap(sheet);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return { success: false, message: "No flights in sheet" };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const rowIndex = data.findIndex(row => row[0] === flightKey);

    if (rowIndex === -1) {
      return { success: false, message: "Flight not found" };
    }

    const sheetRow = rowIndex + 2;

    sheet.getRange(sheetRow, cols.Visitor).setValue(pilotVisitor || "");
    sheet.getRange(sheetRow, cols.Pilot).setValue(pilot);
    sheet.getRange(sheetRow, cols.PaxVisitor).setValue(paxVisitor || "");
    if (pax) {
      sheet.getRange(sheetRow, cols.Pax).setValue(pax);
    }
    if (payer !== undefined) {
      sheet.getRange(sheetRow, cols.Payer).setValue(payer);
    }
    // Winch driver writes to TowPilot — only overwrite if a value was provided,
    // so that aerotow TowPilot set via Edit Tugs is not accidentally cleared.
    if (winchDriver !== undefined && winchDriver !== null) {
      sheet.getRange(sheetRow, cols.TowPilot).setValue(winchDriver);
    }
     if (remarks !== undefined) {
      sheet.getRange(sheetRow, cols.Remarks).setValue(String(remarks || '').slice(0, 80));
    }

    return { success: true, message: "Flight log updated successfully!" };

  } catch (error) {
    return { success: false, message: "Error: " + error.toString() };
  }
}

/**
 * Add manual glider flight from webapp.
 * @param {Object} flightData - Flight data object from form
 */
function addManualGliderFlight(flightData) {
  try {
    const sheetName = FLIGHT_LOG_SHEET_NAME;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      return { success: false, message: "Sheet not found: " + sheetName };
    }

    const flightKey = generateFlightKey(flightData.glider, flightData.date, flightData.takeOff);

    let gTime = "";
    if (flightData.gLanding) {
      const takeoff = parseTime(flightData.takeOff);
      const landing = parseTime(flightData.gLanding);
      if (takeoff && landing) {
        const durationMinutes = (landing.hour * 60 + landing.minute) - (takeoff.hour * 60 + takeoff.minute);
        if (durationMinutes > 0) {
          const hours = Math.floor(durationMinutes / 60);
          const minutes = durationMinutes % 60;
          gTime = String(hours).padStart(2, '0') + 'h' + String(minutes).padStart(2, '0');
        }
      }
    }

    let towPlane = "";
    let towType = "";
    let towMaxAlt = "";
    let towPilot = "";
    let pLanding = "";
    let pTime = "";

    if (flightData.tugFlightKey) {
      const cols = getColumnMap(sheet);
      const merged = _mergeAwayRow(sheet, cols, flightData.tugFlightKey);
      towPlane  = merged.towPlane;
      towType   = merged.towType;
      towMaxAlt = merged.towMaxAlt;
      pLanding  = merged.pLanding;
      pTime     = merged.pTime;
      towPilot  = merged.towPilot;
    }

    // winchDriver from form overrides towPilot only if provided and no tug was merged
    if (!towPilot && flightData.winchDriver) {
      towPilot = flightData.winchDriver;
    }

    const flight = {
      flightKey:    flightKey,
      date:         flightData.date,
      glider:       flightData.glider,
      cn:           flightData.cn || "",
      type:         flightData.type,
      takeOff:      flightData.takeOff,
      gLanding:     flightData.gLanding || "",
      gTime:        gTime,
      maxAlt:       "",
      maxHeight:    "",
      towPlane:     towPlane,
      towType:      towType,
      towMaxAlt:    towMaxAlt,
      pLanding:     pLanding,
      pTime:        pTime,
      remarks:      "",
      pilotVisitor: flightData.pilotVisitor || "",
      pilot:        flightData.pilot || "",
      paxVisitor:   flightData.paxVisitor || "",
      pax:          flightData.pax || "",
      payer:        flightData.payer || "",
      towPilot:     towPilot,
      source:       "Manual",
      startCode:    "",
      stopCode:     "",
      startQuality: "",
      stopQuality:  "",
      warn:         ""
    };

    writeFlightToSheet(sheet, flight);

    return { success: true, message: "Glider flight added successfully!" };

  } catch (error) {
    Logger.log("Error in addManualGliderFlight: " + error.toString());
    return { success: false, message: "Error: " + error.toString() };
  }
}

/**
 * Add manual tug flight from webapp.
 * @param {Object} flightData - Tug flight data object from form
 */
function addManualTugFlight(flightData) {
  try {
    const sheetName = FLIGHT_LOG_SHEET_NAME;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      return { success: false, message: "Sheet not found: " + sheetName };
    }

    const flightKey = generateFlightKey(flightData.towPlane, flightData.date, flightData.takeOff);

    let pTime = flightData.pTime || "";
    if (!pTime && flightData.pLanding) {
      const takeoff = parseTime(flightData.takeOff);
      const landing = parseTime(flightData.pLanding);
      if (takeoff && landing) {
        const durationMinutes = (landing.hour * 60 + landing.minute) - (takeoff.hour * 60 + takeoff.minute);
        if (durationMinutes > 0) {
          const hours = Math.floor(durationMinutes / 60);
          const minutes = durationMinutes % 60;
          pTime = String(hours).padStart(2, '0') + 'h' + String(minutes).padStart(2, '0');
        }
      }
    }

    const flight = {
      flightKey:    flightKey,
      date:         flightData.date,
      glider:       "",
      cn:           "",
      type:         "",
      takeOff:      flightData.takeOff,
      gLanding:     "",
      gTime:        "",
      maxAlt:       "",
      maxHeight:    "",
      towPlane:     flightData.towPlane,
      towType:      "",
      towMaxAlt:    flightData.towMaxAlt || "",
      pLanding:     flightData.pLanding || "",
      pTime:        pTime,
      remarks:      "",
      pilotVisitor: "",
      pilot:        "",
      paxVisitor:   "",
      pax:          "",
      payer:        "",
      towPilot:     flightData.towPilot || "",
      source:       "Manual",
      startCode:    "",
      stopCode:     "",
      startQuality: "",
      stopQuality:  "",
      warn:         ""
    };

    writeFlightToSheet(sheet, flight);

    return { success: true, message: "Tug flight added successfully!" };

  } catch (error) {
    Logger.log("Error in addManualTugFlight: " + error.toString());
    return { success: false, message: "Error: " + error.toString() };
  }
}

/**
 * Update existing flight from webapp (Edit Flight modal).
 * Gains winchDriver parameter — writes to TowPilot for winch-launched flights.
 *
 * @param {Object} flightData - Flight data object from edit form
 */
function updateFlight(flightData) {
  try {
    const sheetName = FLIGHT_LOG_SHEET_NAME;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      return { success: false, message: "Sheet not found: " + sheetName };
    }

    const cols = getColumnMap(sheet);

    let mergedTow = { towPlane: "", towType: "", towMaxAlt: "", pLanding: "", pTime: "", towPilot: "" };
    if (flightData.mergeFlightKey) {
      mergedTow = _mergeAwayRow(sheet, cols, flightData.mergeFlightKey);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: false, message: "No flights in sheet" };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const rowIndex = data.findIndex(row => row[0] === flightData.flightKey);

    if (rowIndex === -1) {
      return { success: false, message: "Flight not found" };
    }

    const sheetRow = rowIndex + 2;

    let gTime = "";
    if (flightData.gLanding) {
      const takeoff = parseTime(flightData.takeOff);
      const landing = parseTime(flightData.gLanding);
      if (takeoff && landing) {
        const durationMinutes = (landing.hour * 60 + landing.minute) - (takeoff.hour * 60 + takeoff.minute);
        if (durationMinutes > 0) {
          const hours = Math.floor(durationMinutes / 60);
          const minutes = durationMinutes % 60;
          gTime = String(hours).padStart(2, '0') + 'h' + String(minutes).padStart(2, '0');
        }
      }
    }

    sheet.getRange(sheetRow, cols.Date).setValue("'" + flightData.date);
    sheet.getRange(sheetRow, cols.Glider).setValue(flightData.glider);
    sheet.getRange(sheetRow, cols.CN).setValue(flightData.cn || "");
    sheet.getRange(sheetRow, cols.Type).setValue(flightData.type);
    sheet.getRange(sheetRow, cols.TakeOff).setValue(flightData.takeOff);
    sheet.getRange(sheetRow, cols.Landing).setValue(flightData.gLanding || "");
    sheet.getRange(sheetRow, cols.FlightTime).setValue(gTime);
    sheet.getRange(sheetRow, cols.Visitor).setValue(flightData.pilotVisitor || "");
    sheet.getRange(sheetRow, cols.Pilot).setValue(flightData.pilot || "");
    sheet.getRange(sheetRow, cols.PaxVisitor).setValue(flightData.paxVisitor || "");
    sheet.getRange(sheetRow, cols.Pax).setValue(flightData.pax || "");
    sheet.getRange(sheetRow, cols.Payer).setValue(flightData.payer || "");
    // TowPilot: receives either the aerotow tug pilot or the winch driver
    sheet.getRange(sheetRow, cols.TowPilot).setValue(flightData.towPilot || mergedTow.towPilot || "");
    if (mergedTow.towPlane) {
      sheet.getRange(sheetRow, cols.TowPlane).setValue(mergedTow.towPlane);
      sheet.getRange(sheetRow, cols.TowType).setValue(mergedTow.towType);
      sheet.getRange(sheetRow, cols.TowMaxAlt).setValue(mergedTow.towMaxAlt);
      sheet.getRange(sheetRow, cols.PlaneLanding).setValue(mergedTow.pLanding);
      sheet.getRange(sheetRow, cols.PlaneTime).setValue(mergedTow.pTime);
    }
    sheet.getRange(sheetRow, cols.Remarks).setValue(String(flightData.remarks || '').slice(0, 80));
    sheet.getRange(sheetRow, cols.Timestamp).setValue(new Date());

    return { success: true, message: "Flight updated successfully!" };

  } catch (error) {
    Logger.log("Error in updateFlight: " + error.toString());
    return { success: false, message: "Error: " + error.toString() };
  }
}

/**
 * Update tug pilot data for multiple flights (Edit Tugs modal).
 * @param {Array} updates - Array of {flightKey, towPilot}
 */
function updateTugData(updates) {
  try {
    const sheetName = FLIGHT_LOG_SHEET_NAME;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      return { success: false, message: "Sheet not found: " + sheetName };
    }

    const cols = getColumnMap(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return { success: false, message: "No flights in sheet" };
    }

    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    let updateCount = 0;

    updates.forEach(update => {
      const rowIndex = data.findIndex(row => row[0] === update.flightKey);
      if (rowIndex >= 0) {
        const sheetRow = rowIndex + 2;
        if (update.towPilot !== undefined) {
          sheet.getRange(sheetRow, cols.TowPilot).setValue(update.towPilot);
        }
        sheet.getRange(sheetRow, cols.Timestamp).setValue(new Date());
        updateCount++;
      }
    });

    return { success: true, message: "Updated " + updateCount + " flight(s)" };

  } catch (error) {
    Logger.log("Error in updateTugData: " + error.toString());
    return { success: false, message: "Error: " + error.toString() };
  }
}

/**
 * Scrape today's flights (called from webapp refresh button)
 */
function scrapeTodayFlights() {
  return fetchTodayFlights();
}
