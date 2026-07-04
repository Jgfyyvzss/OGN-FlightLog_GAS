/**
 * X_ReckonExport.gs - Reckon Accounts (QuickBooks) IIF Invoice Export
 *
 * Produces a tab-delimited IIF file for import via
 * File → Utilities → Import → IIF Files in Reckon/QuickBooks Desktop.
 *
 * Uses the same Invoicing.buildInvoices() output as the Manager export,
 * so grouping (Pilot / AEF / Visitor / Passenger), AEF $0.00 lines, and
 * the EXTERNAL/INHOUSE aerotow handling are identical between the two.
 *
 * Account/Class placeholders (Costs sheet):
 *   AR_ACCOUNT      - Accounts Receivable account (TRNS.ACCNT)
 *   INCOME_ACCOUNT  - single income account for all line items (SPL.ACCNT)
 *   CLASS           - glider Division is passed through to SPL.CLASS.
 *                      Division naming/structure may change pending
 *                      treasurer advice - this export just reflects
 *                      whatever Invoicing.gliderInfo() currently produces.
 *
 * Invocable two ways:
 *   • Menu item → runReckonExport()             saves .iif to Drive
 *   • Webapp    → runReckonExportFromWebapp(password)  returns IIF text
 *                  for download (button on serveManagerExport page)
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

  const ignorePilot = getConfigValue('IGNORE_PILOT', false) || 'Z_IGNORE';
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

  return { iif, batchId, eligible, flights, exported };
}

/**
 * Menu invocation - saves to Drive
 */
function runReckonExport() {
  Costs.assertConfigured([
    'WINCH_FEE',
    'WINCH_FEE_VISITOR',
    'TOW_RATE_TIME',
    'TOW_RATE_ALT',
    'AEF_AEROTOW_MODE',
    'AR_ACCOUNT',
    'INCOME_ACCOUNT'
  ]);

  X_Audit.log('EXPORT_START', RECKON_EXPORT_ID);

  const { iif, batchId, flights, exported } = generateReckonExport();

  const blob = Utilities.newBlob(
    iif,
    'text/plain',
    `ReckonExport_${batchId}.iif`
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
}

/**
 * Webapp entry point - called from serveManagerExport page.
 * Returns { iif, count, batchId } on success or { error } on failure.
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
      'TOW_RATE_ALT',
      'AEF_AEROTOW_MODE',
      'AR_ACCOUNT',
      'INCOME_ACCOUNT'
    ]);
    X_Audit.log('EXPORT_START', RECKON_EXPORT_ID);

    const { iif, batchId, eligible } = generateReckonExport();

    DriveApp.createFile(
      Utilities.newBlob(iif, 'text/plain', 'ReckonExport_' + batchId + '.iif')
    );

    return { iif: iif, count: eligible.length, batchId: batchId };

  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Build IIF text (tab-delimited) from generic invoices.
 *
 * One TRNS (invoice header, posts to AR), one SPL per line item
 * (posts to income account, negative amount), then ENDTRNS.
 * TRNS.AMOUNT = sum of SPL amounts (sign-flipped), so the
 * transaction balances even for AEF's all-zero invoices.
 */
function buildReckonIIF(invoices, issueDateISO) {
  const date = formatIIFDate(issueDateISO);
  const arAccount = Costs.arAccount();
  const incomeAccount = Costs.incomeAccount();

  const lines = [];
  lines.push(['!TRNS', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'MEMO'].join('\t'));
  lines.push(['!SPL', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'MEMO', 'QNTY', 'PRICE', 'INVITEM'].join('\t'));
  lines.push('!ENDTRNS');

  invoices.forEach(invoice => {
    // Reference holds the actual pilot for AEF/Visitor groups
    // (where customer is 'AEF' or 'Visitor') - keep that context in MEMO.
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

/**
 * Convert yyyy-MM-dd to MM/dd/yyyy (IIF requires US date format).
 */
function formatIIFDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${m}/${d}/${y}`;
}

/**
 * Format a number as a fixed 2dp string, normalising -0 to 0.00.
 */
function formatIIFAmount(n) {
  const v = Number(n) || 0;
  return (v === 0 ? 0 : v).toFixed(2);
}

// Register export in menu
X_ExportRegistry.register({
  name: 'Export for Reckon (IIF)',
  run: runReckonExport
});
