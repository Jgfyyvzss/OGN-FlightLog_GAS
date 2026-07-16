/**
 * X_SGGCExport.gs - SGGC Flight Log TSV Export
 *
 * Produces tab-separated data (no headers) in the format:
 *   Flt No | Glider Reg | PIC / Instructor | 2nd Pilot Or Student Or Guest |
 *   Flt Type | Tug Reg | Tug Pilot/Winch Driver | Time Off | Tug Down | Glider Down | Tow Height
 *
 * Flight Type derivation:
 *   A   - Payer = AEF
 *   G   - Visitor = Y (pilot is a visitor)
 *   PP  - PaxVisitor = Y (passenger/guest is a visitor)
 *   I   - Pax populated AND PaxVisitor is blank (instructional; student=Pilot, instructor=Pax)
 *   S   - No Pax (solo)
 *
 * PIC / Instructor column:
 *   For type I: Pax field (the instructor)
 *   For all others: Pilot field
 *
 * 2nd Pilot column:
 *   For type I: Pilot field (the student)
 *   For type S: blank
 *   For all others: Pax field
 *
 * Tow Height: MaxHeight (metres) × 3.28084, rounded to nearest 100 ft.
 *             Blank if MaxHeight is absent or zero.
 *
 * Only un-exported flights are included (uses X_ExportState).
 * Only flights with a Pilot assigned are exported; others are skipped and reported.
 */

const SGGC_EXPORT_ID = 'sggc_tsv';

/**
 * Menu entry point
 */
function runSGGCExport() {
  const batchId = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd-HHmmss'
  );

  X_Audit.log('EXPORT_START', SGGC_EXPORT_ID, batchId);

  try {
    const { tsv, eligible, skipped } = generateSGGCExport(batchId);

    if (eligible.length === 0) {
      SpreadsheetApp.getUi().alert('No un-exported flights with pilots assigned. Nothing to export.');
      return;
    }

    // Save to Drive
    const blob = Utilities.newBlob(
      tsv,
      'text/plain',
      'SGGCExport_' + batchId + '.tsv'
    );
    const file = getExportFolder().createFile(blob);

    X_Audit.log('EXPORT_SUCCESS', SGGC_EXPORT_ID, batchId, {
      flightCount: eligible.length,
      notes: 'Saved to Drive: ' + file.getName()
    });

    let message = 'SGGC export complete.\n\n' +
      eligible.length + ' flight(s) exported.\n' +
      'File saved to Drive: ' + file.getName();

    if (skipped.length > 0) {
      message += '\n\n' + skipped.length + ' flight(s) skipped (missing Pilot).\nSee AuditLog for details.';
    }

    SpreadsheetApp.getUi().alert(message);

  } catch (e) {
    X_Audit.log('EXPORT_ERROR', SGGC_EXPORT_ID, batchId, { notes: e.message });
    SpreadsheetApp.getUi().alert('Export failed: ' + e.message);
    throw e;
  }
}

/**
 * Core export logic — shared by menu and future webapp invocations.
 * @param {string} batchId
 * @returns {{ tsv: string, eligible: Object[], skipped: Object[] }}
 */
function generateSGGCExport(batchId) {
  const flights = Flights.load();
  const exported = X_ExportState.exportedKeys(SGGC_EXPORT_ID);

  const ignorePilot = getConfigValue('IGNORE_PILOT', false) || IGNORE_PILOT_DEFAULT;

  // Split into eligible (has pilot, not yet exported) and skipped (no pilot)
  const unexported = flights.filter(f => !exported.has(f.key));
  const eligible   = unexported.filter(f => f.pilot && f.pilot !== ignorePilot);
  const skipped    = unexported.filter(f => !f.pilot);

  // Log each skipped flight
  skipped.forEach(f => {
    X_Audit.log('WARNING', SGGC_EXPORT_ID, batchId, {
      notes: 'Skipped - missing Pilot: ' + f.key
    });
  });

  if (eligible.length === 0) {
    return { tsv: '', eligible: [], skipped };
  }

  // Build TSV rows — no headers
  const rows = eligible.map((f, index) => buildSGGCRow(f, index + 1));

  const tsv = rows.map(r => r.join('\t')).join('\n');

  // Mark as exported
  X_ExportState.markExported(
    SGGC_EXPORT_ID,
    batchId,
    eligible.map(f => f.key)
  );

  return { tsv, eligible, skipped };
}

/**
 * Build a single TSV row for one flight.
 * @param {Object} f - Normalised flight object from Flights.load()
 * @param {number} fltNo - Sequential flight number
 * @returns {string[]}
 */
function buildSGGCRow(f, fltNo) {
  const fltType = deriveSGGCFlightType(f);
  const pic     = deriveSGGCPIC(f, fltType);
  const second  = deriveSGGCSecond(f, fltType);
  const towHt   = deriveTowHeight(f);

  // Strip VH- prefix from glider registration (and tug reg)
  const gliderReg = stripVHPrefix(f.glider);
  const tugReg    = stripVHPrefix(f.towPlane || '');

  return [
    fltNo,
    gliderReg,
    pic,
    second,
    fltType,
    tugReg,
    f.towPilot || '',   // TowPilot covers both tug pilot and winch driver
    formatSGGCTime(f.takeOff),
    formatSGGCTime(f.pLanding),   // Tug/plane landing time
    formatSGGCTime(f.gLanding),   // Glider landing time
    towHt
  ];
}

/**
 * Derive SGGC flight type code.
 * Evaluation order matters — AEF and visitor checks first.
 */
function deriveSGGCFlightType(f) {
  if (f.payer === 'AEF')   return 'A';
  if (f.visitor)            return 'G';   // f.visitor = (Visitor === 'Y')
  if (f.paxVisitor)         return 'PP';  // f.paxVisitor = (PaxVisitor === 'Y')
  if (f.pax)                return 'I';   // Pax populated, not a visitor
  return 'S';
}

/**
 * Derive the PIC / Instructor column value.
 * For instructional flights (I), the instructor (Pax) is the PIC.
 * For all others, the Pilot is PIC.
 */
function deriveSGGCPIC(f, fltType) {
  if (fltType === 'I') return f.pax || '';
  return f.pilot || '';
}

/**
 * Derive the 2nd Pilot / Student / Guest column value.
 * For instructional flights (I), the student (Pilot) goes here.
 * For solo (S), blank.
 * For all others, Pax goes here.
 */
function deriveSGGCSecond(f, fltType) {
  if (fltType === 'I') return f.pilot || '';
  if (fltType === 'S') return '';
  return f.pax || '';
}

/**
 * Convert MaxHeight from metres to feet, rounded to nearest 100.
 * Returns empty string if no height available.
 */
function deriveTowHeight(f) {
  // Flights.load() normalises maxAlt as a number; we need maxHeight (metres AGL)
  // maxHeight is stored as a raw field — access via the raw sheet read
  // Flights.normalise() doesn't currently include maxHeight, so we read towAlt
  // as a proxy. See note below.
  //
  // NOTE: Flights.load() → normalise() maps TowMaxAlt → towAlt.
  // MaxHeight (metres AGL of glider) is NOT currently in the normalised object.
  // Two options:
  //   (a) Use towAlt (tow plane max alt) as the height figure — not ideal
  //   (b) Extend Flights.normalise() to include maxHeight
  //
  // Option (b) is correct. Flights.gs is updated separately to include maxHeight.
  // This function expects f.maxHeight (metres, numeric).

  const metres = Number(f.maxHeight);
  if (!metres || isNaN(metres) || metres <= 0) return '';

  const feet = metres * 3.28084;
  return String(Math.round(feet / 100) * 100);
}

/**
 * Format a stored time value as HH:MM for Excel compatibility.
 * Input formats accepted: "HHhMM" (e.g. "11h38"), "HH:MM" (passed through),
 * or "HHMM" (e.g. "1138"). Returns '' for blank/unparseable input.
 */
function formatSGGCTime(timeStr) {
  if (!timeStr) return '';

  const parsed = parseTime(timeStr);  // shared helper in FlightUtils.gs
  if (!parsed) return '';

  const hh = String(parsed.hour).padStart(2, '0');
  const mm = String(parsed.minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Strip VH- prefix (case-insensitive) from a registration string.
 * "VH-GWS" → "GWS", "VH-ABC" → "ABC", "GWS" → "GWS"
 */
function stripVHPrefix(reg) {
  if (!reg) return '';
  return reg.replace(/^VH-/i, '').trim();
}

// Register in the export menu
X_ExportRegistry.register({
  name:  'Export to SGGC (TSV)',
  run:   runSGGCExport
});
