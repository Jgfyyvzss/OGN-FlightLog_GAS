/**
 * X_CsvExport.gs - Billing CSV Export
 *
 * Produces a flat CSV with one row per billing line item, per raw flight
 * (not grouped/split by customer - useful for physical flight-by-flight
 * reconciliation). Uses the same Invoicing.buildFlightLines() logic as the
 * Manager and Reckon exports, so figures always match.
 *
 * Output columns:
 *   BatchID, Pilot, FlightKey, FlightDate, Glider, Payer,
 *   LineItem, LineDescription, Qty, UnitPrice, Amount, Division
 */

const _BillingCsvDef = {

  id: 'billing_csv',

  menuName: 'Export Billing (CSV)',

  requiredCosts: ['WINCH_FEE', 'WINCH_FEE_VISITOR', 'TOW_RATE_TIME', 'TOW_RATE_ALT', 'AEF_AEROTOW_MODE'],

  buildOutput(eligible, { batchId }) {
    const rows = [_billingCsvHeader()];
    const aerotowMode = Costs.aefAerotowMode();

    eligible.forEach(f => {
      const isAEF = f.payer === 'AEF';
      const lines = Invoicing.buildFlightLines(f, 1.0, { isAEF, aerotowMode });

      lines.forEach(line => {
        const amount = (Number(line.qty) * Number(line.unitPrice)).toFixed(2);
        rows.push([
          batchId,
          f.pilot,
          f.key,
          f.date,
          f.glider,
          f.payer || '',
          line.item,
          line.description,
          line.qty,
          line.unitPrice,
          amount,
          line.division
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

function runBillingCsvExport() {
  X_ExportBase.run(_BillingCsvDef);
}

function _billingCsvHeader() {
  return [
    'BatchID', 'Pilot', 'FlightKey', 'FlightDate', 'Glider', 'Payer',
    'LineItem', 'LineDescription', 'Qty', 'UnitPrice', 'Amount', 'Division'
  ];
}

X_ExportRegistry.register({
  name: _BillingCsvDef.menuName,
  run:  runBillingCsvExport
});
