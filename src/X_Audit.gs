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
