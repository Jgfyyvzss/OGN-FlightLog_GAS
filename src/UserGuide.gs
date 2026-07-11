/**
 * UserGuide.gs - Access Links Generator
 *
 * Writes the three live web app URLs (Pilot Entry, Accounting Exports,
 * Script Backup) into the UserGuide sheet, so a new admin can find them
 * without digging into Extensions > Apps Script > Deploy.
 *
 * The UserGuide sheet is assumed to already exist (it ships as part of the
 * template every club starts from) - this does not create or initialise it.
 *
 * Matching is by label, not by fixed cell position: this scans column B
 * (Topic) for known label text and writes the corresponding URL into
 * column C (Text) of that same row. Rows that don't match a known label
 * are left untouched. If a label isn't found, nothing is written for it -
 * the summary alert reports which labels were and weren't found, rather
 * than guessing a location or creating a row.
 *
 * Run manually from the Flight Log menu ("Update UserGuide Links") - not
 * automatic on open, so it never silently overwrites notes an admin has
 * added to the sheet, and only runs when someone actually wants fresh URLs
 * (e.g. after a redeploy under a new deployment ID).
 */

const USER_GUIDE_SHEET_NAME = 'UserGuide';

/**
 * Topic (column B) label -> URL to write into column C, keyed off the
 * live web app base URL.
 */
function _userGuideLinks(baseUrl) {
  return {
    'Flight Log URL':         baseUrl,
    'Accounting Exports URL': baseUrl + '?action=accountingExport',
    'Script Backup URL':      baseUrl + '?action=backup'
  };
}

function updateUserGuideLinks() {
  const baseUrl = ScriptApp.getService().getUrl();
  if (!baseUrl) {
    SpreadsheetApp.getUi().alert(
      'Could not determine the web app URL. The script must be deployed as ' +
      'a web app first (Extensions > Apps Script > Deploy > Manage deployments).'
    );
    return;
  }

  const links = _userGuideLinks(baseUrl);
  const sheet = Sheets.getSheet(USER_GUIDE_SHEET_NAME);

  const lastRow = sheet.getLastRow();
  const data = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 3).getValues() : []; // A:C

  const remaining = new Set(Object.keys(links));

  data.forEach((row, i) => {
    const topic = String(row[1] || '').trim();
    if (links.hasOwnProperty(topic)) {
      sheet.getRange(i + 1, 3).setValue(links[topic]);
      remaining.delete(topic);
    }
  });

  const totalLinks = Object.keys(links).length;
  let message = `UserGuide links updated: ${totalLinks - remaining.size} of ${totalLinks}.`;

  if (remaining.size > 0) {
    message += '\n\nNot found (check the Topic column B wording matches exactly):\n  ' +
      Array.from(remaining).join('\n  ');
  }

  SpreadsheetApp.getUi().alert(message);
}