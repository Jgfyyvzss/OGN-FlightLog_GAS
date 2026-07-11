/**
 * AccountingExportsPage.gs - Password-gated webapp page for accounting exports
 *
 * Serves the single page (doGet action=accountingExport; legacy action=managerExport
 * is still accepted so existing bookmarks keep working) that exposes all of the
 * accounting-related exports to a club treasurer/admin without needing to open
 * the spreadsheet:
 *   - Flight Invoices (Manager.io)   - X_ManagerExport.gs
 *   - Flight Invoices (Reckon IIF)   - X_ReckonExport.gs
 *   - Tow / Winch Driver Credits     - X_TowCreditExport.gs
 *   - Instructor Credits             - X_InstructorCreditExport.gs
 *
 * This file only builds and serves the HTML shell and its client-side JS.
 * The password check and export logic live in each export's own
 * *FromWebapp() function (runManagerExportFromWebapp in WebApp.gs,
 * runReckonExportFromWebapp, runTowCreditExportFromWebapp,
 * runInstructorCreditExportFromWebapp) - this page just calls whichever one
 * the button maps to via google.script.run.
 *
 * The Flight Invoices (Manager) and Reckon (IIF) sections are shown based
 * on the optional Config key ACCOUNTING_SYSTEM:
 *   - unset      -> both sections shown
 *   - 'MANAGER'  -> only Flight Invoices (Manager) shown
 *   - 'RECKON'   -> only Reckon (IIF) shown
 * Credit exports are shown regardless (accounting-system agnostic for now).
 *
 * Page heading/title use Config.CLUB_ABBREVIATION, same as the pilot-entry
 * form in WebApp.gs - so this page reads correctly for either club instead
 * of being hardcoded to one.
 */
function serveAccountingExportsPage() {
  const system = (getConfigValue('ACCOUNTING_SYSTEM', false) || '').toUpperCase();
  const showManager = !system || system === 'MANAGER';
  const showReckon  = !system || system === 'RECKON';

  const clubAbbr = getConfigValue('CLUB_ABBREVIATION', false) || '';
  const pageTitle = (clubAbbr ? clubAbbr + ' ' : '') + 'Accounting Exports';

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

<h2>${pageTitle}</h2>
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

  return HtmlService.createHtmlOutput(html).setTitle(pageTitle);
}