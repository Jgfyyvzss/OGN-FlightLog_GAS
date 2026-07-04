/**
 * People.gs - Consolidated People List Management
 * Replaces PilotList, PaxList, TugPilotList sheets with a single 'People' sheet.
 *
 * Sheet: People
 * Columns: Pilot | PilotNote | Instructor | InstructorNote | WinchDriver | TugPilot
 *
 * Each column is an independent list. Blank cells are skipped.
 * Note columns are read but currently unused by the webapp — reserved for future billing features.
 */

/**
 * Read all people lists from the People sheet in one pass.
 * @returns {{ pilots: string[], instructors: string[], winchDrivers: string[], tugPilots: string[] }}
 */
function getPeopleData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("People");

  if (!sheet) {
    throw new Error("'People' sheet not found. Please create it with columns: Pilot, PilotNote, Instructor, InstructorNote, WinchDriver, TugPilot");
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { pilots: [], instructors: [], winchDrivers: [], tugPilots: [] };
  }

  // Read all data in one call - headers in row 1
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  // Build column index map
  const col = {};
  headers.forEach((h, i) => {
    if (h) col[h.toString().trim()] = i;
  });

  // Extract each list, skipping blank cells
  function extractCol(colName) {
    if (col[colName] === undefined) return [];
    return data
      .map(row => row[col[colName]])
      .filter(v => v !== null && v !== undefined && v.toString().trim() !== "")
      .map(v => v.toString().trim());
  }

  return {
    pilots:       extractCol("Pilot"),
    instructors:  extractCol("Instructor"),
    winchDrivers: extractCol("WinchDriver"),
    tugPilots:    extractCol("TugPilot")
  };
}
