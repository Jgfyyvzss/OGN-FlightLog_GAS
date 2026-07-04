const Sheets = (() => {

  function getSheet(name) {
    const sh = SpreadsheetApp.getActive().getSheetByName(name);
    if (!sh) throw new Error(`Missing sheet: ${name}`);
    return sh;
  }

  function getTabAsObjects(name) {
    const sh = getSheet(name);
    const values = sh.getDataRange().getValues();
    const headers = values.shift();
    return values
      .filter(r => r.some(v => v !== '' && v !== null))
      .map(row => {
        const obj = {};
        headers.forEach((h, i) => obj[h] = row[i]);
        return obj;
      });
  }

  function appendRow(name, row) {
    getSheet(name).appendRow(row);
  }

  return {
    getSheet,
    getTabAsObjects,
    appendRow
  };

})();
