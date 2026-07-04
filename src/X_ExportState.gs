//X_ExportState.gs
const X_ExportState = (() => {
  
 function exportedKeys(exportId) {
 return new Set(
   Sheets.getTabAsObjects('ExportState')
   .filter(r => r.ExportID === exportId)
   .map(r => r.RecordID)
    );
    } 
    
  function markExported(exportId, batchId, flightKeys) {
   flightKeys.forEach(k => {
   Sheets.appendRow('ExportState', [
     k,
    exportId,
    new Date(),
    batchId
     ]);
    });
    } 
    
    return {
     exportedKeys,
     markExported
     };
  })();
