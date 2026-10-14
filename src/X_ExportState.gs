//X_ExportState.gs
const X_ExportState = (() => {

 function exportedKeys(exportId) {
 return new Set(
   Sheets.getTabAsObjects('ExportState')
   .filter(r => r.ExportID === exportId)
   .map(r => r.RecordID)
    );
    }

  /**
   * Like exportedKeys(), but preserves the Timestamp column so callers can
   * reason about WHEN a record was exported, not just whether it was.
   *
   * Used by X_GAusMembershipExport.gs to spot a customer whose GAus
   * membership was already purchased inside the 30-day validity window.
   *
   * Returns: [{ key, timestamp }] - timestamp is a Date, or null if the
   * cell is blank/unparseable.
   */
  function exportedRecords(exportId) {
    return Sheets.getTabAsObjects('ExportState')
      .filter(r => r.ExportID === exportId)
      .map(r => {
        const t = r.Timestamp instanceof Date
          ? r.Timestamp
          : (r.Timestamp ? new Date(r.Timestamp) : null);
        return {
          key: r.RecordID,
          timestamp: (t && !isNaN(t.getTime())) ? t : null
        };
      });
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
     exportedRecords,
     markExported
     };
  })();
