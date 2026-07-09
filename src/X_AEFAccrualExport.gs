// X_AEFAccrualExport.gs
//
// Generates a Manager.io Journal Entry import (TSV) recording the accrued
// cost of AEF aerotows provided by an external tow operator.
//
// Flight day (this export): Debit Aerotow Expense per glider Division,
// Credit Accrued Aerotow (liability) for the total. No cash moves yet.
//
// Weeks later, when the tow operator's invoice is paid: handled entirely
// in Manager via bank import + a rule categorising the payment to
// Accrued Aerotow, clearing the liability. Nothing further to do here.
//
// Only relevant when AEF_AEROTOW_MODE = EXTERNAL. Tracked independently of
// the Manager invoice export via its own X_ExportState EXPORT_ID, so it
// can be run on its own schedule.

const AEF_ACCRUAL_EXPORT_ID = 'aef_accrual_journal';

function runAEFAccrualExport() {
  Costs.assertConfigured([
    'TOW_RATE_TIME',
    'TOW_RATE_ALT',
    'AEF_AEROTOW_MODE',
    'AEROTOW_EXPENSE_ACCOUNT',
    'ACCRUED_AEROTOW_ACCOUNT'
  ]);

  if (Costs.aefAerotowMode() !== AEROTOW_MODE.EXTERNAL) {
    throw new Error('AEF_AEROTOW_MODE is not EXTERNAL - no aerotow accrual to export.');
  }

  const batchId = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd-HHmmss'
  );

  X_Audit.log('EXPORT_START', AEF_ACCRUAL_EXPORT_ID, batchId);

  const flights = Flights.load();
  const exported = X_ExportState.exportedKeys(AEF_ACCRUAL_EXPORT_ID);

  const eligible = flights.filter(f =>
    !exported.has(f.key) &&
    f.payer === PAYER.AEF &&
    f.towPlane
  );

  if (eligible.length === 0) {
    throw new Error('No eligible AEF aerotow flights to export.');
  }

  const towBilling = Config.get('TOW_BILLING');
  const towRate = towBilling === TOW_BILLING_MODE.ALT ? Costs.towRateAlt() : Costs.towRateTime();

  // Sum accrued cost per glider Division
  const byDivision = new Map();
  let total = 0;

  eligible.forEach(f => {
    const towQty = towBilling === TOW_BILLING_MODE.ALT ? (f.towAlt || 0) : (f.planeTime || 0);
    const amount = towQty * towRate;
    if (amount <= 0) return;

    const division = Invoicing.gliderInfo(f.glider).division || 'UNASSIGNED';
    byDivision.set(division, (byDivision.get(division) || 0) + amount);
    total += amount;
  });

  if (total <= 0) {
    throw new Error('No AEF aerotow costs to accrue (all amounts zero).');
  }

  const tsv = buildAccrualJournalTsv(byDivision, total, batchId);

  DriveApp.createFile(
    Utilities.newBlob(tsv, 'text/csv', `AEFAccrualJournal_${batchId}.csv`)
  );

  X_ExportState.markExported(
    AEF_ACCRUAL_EXPORT_ID,
    batchId,
    eligible.map(f => f.key)
  );

  X_Audit.log('EXPORT_SUCCESS', AEF_ACCRUAL_EXPORT_ID, batchId, {
    flightCount: eligible.length,
    notes: `Accrued $${total.toFixed(2)} across ${byDivision.size} division(s)`
  });
}

/**
 * Build a single-transaction Journal Entry TSV for Manager.io:
 * one Debit line (Aerotow Expense) per Division, plus one aggregate
 * Credit line (Accrued Aerotow) for the total.
 */
function buildAccrualJournalTsv(byDivision, total, batchId) {
  const issueDate = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const expenseAccount = Costs.aerotowExpenseAccount();
  const liabilityAccount = Costs.accruedAerotowAccount();

  const divisions = Array.from(byDivision.keys());
  const maxLines = divisions.length + 1; // + 1 for the credit line

  const header = ['Date', 'Reference', 'Narration', 'HasLineDescription'];
  for (let i = 1; i <= maxLines; i++) {
    header.push(
      `Lines.${i}.Account`,
      `Lines.${i}.LineDescription`,
      `Lines.${i}.Debit`,
      `Lines.${i}.Credit`,
      `Lines.${i}.Division`
    );
  }

  const row = [
    issueDate,
    `AEF-ACCR-${batchId}`,
    `AEF aerotow accrual - ${batchId}`,
    'True'
  ];

  divisions.forEach(division => {
    const amount = byDivision.get(division);
    row.push(
      expenseAccount,
      `AEF aerotow accrual - ${division}`,
      amount.toFixed(2),
      '',
      division === 'UNASSIGNED' ? '' : division
    );
  });

  // Aggregate credit to the liability account
  row.push(
    liabilityAccount,
    'AEF aerotow accrual - total',
    '',
    total.toFixed(2),
    ''
  );

  const rows = [header, row];

  return rows.map(r =>
    r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join('\t')
  ).join('\n');
}

// Register export in menu
X_ExportRegistry.register({
  name: 'Export AEF Aerotow Accrual (Journal)',
  run: runAEFAccrualExport
});
