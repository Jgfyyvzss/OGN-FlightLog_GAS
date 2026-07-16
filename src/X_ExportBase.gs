/**
 * X_ExportBase.gs - Shared Export Runner
 *
 * All exports follow the same pipeline:
 *   1. Assert required cost keys are configured
 *   2. Validate config (TOW_BILLING, MIN_ALT)
 *   3. Load and validate flights
 *   4. Filter out already-exported flights (and optionally pilots to ignore)
 *   5. Call the export-specific buildOutput() to produce file content
 *   6. Save to Google Drive
 *   7. Mark flights as exported in ExportState
 *   8. Audit log success
 *   9. Alert operator about any skipped (no-pilot) flights
 *
 * To create a new export, define a plain object (the "export definition")
 * and pass it to X_ExportBase.run().  See X_CsvExport.gs and
 * X_ReckonExport.gs for worked examples.
 *
 * ── Export definition contract ───────────────────────────────────────────────
 *
 *   id            {string}   Unique export identifier, stored in ExportState.
 *
 *   menuName      {string}   Label shown in the Exports menu.
 *
 *   requiredCosts {string[]} Keys that must exist in the Costs sheet.
 *                            Checked before any work is done.
 *
 *   filterEligible(flights, exported)
 *                 {Function} Given all normalised flights and the Set of
 *                            already-exported keys, return the array of
 *                            flights to include in this run.
 *                            Default (if omitted): exclude exported keys AND
 *                            exclude flights without a pilot.
 *                            X_ExportBase.eligibleFlights is available as a
 *                            ready-made alternative that also excludes the
 *                            Config.IGNORE_PILOT placeholder pilot - use this
 *                            for invoice-style exports (Manager, Reckon, ...).
 *
 *   buildOutput(eligible, meta)
 *                 {Function} Receives:
 *                              eligible {Array}  normalised flight objects
 *                              meta     {Object} { batchId, issueDate }
 *                            Must return:
 *                              { content, mimeType, filename }
 *                              content  {string} file content (CSV, TSV, IIF, etc.)
 *                              mimeType {string} e.g. 'text/csv'
 *                              filename {string} e.g. 'MyExport_20260610.csv'
 *
 *   onSuccess(result)
 *                 {Function} Optional. Called after Drive save, before audit.
 *                            result = { eligible, batchId, skipped }
 *                            Use for UI alerts, additional side-effects, etc.
 *                            Default: shows a standard skipped-flights alert
 *                            if any flights were skipped (silently does
 *                            nothing if no UI is available, e.g. webapp).
 *
 * ── run() return value ────────────────────────────────────────────────────────
 *
 *   { eligible, batchId, skipped, output }
 *
 *   output is the same { content, mimeType, filename } returned by
 *   buildOutput() - useful for webapp callers that need to return the
 *   generated content to the client (in addition to the Drive copy
 *   run() already saves).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const X_ExportBase = (() => {

  /**
   * Run a complete export pipeline for the given definition.
   * Returns { eligible, batchId, skipped, output }.
   */
  function run(def) {
    // ── 1. Cost key pre-flight check ─────────────────────────────────────────
    if (def.requiredCosts && def.requiredCosts.length > 0) {
      Costs.assertConfigured(def.requiredCosts);
    }

    // ── 2. Config validation ─────────────────────────────────────────────────
    X_Validation.validateConfig();

    // ── 3. Batch metadata ────────────────────────────────────────────────────
    const tz = Session.getScriptTimeZone();
    const batchId   = Utilities.formatDate(new Date(), tz, 'yyyyMMdd-HHmmss');
    const issueDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    X_Audit.log('EXPORT_START', def.id, batchId);

    // ── 4. Load and validate flights ─────────────────────────────────────────
    const allFlights = Flights.load();
    X_Validation.validateFlights(allFlights);

    // ── 5. Filter eligible ───────────────────────────────────────────────────
    const exported = X_ExportState.exportedKeys(def.id);

    const eligible = def.filterEligible
      ? def.filterEligible(allFlights, exported)
      : eligibleFlights(allFlights, exported);

    if (eligible.length === 0) {
      throw new Error('No eligible flights to export for ' + def.id +
        '. Check ExportState — all flights may already be exported.');
    }

    // ── 6. Build output ──────────────────────────────────────────────────────
    const output = def.buildOutput(eligible, { batchId, issueDate });
    // output must contain: { content, mimeType, filename }

    // ── 7. Save to Drive ─────────────────────────────────────────────────────
    const blob = Utilities.newBlob(output.content, output.mimeType, output.filename);
    getExportFolder().createFile(blob);

    // ── 8. Mark as exported ──────────────────────────────────────────────────
    X_ExportState.markExported(def.id, batchId, eligible.map(f => f.key));

    // ── 9. Audit success ─────────────────────────────────────────────────────
    X_Audit.log('EXPORT_SUCCESS', def.id, batchId, {
      flightCount: eligible.length,
      pilotCount: new Set(eligible.map(f => f.pilot).filter(Boolean)).size
    });

    // ── 10. Post-run callback (UI alerts, etc.) ───────────────────────────────
    const skipped = allFlights.filter(f => !f.pilot && !exported.has(f.key));

    if (def.onSuccess) {
      def.onSuccess({ eligible, batchId, skipped });
    } else {
      _defaultSkippedAlert(skipped);
    }

    return { eligible, batchId, skipped, output };
  }


  // ── Shared helpers available to export definitions ──────────────────────────

  /**
   * Default eligible filter: exclude already-exported keys and flights
   * without a pilot.
   */
  function _defaultFilter(allFlights, exported) {
    return allFlights.filter(f => !exported.has(f.key) && f.pilot);
  }

  /**
   * Shared filter for invoice-style exports (Manager, Reckon, ...):
   * exclude already-exported keys, require a pilot, and exclude the
   * Config.IGNORE_PILOT placeholder pilot (defaults to 'Z_IGNORE').
   * Pass this directly as filterEligible, or call it from a custom
   * filterEligible and apply additional conditions on top.
   */
  function eligibleFlights(allFlights, exported) {
    const ignorePilot = getConfigValue('IGNORE_PILOT', false) || 'Z_IGNORE';
    return allFlights.filter(f =>
      !exported.has(f.key) &&
      f.pilot &&
      f.pilot !== ignorePilot
    );
  }

  /**
   * Default post-run alert when flights were skipped due to missing pilot.
   * Silently does nothing if no UI is available (e.g. called from a
   * webapp request) - callers in that context can use the `skipped`
   * array returned by run() for their own messaging.
   */
  function _defaultSkippedAlert(skipped) {
    if (skipped.length === 0) return;
    try {
      SpreadsheetApp.getUi().alert(
        `Export completed with ${skipped.length} skipped flight(s).\n\n` +
        `Reason: Missing Pilot assignment.\n` +
        `These flights were NOT exported.\n\n` +
        `See AuditLog for details.`
      );
    } catch (e) {
      // No UI in this context - caller can inspect `skipped` instead.
    }
  }

  /**
   * Format a rows array (array of arrays) as CSV.
   * All values are quoted; internal quotes are escaped.
   */
  function rowsToCsv(rows) {
    return rows.map(r =>
      r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
    ).join('\n');
  }

  /**
   * Format a rows array as TSV (tab-separated, same quoting).
   */
  function rowsToTsv(rows) {
    return rows.map(r =>
      r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join('\t')
    ).join('\n');
  }

/**
   * Standard batchId format.  Exposed so export definitions can use it
   * outside of run() if needed.
   */
  function makeBatchId() {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  }

  /**
   * Returns true if Config.CREDIT_GATE is explicitly set to 'OFF' (credit
   * exports then skip the "already invoiced via Manager" check). Defaults
   * to false (gate on) if unset or Config throws.
   */
  function isCreditGateDisabled() {
    try {
      return Config.get('CREDIT_GATE') === CREDIT_GATE_OFF;
    } catch (e) {
      return false;
    }
  }

  return { run, rowsToCsv, rowsToTsv, makeBatchId, eligibleFlights, isCreditGateDisabled };

})();
