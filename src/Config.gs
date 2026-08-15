//X_Audit.gs
const X_Audit = (() => {
   function log(action, exportId, batchId, details = {}) {
     Sheets.appendRow('AuditLog', [
       new Date(),
        Session.getActiveUser().getEmail(),
        action,
        exportId,
        batchId,
        details.pilotCount || '',
        details.flightCount || '',
        details.notes || ''
        ]);
        } return { log };
               
         })();


function debugHTMLScraper() {
  const config = getConfig();
  const airportCode = config.AIRPORT_CODE;
  const timezone = config.TIMEZONE;
  const isoDate = getTodayISO();

  const parts = isoDate.split("-");
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  const formattedDateForURL = Utilities.formatDate(date, timezone, "ddMMyyyy");
  const timezoneOffset = getTimezoneOffset();

  const url = `https://logbook.glidernet.org/index.php?t=0&a=${airportCode}&d=${formattedDateForURL}&s=QFE&u=m&z=${timezoneOffset}`;
  Logger.log('URL: ' + url);
  Logger.log('Resolved DATA_SOURCE_PRIORITY: ' + getDataSourcePriority());

  let html;
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    Logger.log('HTTP status: ' + resp.getResponseCode());
    html = resp.getContentText();
    Logger.log('Response length: ' + html.length);
  } catch (e) {
    Logger.log('FETCH THREW: ' + e.toString());
    return;
  }

  const tableMatches = html.match(/<TABLE[\s\S]*?<\/TABLE>/gi);
  Logger.log('Tables found: ' + (tableMatches ? tableMatches.length : 0));
  if (!tableMatches || tableMatches.length < 2) {
    Logger.log('Would return 0 flights here — this is why it falls back to API.');
    return;
  }

  const rowMatches = tableMatches[1].match(/<TR>[\s\S]*?<\/TR>/gi) || [];
  Logger.log('Rows found: ' + rowMatches.length);

  let dumped = 0;
  rowMatches.forEach(rowHtml => {
    if (dumped >= 8) return; // just the first few for inspection
    const cellMatches = rowHtml.match(/<T[HD][^>]*>([\s\S]*?)<\/T[HD]>/gi);
    if (!cellMatches || cellMatches.length < 5) return;
    const cells = cellMatches.map(extractTextFromCell);
    if (!/^\d+$/.test(cells[0].trim())) return;
    Logger.log('Row: ' + JSON.stringify(cells));
    dumped++;
  });
}
