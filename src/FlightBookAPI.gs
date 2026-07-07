/**
 * FlightBookAPI.gs - FlightBook API Parser
 * Fetches flight data from flightbook.glidernet.org API
 * Primary data source
 */

/**
 * Main function to fetch and parse flights from API
 * @param {string} dateStr - Date in yyyy-mm-dd format, or blank for today
 * @param {string} targetSheet - Sheet name to write to (default: "Flight Log")
 */
function fetchFlightsFromAPI(dateStr, targetSheet) {
  const config = getConfig();
  const airportCode = config.AIRPORT_CODE;
  const timezone = config.TIMEZONE;
  const sheetName = targetSheet || FLIGHT_LOG_SHEET_NAME;
  
  if (!airportCode || !timezone) {
    throw new Error("AIRPORT_CODE and TIMEZONE must be configured in Config sheet");
  }
  
  // Determine date
  const isoDate = dateStr || getTodayISO();
  
  Logger.log("Fetching flights from API for " + airportCode + " on " + isoDate);
  
  // Fetch from API
  const url = `https://flightbook.glidernet.org/api/logbook/${airportCode}/${isoDate}`;
  
  try {
    const response = UrlFetchApp.fetch(url);
    const jsonData = JSON.parse(response.getContentText());
    
    Logger.log("API Response received");
    
    // Parse flights
    const flights = parseAPIFlights(jsonData, isoDate);
    
    Logger.log("Parsed " + flights.length + " flights from API");
    
    // Write to sheet
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    flights.forEach(flight => {
      writeFlightToSheet(sheet, flight);
    });
    
    return { success: true, count: flights.length, source: "API" };
    
  } catch (e) {
    Logger.log("Error fetching from API: " + e.toString());
    throw e;
  }
}

/**
 * Parse JSON data from API into flight objects
 * Handles invalid flights gracefully and creates orphan tug records
 */
function parseAPIFlights(jsonData, isoDate) {
  if (!jsonData.flights || !jsonData.devices) {
    Logger.log("No flights or devices in API response");
    return [];
  }
  
  const flights = [];
  const devices = jsonData.devices;
  
  // Create device lookup map
  const deviceMap = {};
  devices.forEach((device, index) => {
    deviceMap[index] = {
      registration: device.registration || "",
      competition: device.competition || "",
      aircraft: device.aircraft || "",
      aircraft_type: device.aircraft_type
    };
  });
  
  // Process flights with error handling for each flight
  jsonData.flights.forEach((apiFlight, flightIndex) => {
    try {
      const device = deviceMap[apiFlight.device];
      if (!device) {
        Logger.log("Warning: Flight " + flightIndex + " has no device mapping");
        return;
      }
      
      // Skip if this flight is towing a tracked glider (will be linked to glider record)
      if (apiFlight.towing) {
        Logger.log("Skipping towing flight " + flightIndex + " (will be linked to glider)");
        return;
      }
      
      // Check if this is a glider being towed
      if (apiFlight.tow !== null && apiFlight.tow !== undefined) {
        // This is a glider flight with tug
        const gliderFlight = parseGliderFlight(apiFlight, device, jsonData, deviceMap, isoDate, flightIndex);
        if (gliderFlight) {
          flights.push(gliderFlight);
        }
      } else {
        // This is either a self-launch glider, orphan tug, or other aircraft
        const aircraftFlight = parseAircraftFlight(apiFlight, device, isoDate, flightIndex, apiFlight.device, jsonData.devices);
        if (aircraftFlight) {
          flights.push(aircraftFlight);
        }
      }
      
    } catch (error) {
      Logger.log("Error parsing flight " + flightIndex + ": " + error.toString());
      // Continue to next flight
    }
  });
  
  Logger.log("Extracted " + flights.length + " flights from API");
  return flights;
}

/**
 * Parse a glider flight with tow plane
 */
function parseGliderFlight(apiFlight, device, jsonData, deviceMap, isoDate, flightIndex) {
  // Skip flights with no start time (remote takeoff)
  if (!apiFlight.start) {
    Logger.log("Skipping glider flight " + flightIndex + ": no start time (remote takeoff)");
    return null;
  }
  
  // Get glider registration (prefer registration, fall back to competition ID, then use address)
  let gliderRego = device.registration || device.competition || "";
  
  // If still no registration, use device address as identifier
  if (!gliderRego || gliderRego.trim() === "") {
    // Use last 6 chars of address for unconfigured FLARMs
    const deviceAddr = jsonData.devices[apiFlight.device].address || "";
    if (deviceAddr) {
      gliderRego = "~" + deviceAddr.slice(-6);
    } else {
      gliderRego = "UNKNOWN";
    }
    Logger.log("Unconfigured FLARM detected, using identifier: " + gliderRego);
  }
  
  // Generate FlightKey
  const flightKey = generateFlightKey(gliderRego, isoDate, apiFlight.start);
  
  // Calculate flight time from duration (seconds)
  const flightTime = formatDuration(apiFlight.duration);
  
  // Get quality descriptions
  const quality = getQualityDescription(apiFlight.start_q, apiFlight.stop_q);
  
  // Build flight object
  const flight = {
    flightKey: flightKey,
    date: isoDate,
    glider: device.registration || "",
    cn: device.competition || "",
    type: device.aircraft || "",
    takeOff: apiFlight.start,
    gLanding: apiFlight.stop || "",
    gTime: flightTime,
    maxAlt: apiFlight.max_alt || "",
    maxHeight: apiFlight.max_height || "",
    source: "API",
    startCode: apiFlight.start_code || "",
    stopCode: apiFlight.stop_code || "",
    startQuality: quality.start,
    stopQuality: quality.stop,
    warn: apiFlight.warn ? "Y" : "N"
  };
  
  // Check for tow plane
  if (apiFlight.tow !== null && apiFlight.tow !== undefined) {
    const towFlight = jsonData.flights[apiFlight.tow];
    if (towFlight) {
      const towDevice = deviceMap[towFlight.device];
      if (towDevice) {
        flight.towPlane = towDevice.registration || "";
        flight.towType = towDevice.aircraft || "";
        flight.towMaxAlt = towFlight.max_alt || "";
        flight.pTime = formatDuration(towFlight.duration);
        flight.pLanding = towFlight.stop || "";
      }
    }
  }
  
  return flight;
}

/**
 * Parse a non-glider flight (self-launch glider, orphan tug, or other aircraft)
 * Creates record with aircraft data in glider columns OR orphan tug in tow columns
 */
function parseAircraftFlight(apiFlight, device, isoDate, flightIndex, deviceIndex, devices) {
  // Skip flights with no start time (remote takeoff)
  if (!apiFlight.start) {
    Logger.log("Skipping aircraft flight " + flightIndex + ": no start time (remote takeoff)");
    return null;
  }
  
  // Get aircraft registration
  let aircraftRego = device.registration || device.competition || "";
  
  // If no registration, use device address as identifier
  if (!aircraftRego || aircraftRego.trim() === "") {
    const deviceAddr = devices[deviceIndex].address || "";
    if (deviceAddr) {
      aircraftRego = "~" + deviceAddr.slice(-6);
    } else {
      aircraftRego = "UNKNOWN";
    }
    Logger.log("Unconfigured FLARM detected, using identifier: " + aircraftRego);
  }
  
  // Generate FlightKey using aircraft registration
  const flightKey = generateFlightKey(aircraftRego, isoDate, apiFlight.start);
  
  // Calculate flight time
  const flightTime = formatDuration(apiFlight.duration);
  
  // Get quality descriptions
  const quality = getQualityDescription(apiFlight.start_q, apiFlight.stop_q);
  
  // Determine if this should be treated as an orphan tug/powered aircraft
  // Tugs must have:
  // - aircraft_type 2 (tow plane) or 3 (ultralight)
  // - AND valid registration configured
  // Anything else (type 0, 1, 4, 5, 6, or missing registration) = glider
  const isTug = (device.aircraft_type === 2 || device.aircraft_type === 3) && 
                 device.registration && 
                 device.registration.trim() !== "";
  
  if (isTug) {
    // Create orphan tug record (empty glider columns, data in tow columns)
    Logger.log("Creating orphan tug/aircraft record: " + aircraftRego);
    
    const flight = {
      flightKey: flightKey,
      date: isoDate,
      glider: "", // Empty = orphan tug identifier
      cn: "",
      type: "",
      takeOff: apiFlight.start, // Tug takeoff for sorting
      gLanding: "",
      gTime: "",
      maxAlt: "",
      maxHeight: "",
      towPlane: device.registration || "",
      towType: device.aircraft || "",
      towMaxAlt: apiFlight.max_alt || "",
      pLanding: apiFlight.stop || "",
      pTime: flightTime,
      remarks: "",
      pilot: "",
      pax: "",
      payer: "",
      towPilot: "",
      source: "API",
      startCode: apiFlight.start_code || "",
      stopCode: apiFlight.stop_code || "",
      startQuality: quality.start,
      stopQuality: quality.stop,
      warn: apiFlight.warn ? "Y" : "N"
    };
    
    return flight;
    
  } else {
    // Self-launch glider, motorglider, or unconfigured FLARM - treat as glider
    const flight = {
      flightKey: flightKey,
      date: isoDate,
      glider: device.registration || "",
      cn: device.competition || "",
      type: device.aircraft || "",
      takeOff: apiFlight.start,
      gLanding: apiFlight.stop || "",
      gTime: flightTime,
      maxAlt: apiFlight.max_alt || "",
      maxHeight: apiFlight.max_height || "",
      source: "API",
      startCode: apiFlight.start_code || "",
      stopCode: apiFlight.stop_code || "",
      startQuality: quality.start,
      stopQuality: quality.stop,
      warn: apiFlight.warn ? "Y" : "N"
    };
    
    return flight;
  }
}

/**
 * Test function - fetch today's flights from API
 */
function testAPIToday() {
  const result = fetchFlightsFromAPI(null, "Testing");
  Logger.log("Result: " + JSON.stringify(result));
}

/**
 * Test function - fetch specific date from API
 */
function testAPIDate() {
  const result = fetchFlightsFromAPI("2025-12-26", "Testing");
  Logger.log("Result: " + JSON.stringify(result));
}
