/**
 * X_TowCreditExport.gs - Tow Pilot / Winch Driver Credit Note Export
 *
 * For each un-exported flight that has a TowPilot value, counts the operation
 * and generates one Manager.io credit note per operator.
 *
 * TSV columns (no headers):
 *   IssueDate | Reference | Customer | Description |
 *   Lines.1.Item | Lines.1.Qty | Lines.1.SalesUnitPrice
 *
 * Item codes:
 *   AT  - Aerotow (flight has towPlane populated)
 *   WL  - Winch launch (no towPlane)
 *
 * Rate source: Costs sheet
 *   TOW_PILOT_CREDIT_AT  - credit per aerotow
 *   TOW_PILOT_CREDIT_WL  - credit per winch launch
 *
 * Un-exported tracking uses X_ExportState with EXPORT_ID = 'tow_credit_tsv'.
 * Only flights that also appear as exported in the main manager_csv export
 * are candidates — this prevents crediting a tow before the flight is invoiced.
 * Override this gate by setting Config key CREDIT_GATE = 'OFF'.
 */

const TOW_CREDIT_EXPORT_ID = 'tow_credit_tsv';

/**
 * Webapp entry point — called from serveManagerExport page.
 * Returns { tsv, rows } on success or { error } on failure.
 */
function runTowCreditExportFromWebapp(password) {
  const expectedPassword = Config.get('EXPORT_PASSWORD');
  if (password !== expectedPassword) {
    return { error: 'Incorrect password.' };
  }
  try {
    const { tsv, summary } = generateTowCreditExport();
    return { tsv, summary };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Menu entry point — saves to Drive.
 */
function runTowCreditExport() {
  const batchId = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss'
  );
  X_Audit.log('EXPORT_START', TOW_CREDIT_EXPORT_ID, batchId);

  try {
    const { tsv, summary, operatorCount, flightCount } = generateTowCreditExport();

    if (!tsv) {
      SpreadsheetApp.getUi().alert('No un-exported tow/winch operations found.');
      return;
    }

    const blob = Utilities.newBlob(
      tsv, 'text/csv', 'TowCreditExport_' + batchId + '.csv'
    );
    DriveApp.createFile(blob);

    X_Audit.log('EXPORT_SUCCESS', TOW_CREDIT_EXPORT_ID, batchId, {
      pilotCount:  operatorCount,
      flightCount: flightCount
    });

    SpreadsheetApp.getUi().alert(
      'Tow/Winch credit export complete.\n\n' +
      operatorCount + ' operator(s), ' + flightCount + ' operation(s).\n' +
      'File saved to Drive: TowCreditExport_' + batchId + '.csv'
    );

  } catch (e) {
    X_Audit.log('EXPORT_ERROR', TOW_CREDIT_EXPORT_ID, batchId, { notes: e.message });
    SpreadsheetApp.getUi().alert('Export failed: ' + e.message);
    throw e;
  }
}

/**
 * Core logic — shared by menu and webapp.
 * @returns {{ tsv: string, summary: string, operatorCount: number, flightCount: number }}
 */
function generateTowCreditExport() {
  // Rate config — will throw if not present
  const rateAT = Costs.get('TOW_PILOT_CREDIT_AT');
  const rateWL = Costs.get('TOW_PILOT_CREDIT_WL');

  const issueDate = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'dd/MM/yy'
  );

  const batchId = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss'
  );

  const flights = Flights.load();
  const creditExported = X_ExportState.exportedKeys(TOW_CREDIT_EXPORT_ID);

  // Gate: only credit flights that have been invoiced (manager_csv exported)
  // unless the gate is explicitly disabled in Config.
  const gateDisabled = (() => {
    try { return Config.get('CREDIT_GATE') === 'OFF'; } catch (e) { return false; }
  })();

  const flightExported = gateDisabled
    ? null
    : X_ExportState.exportedKeys('manager_csv');

  // Eligible: has TowPilot, not yet credited, and (if gate on) already invoiced
  const eligible = flights.filter(f =>
    f.towPilot &&
    !creditExported.has(f.key) &&
    (gateDisabled || flightExported.has(f.key))
  );

  if (eligible.length === 0) {
    return { tsv: '', summary: 'No eligible operations found.', operatorCount: 0, flightCount: 0 };
  }

  // Group by operator name, split by operation type
  const operators = new Map();  // name -> { AT: count, WL: count }

  eligible.forEach(f => {
    const name = f.towPilot;
    if (!operators.has(name)) operators.set(name, { AT: 0, WL: 0 });
    const op = operators.get(name);
    if (f.towPlane) {
      op.AT++;
    } else {
      op.WL++;
    }
  });

  // Build TSV rows — one row per operator per operation type (skip zeros)
    const rows = [
    ['IssueDate', 'Reference', 'Customer', 'Description', 'Lines.1.Item', 'Lines.1.Qty', 'Lines.1.SalesUnitPrice']
  ];
  operators.forEach((counts, name) => {
    if (counts.AT > 0) {
      rows.push([
        issueDate,
        '',                          // Reference — blank, operator name is the customer
        name,
        'Aerotow credit',
        'AT',
        counts.AT,
        rateAT.toFixed(2)
      ]);
    }
    if (counts.WL > 0) {
      rows.push([
        issueDate,
        '',
        name,
        'Winch driving credit',
        'WL',
        counts.WL,
        rateWL.toFixed(2)
      ]);
    }
  });

  const tsv = rows.map(r =>
    r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join('\t')
  ).join('\n');

  // Mark all eligible flights as credited
  X_ExportState.markExported(
    TOW_CREDIT_EXPORT_ID,
    batchId,
    eligible.map(f => f.key)
  );

  X_Audit.log('EXPORT_SUCCESS', TOW_CREDIT_EXPORT_ID, batchId, {
    pilotCount:  operators.size,
    flightCount: eligible.length
  });

  // Human-readable summary for webapp display
  const summaryLines = ['Credit notes generated:'];
  operators.forEach((counts, name) => {
    const parts = [];
    if (counts.AT > 0) parts.push(counts.AT + ' aerotow(s)');
    if (counts.WL > 0) parts.push(counts.WL + ' winch(es)');
    summaryLines.push('  ' + name + ': ' + parts.join(', '));
  });

  return {
    tsv,
    summary:       summaryLines.join('\n'),
    operatorCount: operators.size,
    flightCount:   eligible.length
  };
}

// Register in sheet menu
X_ExportRegistry.register({
  name: 'Export Tow/Winch Credits (TSV)',
  run:  runTowCreditExport
});
