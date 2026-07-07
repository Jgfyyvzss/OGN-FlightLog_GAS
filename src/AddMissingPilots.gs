function refreshPilotValidation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = ss.getSheetByName("MissingPilots");
  const pilotSource = ss.getSheetByName("People").getRange("A2:A");
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(pilotSource, true)
    .setAllowInvalid(true)
    .build();
  report.getRange(2, 8, report.getMaxRows() - 1, 1).setDataValidation(rule);
}

function onEdit(e) {
  if (!e) return;
  const sheet = e.range.getSheet();
  const name = sheet.getName();

  if (name === "People") {
    // Refresh dropdown if the Pilot column (A) was touched
    if (e.range.getColumn() <= 1 && e.range.getColumn() + e.range.getNumColumns() - 1 >= 1) {
      refreshPilotValidation();
    }
    return;
  }

  if (name === "MissingPilots") {
    if (e.range.getColumn() !== 8) return;
    if (e.range.getRow() < 2) return;

    const pilotName = e.range.getValue();
    if (!pilotName) return;

    const flightKey = sheet.getRange(e.range.getRow(), 1).getValue();
    if (!flightKey) return;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const flightLog = ss.getSheetByName(FLIGHT_LOG_SHEET_NAME);
    const keys = flightLog.getRange("A:A").getValues();

    for (let i = 0; i < keys.length; i++) {
      if (keys[i][0] === flightKey) {
        flightLog.getRange(i + 1, 18).setValue(pilotName);
        e.range.clearContent();
        break;
      }
    }
  }
}
