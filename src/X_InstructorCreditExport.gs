/**
 * X_InstructorCreditExport.gs - Instructor Credit Note Export
 *
 * Eligible flights: Pax AND Pilot populated, AND Payer is blank (default -
 * Pilot pays, the normal instructional-flight case) or AEF.
 * The Pax field holds the instructor's name.
 *
 * One credit note row per instructor. Qty = number of eligible flights.
 *
 * TSV columns (with header):
 *   IssueDate | Reference | Customer | Description |
 *   Lines.1.Item | Lines.1.Qty | Lines.1.SalesUnitPrice
 *
 * Item code : VI
 * Description: Instructing Credits
 * Rate source: Costs sheet key INSTRUCTING_CREDIT (per flight)
 *
 * Un-exported tracking uses X_ExportState with EXPORT_ID = 'instructor_credit_tsv'.
 * Gated on the Manager invoice export (same credit-gate logic as tow credits,
 * shared via X_ExportBase.isCreditGateDisabled()).
 */

const INSTRUCTOR_CREDIT_EXPORT_ID = 'instructor_credit_tsv';

/**
 * Webapp entry point — called from serveAccountingExportsPage (AccountingExportsPage.gs).
 * @returns {{ tsv, summary } | { error }}
 */
function runInstructorCreditExportFromWebapp(password) {
  const expectedPassword = Config.get('EXPORT_PASSWORD');
  if (password !== expectedPassword) {
    return { error: 'Incorrect password.' };
  }
  try {
    const { tsv, summary } = generateInstructorCreditExport();
    return { tsv, summary };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Menu entry point — saves to Drive.
 */
function runInstructorCreditExport() {
  const batchId = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss'
  );
  X_Audit.log('EXPORT_START', INSTRUCTOR_CREDIT_EXPORT_ID, batchId);

  try {
    const { tsv, summary, instructorCount, flightCount } = generateInstructorCreditExport();

    if (!tsv) {
      SpreadsheetApp.getUi().alert('No un-exported instructional flights found.');
      return;
    }

    const blob = Utilities.newBlob(
      tsv, 'text/csv', 'InstructorCreditExport_' + batchId + '.csv'
    );
    DriveApp.createFile(blob);

    X_Audit.log('EXPORT_SUCCESS', INSTRUCTOR_CREDIT_EXPORT_ID, batchId, {
      pilotCount:  instructorCount,
      flightCount: flightCount
    });

    SpreadsheetApp.getUi().alert(
      'Instructor credit export complete.\n\n' +
      instructorCount + ' instructor(s), ' + flightCount + ' flight(s).\n' +
      'File saved to Drive: InstructorCreditExport_' + batchId + '.csv'
    );

  } catch (e) {
    X_Audit.log('EXPORT_ERROR', INSTRUCTOR_CREDIT_EXPORT_ID, batchId, { notes: e.message });
    SpreadsheetApp.getUi().alert('Export failed: ' + e.message);
    throw e;
  }
}

/**
 * Core logic — shared by menu and webapp.
 * @returns {{ tsv, summary, instructorCount, flightCount }}
 */
function generateInstructorCreditExport() {
  const rate = Costs.get('INSTRUCTING_CREDIT');

  const issueDate = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'dd/MM/yy'
  );

  const batchId = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss'
  );

  const flights = Flights.load();
  const creditExported = X_ExportState.exportedKeys(INSTRUCTOR_CREDIT_EXPORT_ID);

  const gateDisabled = X_ExportBase.isCreditGateDisabled();

  const flightExported = gateDisabled
    ? null
    : X_ExportState.exportedKeys(MANAGER_EXPORT_ID);

  // Eligible: Pilot & Pax populated, Payer is blank (default) or AEF,
  // not yet credited, and (if gate on) already invoiced.
  const eligible = flights.filter(f =>
    f.pilot &&
    f.pax &&
    (f.payer === '' || f.payer === PAYER.AEF) &&
    !creditExported.has(f.key) &&
    (gateDisabled || flightExported.has(f.key))
  );

  if (eligible.length === 0) {
    return { tsv: '', summary: 'No eligible instructional flights found.', instructorCount: 0, flightCount: 0 };
  }

  // Group by instructor (Pax field) — count flights
  const instructors = new Map();  // name -> count
  eligible.forEach(f => {
    instructors.set(f.pax, (instructors.get(f.pax) || 0) + 1);
  });

  // Build TSV — header row then one row per instructor
  const rows = [
    ['IssueDate', 'Reference', 'Customer', 'Description', 'Lines.1.Item', 'Lines.1.Qty', 'Lines.1.SalesUnitPrice']
  ];

  instructors.forEach((count, name) => {
    rows.push([
      issueDate,
      '',
      name,
      'Instructing Credits',
      'VI',
      count,
      rate.toFixed(2)
    ]);
  });

  const tsv = rows.map(r =>
    r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join('\t')
  ).join('\n');

  // Mark eligible flights as exported
  X_ExportState.markExported(
    INSTRUCTOR_CREDIT_EXPORT_ID,
    batchId,
    eligible.map(f => f.key)
  );

  X_Audit.log('EXPORT_SUCCESS', INSTRUCTOR_CREDIT_EXPORT_ID, batchId, {
    pilotCount:  instructors.size,
    flightCount: eligible.length
  });

  const summaryLines = ['Credit notes generated:'];
  instructors.forEach((count, name) => {
    summaryLines.push('  ' + name + ': ' + count + ' flight(s)');
  });

  return {
    tsv,
    summary:         summaryLines.join('\n'),
    instructorCount: instructors.size,
    flightCount:     eligible.length
  };
}

// Register in sheet menu
X_ExportRegistry.register({
  name: 'Export Instructor Credits (TSV)',
  run:  runInstructorCreditExport
});
