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
 * serveManagerExport() also exposes the Tow/Winch Credit and Instructor
 * Credit exports (X_TowCreditExport.gs / X_InstructorCreditExport.gs), and
 * the Reckon IIF export (X_ReckonExport.gs), on the same password-gated page.
 *
 * The Flight Invoices (Manager) and Reckon (IIF) sections are shown based
 * on the optional Config key ACCOUNTING_SYSTEM:
 *   - unset      → both sections shown
 *   - 'MANAGER'  → only Flight Invoices (Manager) shown
 *   - 'RECKON'   → only Reckon (IIF) shown
 * Credit exports are shown regardless (accounting-system agnostic for now).
 */

const EXPORT_ID = 'manager_csv';

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

  const ignorePilot = getConfigValue('IGNORE_PILOT', false) || 'Z_IGNORE';
  const exported = X_ExportState.exportedKeys(EXPORT_ID);

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
    EXPORT_ID,
    batchId,
    eligible.map(f => f.key)
  );

  X_Audit.log('EXPORT_SUCCESS', EXPORT_ID, batchId, {
    pilotCount: invoices.length,
    flightCount: eligible.length
  });

  return { tsv, batchId, eligible, flights, exported };
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

  X_Audit.log('EXPORT_START', EXPORT_ID);

  const { tsv, batchId, flights, exported } = generateManagerExport();

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
}

/**
 * Webapp page - password-gated, with buttons for the exports that
 * share this page: Flight Invoices, Tow/Winch Credits, Instructor
 * Credits, and Reckon (IIF). Manager/Reckon sections are shown based
 * on Config.ACCOUNTING_SYSTEM (see file header).
 */
function serveManagerExport() {
  const system = (getConfigValue('ACCOUNTING_SYSTEM', false) || '').toUpperCase();
  const showManager = !system || system === 'MANAGER';
  const showReckon  = !system || system === 'RECKON';

  const html = `<!DOCTYPE html>
<html><head><style>
  body{font-family:sans-serif;padding:40px;max-width:650px;margin:0 auto}
  h2{margin-bottom:4px}
  h3{margin-top:32px}
  input{padding:10px;font-size:16px;border:2px solid #ccc;border-radius:6px;margin-right:10px;width:200px}
  button{padding:10px 20px;font-size:16px;background:#0e639c;color:white;border:none;border-radius:6px;cursor:pointer}
  button:hover{background:#1177bb}
  button:disabled{opacity:0.5;cursor:not-allowed}
  .msg{margin-top:16px;font-size:15px;color:#333}
  .error{margin-top:16px;color:#c0392b;font-size:15px}
  textarea{display:none}
  pre{background:#f5f5f5;padding:12px;border-radius:6px;font-size:13px;white-space:pre-wrap}
  hr{margin:24px 0;border:none;border-top:1px solid #ddd}
</style></head><body>

<h2>ASMB Manager Exports</h2>
<p>Enter the export password, then run any of the exports below:</p>
<input type="password" id="pwd" placeholder="Password">

${showManager ? `
<hr>
<h3>Flight Invoices (Manager.io)</h3>
<button id="runBtn" onclick="runExport('runManagerExportFromWebapp','run','Sales Invoices','paste')">Export Flights</button>
<div id="runError" class="error"></div>
<div id="runMsg" class="msg"></div>
<textarea id="runTsv"></textarea>
` : ''}

<hr>
<h3>Tow / Winch Driver Credits</h3>
<button id="towBtn" onclick="runExport('runTowCreditExportFromWebapp','tow','Sales Credit Notes','paste')">Export Tow/Winch Credits</button>
<div id="towError" class="error"></div>
<div id="towMsg" class="msg"></div>
<textarea id="towTsv"></textarea>

<hr>
<h3>Instructor Credits</h3>
<button id="instBtn" onclick="runExport('runInstructorCreditExportFromWebapp','inst','Sales Credit Notes','paste')">Export Instructor Credits</button>
<div id="instError" class="error"></div>
<div id="instMsg" class="msg"></div>
<textarea id="instTsv"></textarea>

${showReckon ? `
<hr>
<h3>Flight Invoices (Reckon IIF)</h3>
<button id="reckonBtn" onclick="runExport('runReckonExportFromWebapp','reckon',null,'download')">Export for Reckon</button>
<div id="reckonError" class="error"></div>
<div id="reckonMsg" class="msg"></div>
<textarea id="reckonTsv"></textarea>
` : ''}

<script>
function runExport(serverFn, prefix, pasteTarget, mode) {
  var pwd     = document.getElementById('pwd').value;
  var btn     = document.getElementById(prefix + 'Btn');
  var errorEl = document.getElementById(prefix + 'Error');
  var msgEl   = document.getElementById(prefix + 'Msg');
  var tsvEl   = document.getElementById(prefix + 'Tsv');

  errorEl.textContent = '';
  msgEl.innerHTML = '';
  tsvEl.value = '';
  tsvEl.style.display = 'none';

  if (!pwd) { errorEl.textContent = 'Please enter the password.'; return; }

  var label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Running...';

  google.script.run
    .withSuccessHandler(function(result) {
      btn.disabled = false;
      btn.textContent = label;

      if (result.error) {
        errorEl.textContent = result.error;
        return;
      }

      var out = '';

      if (result.count !== undefined) {
        out += '<p><strong>' + result.count + ' flight(s) exported (' + result.batchId + ')</strong><br>' +
               'A backup copy has been saved to Google Drive.</p>';
      }

      if (result.summary) {
        out += '<pre>' + result.summary.replace(/</g, '&lt;') + '</pre>';
      }

      var content = result.tsv || result.iif;

      if (content) {
        if (mode === 'download') {
          var filename = 'ReckonExport_' + result.batchId + '.iif';
          var dataUri = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
          out += '<p><a download="' + filename + '" href="' + dataUri + '">Download ' + filename + '</a></p>';
        } else {
          tsvEl.value = content;
          out += '<p>Paste into Manager ' + pasteTarget + ' Batch Create</p>' +
                 '<button onclick="copyTsv(\\'' + prefix + 'Tsv\\',\\'' + prefix + 'Msg\\')">Copy to Clipboard</button>';
        }
      }

      msgEl.innerHTML = out || '<p>Nothing to export.</p>';
    })
    .withFailureHandler(function(err) {
      btn.disabled = false;
      btn.textContent = label;
      errorEl.textContent = 'Error: ' + err.message;
    })
    [serverFn](pwd);
}

function copyTsv(tsvId, msgId) {
  var text = document.getElementById(tsvId).value;
  navigator.clipboard.writeText(text).then(function() {
    document.getElementById(msgId).innerHTML += '<p style="color:green">Copied!</p>';
  });
}
<\/script>
</body></html>`;

  return HtmlService.createHtmlOutput(html).setTitle('Manager.io Export');
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
