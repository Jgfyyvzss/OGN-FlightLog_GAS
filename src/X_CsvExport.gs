/**
 * X_CsvExport.gs - Billing CSV Export
 *
 * Produces a flat CSV with one row per billing line item.
 * Useful for internal review and reconciliation.
 *
 * Output columns:
 *   BatchID, Pilot, FlightKey, FlightDate, Glider, LaunchType,
 *   BillingStatus, LineType, Quantity, Amount, Notes
 */

// ── Export definition ─────────────────────────────────────────────────────────

const _BillingCsvDef = {

  id: 'billing_csv',

  menuName: 'Export Billing (CSV)',

  requiredCosts: ['WINCH_FEE', 'TOW_RATE_TIME', 'TOW_RATE_ALT'],

  buildOutput(eligible, { batchId }) {
    const rows = [_billingCsvHeader()];

    eligible.forEach(f => {
      const launchType    = Billing.classifyLaunch(f);
      const billingStatus = f.maxAlt < Config.getNumber('MIN_ALT') ? 'ZERO' : 'NORMAL';
      const lines         = Billing.billFlight(f);

      lines.forEach(line => {
        rows.push([
          batchId,
          f.pilot,
          f.key,
          f.date,
          f.glider,
          launchType,
          billingStatus,
          line.type,
          _deriveQuantity(line, f),
          line.amount,
          _buildLineNote(line, f, billingStatus)
        ]);
      });
    });

    return {
      content:  X_ExportBase.rowsToCsv(rows),
      mimeType: 'text/csv',
      filename: `BillingExport_${batchId}.csv`
    };
  }

};

// ── Entry point ───────────────────────────────────────────────────────────────

function runBillingCsvExport() {
  X_ExportBase.run(_BillingCsvDef);
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _billingCsvHeader() {
  return [
    'BatchID', 'Pilot', 'FlightKey', 'FlightDate', 'Glider',
    'LaunchType', 'BillingStatus', 'LineType', 'Quantity', 'Amount', 'Notes'
  ];
}

function _deriveQuantity(line, f) {
  switch (line.type) {
    case 'GLIDER_TIME':   return f.flightTime;
    case 'AERO_TOW':      return Config.get('TOW_BILLING') === 'ALT' ? f.towAlt : f.planeTime;
    case 'WINCH_LAUNCH':  return 1;
    default:              return '';
  }
}

function _buildLineNote(line, f, billingStatus) {
  let note = `${line.type} – ${f.glider}`;
  if (billingStatus === 'ZERO') note += ' (Aborted launch)';
  return note;
}

// ── Register in menu ──────────────────────────────────────────────────────────

X_ExportRegistry.register({
  name: _BillingCsvDef.menuName,
  run:  runBillingCsvExport
});
