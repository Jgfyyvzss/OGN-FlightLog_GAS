/**
 * DataWriter.gs - Schema, Sheet Initialisation, and Write/Read Functions
 *
 * SCHEMA is the single source of truth for all FlightLog columns.
 * Adding a column: add one entry here. Everything else (writer, reader,
 * Flights normaliser) picks it up automatically.
 *
 * Performance:
 *   - Column positions come from SCHEMA constants — never read from the sheet.
 *   - SheetCache reads sheet data once per execution and holds it in memory.
 *     All write operations update the cache and flush to the sheet in one call
 *     per row, eliminating repeated full-sheet reads during batch writes.
 */


// ─── Schema ──────────────────────────────────────────────────────────────────
//
// col   : 1-based column number — must match the physical sheet exactly.
// header: string written to the header row when a new sheet is created.
// field : property name used in raw flight objects (DataWriter / WebApp layer).
// norm  : property name used in normalised flight objects (Flights / Billing /
//         Export layer).  Omit when the field is not needed downstream.
// preserve: if true, writeFlightToSheet will NOT overwrite this column when
//           updating an existing row (pilot-entered data is protected).


const SCHEMA = [
  { col:  1, header: 'FlightKey',    field: 'flightKey',    norm: 'key'          },
  { col:  2, header: 'Date',         field: 'date',         norm: 'date'         },
  { col:  3, header: 'Glider',       field: 'glider',       norm: 'glider'       },
  { col:  4, header: 'CN',           field: 'cn',           norm: 'cn'           },
  { col:  5, header: 'Type',         field: 'type',         norm: 'type'         },
  { col:  6, header: 'TakeOff',      field: 'takeOff',      norm: 'takeOff'      },
  { col:  7, header: 'Landing',      field: 'gLanding',     norm: 'gLanding'     },
  { col:  8, header: 'FlightTime',   field: 'gTime',        norm: 'flightTime'   },
  { col:  9, header: 'MaxAlt',       field: 'maxAlt',       norm: 'maxAlt'       },
  { col: 10, header: 'MaxHeight',    field: 'maxHeight',    norm: 'maxHeight'    },
  { col: 11, header: 'TowPlane',     field: 'towPlane',     norm: 'towPlane'     },
  { col: 12, header: 'TowType',      field: 'towType',      norm: 'towType'      },
  { col: 13, header: 'TowMaxAlt',    field: 'towMaxAlt',    norm: 'towAlt'       },
  { col: 14, header: 'PlaneLanding', field: 'pLanding',     norm: 'pLanding'     },
  { col: 15, header: 'PlaneTime',    field: 'pTime',        norm: 'planeTime'    },
  { col: 16, header: 'Remarks',      field: 'remarks',      norm: 'remarks',     preserve: true },
  { col: 17, header: 'Visitor',      field: 'pilotVisitor', norm: 'visitor',     preserve: true },
  { col: 18, header: 'Pilot',        field: 'pilot',        norm: 'pilot',       preserve: true },
  { col: 19, header: 'PaxVisitor',   field: 'paxVisitor',   norm: 'paxVisitor',  preserve: true },
  { col: 20, header: 'Pax',          field: 'pax',          norm: 'pax',         preserve: true },
  { col: 21, header: 'Payer',        field: 'payer',        norm: 'payer',       preserve: true },
  { col: 22, header: 'TowPilot',     field: 'towPilot',     norm: 'towPilot',    preserve: true },
  { col: 23, header: 'Source',       field: 'source'                             },
  { col: 24, header: 'StartCode',    field: 'startCode'                          },
  { col: 25, header: 'StopCode',     field: 'stopCode'                           },
  { col: 26, header: 'StartQuality', field: 'startQuality'                       },
  { col: 27, header: 'StopQuality',  field: 'stopQuality'                        },
  { col: 28, header: 'Warn',         field: 'warn'                               },
  { col: 29, header: 'Timestamp',    field: 'timestamp'                          },
];

const SCHEMA_COL_COUNT = SCHEMA.length;  // 29 — update if columns are added


// ─── Schema lookup helpers ────────────────────────────────────────────────────
// Built once per execution from SCHEMA; free after first call.

let _byField = null;   // field name  → schema entry
let _byHeader = null;  // header name → schema entry
let _byNorm   = null;  // norm name   → schema entry

function _schemaByField() {
  if (!_byField) {
    _byField = {};
    SCHEMA.forEach(s => { _byField[s.field] = s; });
  }
  return _byField;
}

function _schemaByHeader() {
  if (!_byHeader) {
    _byHeader = {};
    SCHEMA.forEach(s => { _byHeader[s.header] = s; });
  }
  return _byHeader;
}

function _schemaByNorm() {
  if (!_byNorm) {
    _byNorm = {};
    SCHEMA.forEach(s => { if (s.norm) _byNorm[s.norm] = s; });
  }
  return _byNorm;
}

/** Return 1-based column number for a field name. Throws if not found. */
function colOf(fieldName) {
  const entry = _schemaByField()[fieldName];
  if (!entry) throw new Error(`SCHEMA: unknown field "${fieldName}"`);
  return entry.col;
}

/** Return header strings in column order — used when creating a new sheet. */
function schemaHeaders() {
  return SCHEMA.map(s => s.header);
}

/**
 * Verify that the actual sheet headers match SCHEMA.
 * Call this once after deploying to confirm the physical sheet is aligned.
 * Logs a warning for each mismatch; does not throw.
 */
function verifySchemaAlignment(sheetName) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName || FLIGHT_LOG_SHEET_NAME);
  if (!sheet) { Logger.log('verifySchemaAlignment: sheet not found'); return; }

  const actual = sheet.getRange(1, 1, 1, SCHEMA_COL_COUNT).getValues()[0];
  let ok = true;
  SCHEMA.forEach(s => {
    const actualHeader = (actual[s.col - 1] || '').toString().trim();
    if (actualHeader !== s.header) {
      Logger.log(`⚠ Column ${s.col}: expected "${s.header}", found "${actualHeader}"`);
      ok = false;
    }
  });
  if (ok) Logger.log('✓ Schema alignment verified — all columns match.');
}


// ─── SheetCache ───────────────────────────────────────────────────────────────
// Reads the flight sheet once, keeps data in memory, writes rows individually.
// Eliminates repeated full-sheet reads during batch operations.

const SheetCache = (() => {
  let _sheet     = null;
  let _data      = null;   // array-of-arrays, 0-indexed, rows from row 2 onwards
  let _keyIndex  = null;   // Map: flightKey → index in _data

  /** Load (or return cached) sheet data for the named sheet. */
  function load(sheet) {
    if (_sheet === sheet && _data !== null) return;  // already loaded for this sheet
    _sheet    = sheet;
    _keyIndex = new Map();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      _data = [];
      return;
    }
    _data = sheet.getRange(2, 1, lastRow - 1, SCHEMA_COL_COUNT).getValues();
    _data.forEach((row, i) => {
      const key = row[0];  // FlightKey is always col 1 (index 0)
      if (key) _keyIndex.set(String(key), i);
    });
  }

  /** Find the 0-based index in _data for a flightKey. Returns -1 if not found. */
  function findIndex(flightKey) {
    return _keyIndex.has(String(flightKey)) ? _keyIndex.get(String(flightKey)) : -1;
  }

  /** Write a complete row array to the sheet and update the cache. */
  function writeRow(rowArray, dataIndex) {
    // dataIndex is 0-based index in _data → sheet row = dataIndex + 2
    const sheetRow = dataIndex + 2;
    _sheet.getRange(sheetRow, 1, 1, rowArray.length).setValues([rowArray]);
    _data[dataIndex] = rowArray.slice();
  }

  /** Append a new row to the sheet and update the cache. */
  function appendRow(rowArray) {
    _sheet.appendRow(rowArray);
    const newIndex = _data.length;
    _data.push(rowArray.slice());
    _keyIndex.set(String(rowArray[0]), newIndex);
  }

  /** Return a copy of all cached data rows (for reads). */
  function allRows() {
    return _data ? _data.slice() : [];
  }

  /** Invalidate the cache (call if you switch sheets mid-execution). */
  function invalidate() {
    _sheet    = null;
    _data     = null;
    _keyIndex = null;
  }

  return { load, findIndex, writeRow, appendRow, allRows, invalidate };
})();


// ─── Sheet initialisation ─────────────────────────────────────────────────────

/**
 * Create the flight log sheet with schema headers if it doesn't already exist.
 * Returns the sheet object.
 */
function initializeSheet(sheetName) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);

    const headers = schemaHeaders();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('B:B').setNumberFormat('@STRING@');  // Date column as text

    Logger.log('Created sheet: ' + sheetName);
  }

  return sheet;
}


// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Write or update a flight in the sheet.
 *
 * NEW rows    : all fields from the flight object are written.
 * UPDATE rows : non-preserve fields are overwritten; preserve fields
 *               (Visitor, Pilot, PaxVisitor, Pax, Payer, TowPilot) are
 *               kept from the existing row.
 *
 * Caller must ensure SheetCache.load(sheet) has been called before entering
 * a batch loop. For single writes, this function calls it automatically.
 */
function writeFlightToSheet(sheet, flight) {
  if (!sheet) throw new Error('writeFlightToSheet: no sheet provided');

  SheetCache.load(sheet);

  const existingIndex = SheetCache.findIndex(flight.flightKey);

  if (existingIndex >= 0) {
    // ── Update existing row ──────────────────────────────────────────────────
    // Build updated row from cached existing values, then overlay non-preserve
    // columns with fresh data.
    const existing = SheetCache.allRows()[existingIndex].slice();
    const updatedRow = _buildRow(flight, existing);
    SheetCache.writeRow(updatedRow, existingIndex);
    Logger.log('Updated: ' + flight.flightKey);

  } else {
    // ── Append new row ───────────────────────────────────────────────────────
    const newRow = _buildRow(flight, null);
    SheetCache.appendRow(newRow);
    Logger.log('Added: ' + flight.flightKey);
  }
}

/**
 * Build the row array for writeFlightToSheet.
 *
 * @param {Object} flight       - Flight object (raw shape, field names).
 * @param {Array|null} existing - Existing row values from cache, or null for new.
 * @returns {Array} Row array sized to SCHEMA_COL_COUNT.
 */
function _buildRow(flight, existing) {
  // Start from existing data (preserves columns not in this write), or blanks.
  const row = existing ? existing.slice() : new Array(SCHEMA_COL_COUNT).fill('');

  SCHEMA.forEach(s => {
    // Skip preserve columns when updating — keep whatever was in the sheet.
    if (existing && s.preserve) return;

    const i   = s.col - 1;  // 0-based array index
    let   val = flight[s.field];

    if (val === undefined || val === null) {
      val = '';
    }

    // Date column: prefix with apostrophe to force text storage.
    if (s.header === 'Date' && val && !String(val).startsWith("'")) {
      val = "'" + val;
    }

    // Timestamp column: always write current time.
    if (s.header === 'Timestamp') {
      val = new Date();
    }

    row[i] = val;
  });

  return row;
}


// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Return an array of raw flight objects from the sheet.
 *
 * @param {string}      sheetName - Sheet to read from.
 * @param {string|null} isoDate   - Filter to this date, or null for all rows.
 * @returns {Array} Array of raw flight objects (field names from SCHEMA).
 */
function getFlightsFromSheet(sheetName, isoDate) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  SheetCache.load(sheet);

  const dateColIndex = colOf('date') - 1;  // 0-based

  return SheetCache.allRows()
    .filter(row => {
      if (!row[0]) return false;  // skip blank/empty rows
      if (!isoDate) return true;
      // Strip leading apostrophe that forces text storage
      const rowDate = String(row[dateColIndex]).replace(/^'/, '');
      return rowDate === isoDate;
    })
    .map(row => _rowToFlight(row));
}

/**
 * Convert a raw sheet row array to a raw flight object (field names).
 * This is the DataWriter / WebApp shape. For the normalised Billing shape,
 * see Flights.gs.
 *
 * Timestamp is excluded: it is internal bookkeeping and is never used by
 * the webapp or any downstream consumer of raw flight objects. Including it
 * would pass a live Date object through google.script.run serialisation,
 * which causes the client to receive null for the entire response payload.
 *
 * Any other cell that Sheets has interpreted as a date (returning a JS Date
 * object) is also coerced to an empty string — those fields are always stored
 * as text in this sheet, so a Date object indicates a blank or malformed cell.
 */
function _rowToFlight(row) {
  const flight = {};
  SCHEMA.forEach(s => {
    // Timestamp is server-side only — never send to client
    if (s.header === 'Timestamp') return;

    let val = row[s.col - 1];
    if (val === undefined || val === null) {
      val = '';
    } else if (val instanceof Date) {
      // Sheets returns Date objects for date-formatted cells.
      // All fields in this sheet are stored as text; a Date here means
      // the cell is empty or malformed — treat as blank.
      val = '';
    }

    // Strip leading apostrophe used to force text storage of the Date column
    if (s.header === 'Date') val = String(val).replace(/^'/, '');

    flight[s.field] = val;
  });
  return flight;
}


// ─── Legacy compatibility shim ────────────────────────────────────────────────
// getColumnMap() was called in WebApp.gs (submitPilotData, updateFlight, etc.)
// with individual cell writes like sheet.getRange(row, cols.Pilot).setValue().
// Those functions still work — we return a map built from SCHEMA so the column
// numbers remain correct without touching WebApp.gs in this revision.

function getColumnMap() {
  const map = {};
  SCHEMA.forEach(s => { map[s.header] = s.col; });
  return map;
}
