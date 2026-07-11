/**
 * X_ManagerExport.gs - Manager.io Invoice Export
 *
 * Produces a TSV file formatted for Manager.io batch invoice import.
 * Grouped by customer (pilot / AEF / passenger), with dynamic line columns.
 *
 * Invocable two ways:
 *   • Menu item  → runManagerExport()        saves to Drive, shows skipped alert
 *   • Webapp     → runManagerExportFromWebapp(password)  returns TSV for clipboard
 *                  (defined in WebApp.gs)
 *
 * The password-gated webapp page that surfaces this export (alongside
 * Reckon, Tow/Winch Credits, and Instructor Credits) lives in
 * AccountingExportsPage.gs - see serveAccountingExportsPage().
 */

/**
 * Core export logic - shared by menu and webapp invocations
 */
function generateManagerExport() {
  const batchId = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd-HHmmss'
  );

  const issueDate = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  X_Validation.validateConfig();

  const flights = Flights.load();
  X_Validation.validateFlights(flights);

  const ignorePilot = getConfigValue('IGNORE_PILOT', false) || IGNORE_PILOT_DEFAULT;
  const exported = X_ExportState.exportedKeys(MANAGER_EXPORT_ID);

  const eligible = flights.filter(f =>
    !exported.has(f.key) &&
    f.pilot &&
    f.pilot !== ignorePilot
  );

  if (eligible.length === 0) {
    throw new Error('No eligible flights to export. Probably no un-exported flights.');
  }

  const invoices = Invoicing.buildInvoices(eligible);
  const rows = buildManagerCsv(invoices, issueDate);

  const tsv = rows.map(r =>
    r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join('\t')
  ).join('\n');

  X_ExportState.markExported(
    MANAGER_EXPORT_ID,
    batchId,
    eligible.map(f => f.key)
  );

  X_Audit.log('EXPORT_SUCCESS', MANAGER_EXPORT_ID, batchId, {
    pilotCount: invoices.length,
    flightCount: eligible.length
  });

  const noBillFlights = eligible.filter(f => f.payer === PAYER.NO_BILL);

  return { tsv, batchId, eligible, flights, exported, noBillFlights };
}

/**
 * Menu invocation - saves to Drive
 */
function runManagerExport() {
  Costs.assertConfigured([
    'WINCH_FEE',
    'WINCH_FEE_VISITOR',
    'TOW_RATE_TIME',
    'TOW_RATE_ALT',
    'DUE_DATE_DAYS',
    'AEF_AEROTOW_MODE'
  ]);

  X_Audit.log('EXPORT_START', MANAGER_EXPORT_ID);

  const { tsv, batchId, flights, exported, noBillFlights } = generateManagerExport();

  const blob = Utilities.newBlob(
    tsv,
    'text/csv',
    `ManagerExport_${batchId}.csv`
  );

  DriveApp.createFile(blob);

  const skipped = flights.filter(f =>
    !f.pilot && !exported.has(f.key)
  );

  if (skipped.length > 0) {
    SpreadsheetApp.getUi().alert(
      `Export completed with ${skipped.length} skipped flight(s).\n\n` +
      `Reason: Missing Pilot assignment.\n` +
      `These flights were NOT exported.\n\n` +
      `See AuditLog for details.`
    );
  }

  if (noBillFlights.length > 0) {
    const list = noBillFlights
      .map(f => `  ${f.pilot} — ${f.date} ${f.glider}${f.remarks ? ' (' + f.remarks + ')' : ''}`)
      .join('\n');
    SpreadsheetApp.getUi().alert(
      `${noBillFlights.length} flight(s) marked 'No Bill' were included at $0:\n\n${list}`
    );
  }
}

/**
 * Build Manager.io rows from generic invoices
 */
function buildManagerCsv(invoices, issueDate) {
  let maxLines = 0;
  invoices.forEach(invoice => {
    maxLines = Math.max(maxLines, invoice.lines.length);
  });

  const header = buildCsvHeader(maxLines);
  const rows = [header];

  invoices.forEach(invoice => {
    rows.push(buildInvoiceRow(invoice, issueDate, maxLines));
  });

  return rows;
}

/**
 * Build header with dynamic line columns
 */
function buildCsvHeader(maxLines) {
  const header = [
    'Customer',
    'IssueDate',
    'Reference',
    'Description',
    'HasLineDescription',
    'DueDate',
    'DueDateDays'
  ];

  for (let i = 1; i <= maxLines; i++) {
    header.push(
      `Lines.${i}.Item`,
      `Lines.${i}.LineDescription`,
      `Lines.${i}.Qty`,
      `Lines.${i}.SalesUnitPrice`,
      `Lines.${i}.TaxCode`,
      `Lines.${i}.Division`
    );
  }

  return header;
}

/**
 * Build a single invoice row from a generic invoice object
 */
function buildInvoiceRow(invoice, issueDate, maxLines) {
  const row = [];

  const dueDateDays = Costs.dueDateDays();

  row.push(
    invoice.customer,
    issueDate,
    invoice.reference ?? '',
    invoice.description,
    'True',
    'Net',
    dueDateDays
  );

  for (let i = 0; i < maxLines; i++) {
    if (i < invoice.lines.length) {
      const line = invoice.lines[i];
      row.push(
        line.item,
        line.description,
        line.qty,
        line.unitPrice,
        '',
        line.division
      );
    } else {
      row.push('', '', '', '', '', '');
    }
  }

  return row;
}

// Register export in menu
X_ExportRegistry.register({
  name: 'Export for Manager.io (CSV)',
  run: runManagerExport
});