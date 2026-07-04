/**
 * FlightUtils.gs - Shared Utility Functions
 * Used by both API and HTML scraper
 */

/**
 * Generate FlightKey in new format: {glider}-YYYYMMDD-HHmm
 * @param {string} glider - Aircraft registration or CN
 * @param {string} isoDate - Date in yyyy-mm-dd format
 * @param {string} time - Time in HH:MM or HHhMM format
 */
function generateFlightKey(glider, isoDate, time) {
  // Convert date to YYYYMMDD
  const dateKey = isoDate.replace(/-/g, "");
  
  // Convert time to HHmm (remove colon or 'h')
  const timeKey = time.replace(/[h:]/g, "");
  
  // Clean glider rego (remove spaces, hyphens)
  const gliderKey = glider.replace(/[\s-]/g, "");
  
  return `${gliderKey}-${dateKey}-${timeKey}`;
}

/**
 * Format duration from seconds to HHhMM format
 * @param {number} seconds - Duration in seconds
 */
function formatDuration(seconds) {
  if (!seconds || seconds === 0) return "";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  
  return `${hh}h${mm}`;
}

/**
 * Parse time string to extract hour and minute
 * Handles formats: "12h34", "12:34", "1234"
 * @param {string} timeStr - Time string
 * @returns {object} {hour: number, minute: number, formatted: "HHhMM"}
 */
function parseTime(timeStr) {
  if (!timeStr) return null;
  
  // Remove all non-numeric characters except 'h' and ':'
  let cleaned = timeStr.toString().trim();
  
  let hour, minute;
  
  if (cleaned.includes('h')) {
    const parts = cleaned.split('h');
    hour = parseInt(parts[0], 10);
    minute = parseInt(parts[1] || "0", 10);
  } else if (cleaned.includes(':')) {
    const parts = cleaned.split(':');
    hour = parseInt(parts[0], 10);
    minute = parseInt(parts[1] || "0", 10);
  } else {
    // Assume HHMM format
    if (cleaned.length === 4) {
      hour = parseInt(cleaned.substring(0, 2), 10);
      minute = parseInt(cleaned.substring(2, 4), 10);
    } else if (cleaned.length === 3) {
      hour = parseInt(cleaned.substring(0, 1), 10);
      minute = parseInt(cleaned.substring(1, 3), 10);
    } else {
      return null;
    }
  }
  
  if (isNaN(hour) || isNaN(minute)) return null;
  
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  
  return {
    hour: hour,
    minute: minute,
    formatted: `${hh}h${mm}`
  };
}

/**
 * Calculate quality description from quality codes
 * Based on API documentation
 */
function getQualityDescription(startQ, stopQ) {
  const qualityMap = {
    0: "unknown",
    1: "< 25m precision",
    2: "< 50m precision", 
    3: "< 100m precision",
    4: "< 500m precision",
    5: "> 500m precision"
  };
  
  const start = qualityMap[startQ] || "unknown";
  const stop = stopQ ? (qualityMap[stopQ] || "unknown") : "unknown";
  
  return { start, stop };
}

/**
 * Match two flights to see if they're the same physical flight
 * Used when merging data from different sources
 */
function matchFlights(flight1, flight2) {
  // Same glider
  if (flight1.glider !== flight2.glider) return false;
  
  // Same date
  if (flight1.date !== flight2.date) return false;
  
  // Takeoff times within 2 minutes
  const time1 = parseTime(flight1.takeOff);
  const time2 = parseTime(flight2.takeOff);
  
  if (!time1 || !time2) return false;
  
  const diff = Math.abs((time1.hour * 60 + time1.minute) - (time2.hour * 60 + time2.minute));
  
  return diff <= 2; // Within 2 minutes
}

/**
 * Get current date in ISO format using configured timezone
 */
function getTodayISO() {
  const timezone = getConfigValue("TIMEZONE");
  return Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd");
}
