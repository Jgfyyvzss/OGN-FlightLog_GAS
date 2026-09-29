/**
 * X_GAusMembershipExport.gs - GAus Short Term Membership Purchase Invoice Export
 *
 * Every AEF flight carries a mandatory Gliding Australia short term
 * membership fee that the club collects and passes through to GAus. This
 * export produces the PURCHASE side of that pass-through: one Manager.io
 * purchase invoice per AEF customer, so that when the club pays GAus, the
 * single payment can be split across the individual invoices it covers.
 * That gives per-customer traceability that every AEF customer's membership
 * was actually paid to GAus.
 *
 * The SALES side needs no code: Invoicing.groupFlightsByCustomer() already
 * sets reference: f.pilot on AEF groups, so the AEF sales invoice already
 * carries the customer name as its Reference. The two sides therefore share
 * the same Reference string and reconcile against each other directly.
 *
 * One invoice per customer per run (not per flight) - a customer who flew
 * twice in one batch still owes one membership.
 *
 * TSV columns (trimmed from Manager's full Batch Create set):
 *   IssueDate | Reference | Supplier | Description | HasLineDescription |
 *   Lines.1.Item | Lines.1.LineDescription | Lines.1.Qty |
 *   Lines.1.PurchaseUnitPrice
 *
 * IssueDate is the customer's earliest AEF flight date in the run, not the
 * date the export was run: the liability to GAus is incurred on the flight
 * day (the same principle as X_AEFAccrualExport.gs), and it means the date
 * shown when allocating a GAus payment matches the flight being looked for.
 * A consequence worth knowing: running the export over a long backlog will
 * date invoices into earlier periods, which Manager may refuse if those
 * periods are locked.
 *
 * Deliberately omitted:
 *   Lines.1.Account   - the Item drives the account inside Manager
 *   Lines.1.Division  - Division identifies the glider; a membership is not
 *                       glider-specific
 *   Lines.1.TaxCode   - omitted so Manager applies the Item's own tax code
 *                       rather than reading an empty value as "no tax"
 *   DueDate/DueDateDays - Config.DUE_DATE_DAYS is the club's terms for its
 *                       own members, not GAus's terms. The club pays GAus on
 *                       a statement cycle, so a per-invoice due date adds
 *                       nothing. Manager defaults it.
 *   AutomaticReference - omitted so our explicit Reference is not overridden
 *   Obsolete_*        - legacy columns, never used
 *
 * Config keys:
 *   GAUS_SUPPLIER_NAME        - must match the supplier name in Manager exactly
 *   ITEM_CODE_GAUS_MEMBERSHIP - Manager item code for the membership
 * Costs key:
 *   GAUS_MEMBERSHIP_FEE       - the fee amount
 *
 * Tracked independently of the flight invoice export via its own
 * X_ExportState EXPORT_ID, so it runs on its own schedule. Surfaced on the
 * accounting exports page as "AEF Memberships" (AccountingExportsPage.gs).
 */

const GAUS_MEMBERSHIP_EXPORT_ID = 'gaus_membership_purchase';

// GAus short term membership validity, used only to warn about a repeat
// customer inside the window - see _recentCustomers().
const GAUS_MEMBERSHIP_VALID_DAYS = 30;

/**
 * Webapp entry point - called from serveAccountingExportsPage
 * (AccountingExportsPage.gs). Returns { tsv, summary } or { error }.
 */
function runGAusMembershipExportFromWebapp(password) {
  const expectedPassword = Config.get('EXPORT_PASSWORD');
  if (password !== expectedPassword) {
    return { error: 'Incorrect password.' };
  }
  try {
    const { tsv, summary } = generateGAusMembershipExport();
    return { tsv, summary };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Menu entry point - saves to Drive.
 */
function runGAusMembershipExport() {
  const batchId = X_ExportBase.makeBatchId();
  X_Audit.log('EXPORT_START', GAUS_MEMBERSHIP_EXPORT_ID, batchId);

  try {
    const { tsv, summary, customerCount, flightCount } = generateGAusMembershipExport();

    if (!tsv) {
      SpreadsheetApp.getUi().alert('No un-exported AEF memberships found.');
      return;
    }

    getExportFolder().createFile(
      Utilities.newBlob(tsv, 'text/csv', 'GAusMembershipExport_' + batchId + '.csv')
    );

    SpreadsheetApp.getUi().alert(
      'GAus membership export complete.\n\n' +
      customerCount + ' membership(s) from ' + flightCount + ' AEF flight(s).\n' +
      'File saved to Drive: GAusMembershipExport_' + batchId + '.csv\n\n' +
      summary
    );

  } catch (e) {
    X_Audit.log('EXPORT_ERROR', GAUS_MEMBERSHIP_EXPORT_ID, batchId, { notes: e.message });
    SpreadsheetApp.getUi().alert('Export failed: ' + e.message);
    throw e;
  }
}

/**
 * Normalise a flight date for use as the invoice IssueDate.
 *
 * The membership liability is incurred on the flight day, not on the day the
 * export happens to run, so the invoice is dated accordingly - and the date
 * shown when allocating a payment in Manager then matches the flight the
 * treasurer is looking for.
 *
 * Flights.load() reads cells raw: unlike getFlightsFromSheet in
 * DataWriter.gs it neither strips the apostrophe that forces text storage
 * nor rejects Date objects. IssueDate is load-bearing for the Manager
 * import, so an unrecognisable value falls back to the run date rather than
 * producing a row Manager will reject.
 */
function _membershipInvoiceDate(flightDate, fallbackISO) {
  const s = String(flightDate == null ? '' : flightDate).replace(/^'/, '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallbackISO;
}

/**
 * True when flight f took off before the earliest flight held so far.
 * Compared by date then by takeoff time; a flight with no date never wins,
 * and a held entry with no date always loses.
 */
function _isEarlierFlight(f, current) {
  const fd = String(f.date || '').trim();
  const cd = String(current.date || '').trim();
  if (!fd) return false;
  if (!cd) return true;
  if (fd !== cd) return fd < cd;

  const ft = parseTime(f.takeOff);
  const ct = parseTime(current.takeOff);
  if (!ft) return false;
  if (!ct) return true;
  return (ft.hour * 60 + ft.minute) < (ct.hour * 60 + ct.minute);
}

/**
 * Customers whose membership was exported within the validity window.
 *
 * ExportState stores flight keys, not names, so recent keys are mapped back
 * to customer names through the flight list. If an old flight row has since
 * been removed from the sheet its name simply can't be resolved and is not
 * flagged - the warning degrades quietly rather than failing the export.
 *
 * @param {Array} allFlights - normalised flights from Flights.load()
 * @returns {Map} lowercased customer name -> most recent export Date
 */
function _recentCustomers(allFlights) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GAUS_MEMBERSHIP_VALID_DAYS);

  const nameByKey = new Map();
  allFlights.forEach(f => {
    if (f.key && f.pilot) nameByKey.set(f.key, f.pilot);
  });

  const recent = new Map();
  X_ExportState.exportedRecords(GAUS_MEMBERSHIP_EXPORT_ID).forEach(r => {
    if (!r.timestamp || r.timestamp < cutoff) return;
    const name = nameByKey.get(r.key);
    if (!name) return;
    const k = name.trim().toLowerCase();
    const prev = recent.get(k);
    if (!prev || r.timestamp > prev) recent.set(k, r.timestamp);
  });

  return recent;
}

/**
 * Core logic - shared by menu and webapp.
 * @returns {{ tsv, summary, customerCount, flightCount }}
 */
function generateGAusMembershipExport() {
  const supplier = Config.get('GAUS_SUPPLIER_NAME');
  const itemCode = Config.get('ITEM_CODE_GAUS_MEMBERSHIP');
  const fee      = Costs.get('GAUS_MEMBERSHIP_FEE');

  const tz = Session.getScriptTimeZone();
  const issueDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const batchId   = X_ExportBase.makeBatchId();

  const allFlights = Flights.load();
  const exported   = X_ExportState.exportedKeys(GAUS_MEMBERSHIP_EXPORT_ID);
  const ignorePilot = getConfigValue('IGNORE_PILOT', false) || IGNORE_PILOT_DEFAULT;

  const eligible = allFlights.filter(f =>
    f.payer === PAYER.AEF &&
    f.pilot &&
    f.pilot !== ignorePilot &&
    !exported.has(f.key)
  );

  if (eligible.length === 0) {
    return { tsv: '', summary: 'No eligible AEF flights found.', customerCount: 0, flightCount: 0 };
  }

  // One membership per customer, dated and described by that customer's
  // earliest flight in this run - the visit that incurred the membership.
  const customers = new Map();   // name -> { date, takeOff, flightCount }
  eligible.forEach(f => {
    const name = f.pilot.trim();
    if (!customers.has(name)) {
      customers.set(name, { date: f.date, takeOff: f.takeOff, flightCount: 0 });
    }
    const c = customers.get(name);
    if (_isEarlierFlight(f, c)) {
      c.date    = f.date;
      c.takeOff = f.takeOff;
    }
    c.flightCount++;
  });

  const recent = _recentCustomers(allFlights);

  const rows = [[
    'IssueDate',
    'Reference',
    'Supplier',
    'Description',
    'HasLineDescription',
    'Lines.1.Item',
    'Lines.1.LineDescription',
    'Lines.1.Qty',
    'Lines.1.PurchaseUnitPrice'
  ]];

  const warnings = [];

  customers.forEach((c, name) => {
    const invoiceDate = _membershipInvoiceDate(c.date, issueDate);
    const takeOff     = formatClockTime(c.takeOff);

    rows.push([
      invoiceDate,                             // flight date, not the run date
      name,                                    // Reference - the traceability key
      supplier,
      'AEF Short Term Membership — ' + name,
      'True',
      itemCode,
      'AEF flight ' + invoiceDate + (takeOff ? ' ' + takeOff : ''),
      '1',
      fee.toFixed(2)
    ]);

    const prior = recent.get(name.toLowerCase());
    if (prior) {
      warnings.push(
        '  ' + name + ' - membership already exported ' +
        Utilities.formatDate(prior, tz, 'yyyy-MM-dd') +
        ' (within ' + GAUS_MEMBERSHIP_VALID_DAYS + ' days)'
      );
    }
  });

  const tsv = X_ExportBase.rowsToTsv(rows);

  X_ExportState.markExported(
    GAUS_MEMBERSHIP_EXPORT_ID,
    batchId,
    eligible.map(f => f.key)
  );

  X_Audit.log('EXPORT_SUCCESS', GAUS_MEMBERSHIP_EXPORT_ID, batchId, {
    pilotCount:  customers.size,
    flightCount: eligible.length,
    notes:       warnings.length > 0 ? warnings.length + ' possible duplicate membership(s)' : ''
  });

  const summaryLines = [customers.size + ' membership(s) at $' + fee.toFixed(2) + ':'];
  customers.forEach((c, name) => {
    summaryLines.push('  ' + name + (c.flightCount > 1 ? ' (' + c.flightCount + ' flights)' : ''));
  });

  if (warnings.length > 0) {
    summaryLines.push('');
    summaryLines.push('WARNING - possible duplicate membership purchase.');
    summaryLines.push('A GAus membership is valid ' + GAUS_MEMBERSHIP_VALID_DAYS +
                      ' days. Delete these rows before importing if the');
    summaryLines.push('customer already holds a current membership:');
    warnings.forEach(w => summaryLines.push(w));
  }

  return {
    tsv,
    summary:       summaryLines.join('\n'),
    customerCount: customers.size,
    flightCount:   eligible.length
  };
}

// Register in sheet menu
X_ExportRegistry.register({
  name: 'Export AEF Memberships (TSV)',
  run:  runGAusMembershipExport
});
