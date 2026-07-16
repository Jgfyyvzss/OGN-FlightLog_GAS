/**
 * X_ReckonExport.gs - Reckon Accounts (QuickBooks) IIF Invoice Export
 *
 * Produces a tab-delimited IIF file for import via
 * File → Utilities → Import → IIF Files in Reckon/QuickBooks Desktop.
 *
 * Uses the same Invoicing.buildInvoices() output as the Manager export,
 * so grouping (Pilot / AEF / Visitor / Shared), No Bill / AEF $0 lines,
 * and the EXTERNAL/INHOUSE aerotow handling are identical between the two.
 *
 * Account/Class placeholders (Config sheet):
 *   AR_ACCOUNT      - Accounts Receivable account (TRNS.ACCNT)
 *   INCOME_ACCOUNT  - single income account for all line items (SPL.ACCNT)
 *   CLASS           - glider Division is passed through to SPL.CLASS.
 *
 * Invocable two ways:
 *   • Menu item → runReckonExport()             saves .iif to Drive
 *   • Webapp    → runReckonExportFromWebapp(password)  returns IIF text
 *                  for download (button on serveAccountingExportsPage)
 *
 * Tracked independently via its own X_ExportState EXPORT_ID - a flight
 * can be exported to Manager and Reckon independently of each other.
 */

const RECKON_EXPORT_ID = 'reckon_iif';

/**
 * Core export logic - shared by menu and webapp invocations
 */
function generateReckonExport() {
  const batchId = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss'
  );

  const issueDate = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'
  );

  X_Validation.validateConfig();

  const flights = Flights.load();
  X_Validation.validateFlights(flights);

  const ignorePilot = getConfigValue('IGNORE_PILOT', false) || IGNORE_PILOT_DEFAULT;
  const exported = X_ExportState.exportedKeys(RECKON_EXPORT_ID);

  const eligible = flights.filter(f =>
    !exported.has(f.key) &&
    f.pilot &&
    f.pilot !== ignorePilot
  );

  if (eligible.length === 0) {
    throw new Error('No eligible flights to export. Probably no un-exported flights.');
  }

  const invoices = Invoicing.buildInvoices(eligible);
  const iif = buildReckonIIF(invoices, issueDate);

  X_ExportState.markExported(
    RECKON_EXPORT_ID,
    batchId,
    eligible.map(f => f.key)
  );

  X_Audit.log('EXPORT_SUCCESS', RECKON_EXPORT_ID, batchId, {
    pilotCount: invoices.length,
    flightCount: eligible.length
  });

  const noBillFlights = eligible.filter(f => f.payer === PAYER.NO_BILL);

  return { iif, batchId, eligible, flights, exported, noBillFlights };
}

/**
 * Menu invocation - saves to Drive
 */
function runReckonExport() {
  Costs.assertConfigured([
    'WINCH_FEE',
    'WINCH_FEE_VISITOR',
    'TOW_RATE_TIME',
    'TOW_RATE_ALT'
  ]);

  X_Audit.log('EXPORT_START', RECKON_EXPORT_ID);

  const { iif, batchId, flights, exported, noBillFlights } = generateReckonExport();

  const blob = Utilities.newBlob(
    iif,
    'text/plain',
    `ReckonExport_${batchId}.iif`
  );

  getExportFolder().createFile(blob);

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
 * Webapp entry point - called from serveAccountingExportsPage (AccountingExportsPage.gs).
 * Returns { iif, count, batchId, summary } on success or { error } on failure.
 */
function runReckonExportFromWebapp(password) {
  const expectedPassword = Config.get('EXPORT_PASSWORD');
  if (password !== expectedPassword) {
    return { error: 'Incorrect password.' };
  }

  try {
    Costs.assertConfigured([
      'WINCH_FEE',
      'WINCH_FEE_VISITOR',
      'TOW_RATE_TIME',
      'TOW_RATE_ALT'
    ]);
    X_Audit.log('EXPORT_START', RECKON_EXPORT_ID);

    const { iif, batchId, eligible, noBillFlights } = generateReckonExport();

    getExportFolder().createFile(
      Utilities.newBlob(iif, 'text/plain', 'ReckonExport_' + batchId + '.iif')
    );

    let summary = '';
    if (noBillFlights.length > 0) {
      summary = noBillFlights.length + " flight(s) marked 'No Bill' (included at $0):\n" +
        noBillFlights.map(f => '  ' + f.pilot + ' — ' + f.date + ' ' + f.glider +
          (f.remarks ? ' (' + f.remarks + ')' : '')).join('\n');
    }

    return { iif: iif, count: eligible.length, batchId: batchId, summary: summary };

  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Build IIF text (tab-delimited) from generic invoices.
 */
function buildReckonIIF(invoices, issueDateISO) {
  const date = formatIIFDate(issueDateISO);
  const arAccount = Config.get('AR_ACCOUNT');
  const incomeAccount = Config.get('INCOME_ACCOUNT');

  const lines = [];
  lines.push(['!TRNS', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'MEMO'].join('\t'));
  lines.push(['!SPL', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'MEMO', 'QNTY', 'PRICE', 'INVITEM'].join('\t'));
  lines.push('!ENDTRNS');

  invoices.forEach(invoice => {
    const memo = invoice.reference
      ? `${invoice.description} - Ref: ${invoice.reference}`
      : invoice.description;

    const splAmounts = invoice.lines.map(line =>
      Math.round(Number(line.qty) * Number(line.unitPrice) * 100) / 100
    );

    const total = splAmounts.reduce((sum, a) => sum + a, 0);

    lines.push([
      'TRNS', 'INVOICE', date, arAccount, invoice.customer, '',
      formatIIFAmount(total), memo
    ].join('\t'));

    invoice.lines.forEach((line, i) => {
      lines.push([
        'SPL', 'INVOICE', date, incomeAccount, invoice.customer,
        line.division || '',
        formatIIFAmount(-splAmounts[i]),
        line.description,
        line.qty,
        line.unitPrice,
        line.item
      ].join('\t'));
    });

    lines.push('ENDTRNS');
  });

  return lines.join('\n');
}

function formatIIFDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y}`;
}

function formatIIFAmount(n) {
  const v = Number(n) || 0;
  return (v === 0 ? 0 : v).toFixed(2);
}

// Register export in menu
X_ExportRegistry.register({
  name: 'Export for Reckon (IIF)',
  run: runReckonExport
});
