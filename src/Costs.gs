// Costs.gs

const Costs = (() => {
  let cache;

  function load() {
    if (cache) return cache;
    cache = {};
    Sheets.getTabAsObjects('Costs').forEach(r => {
      cache[r.Key] = r.Value;
    });
    return cache;
  }

  function get(key) {
    const v = load()[key];
    if (v == null || v === '') {
      throw new Error(`${key} not configured in Costs`);
    }
    return Number(v);
  }

  /**
   * Like get(), but returns a string rather than coercing to Number.
   * For account names, item codes, mode flags, etc.
   */
  function getString(key) {
    const v = load()[key];
    if (v == null || v === '') {
      throw new Error(`${key} not configured in Costs`);
    }
    return String(v);
  }

  function assertConfigured(keys) {
    const data = load();
    keys.forEach(k => {
      if (data[k] == null || data[k] === '') {
        throw new Error(`Missing cost configuration: ${k}`);
      }
    });
  }

  function gliderRate(glider) {
    const key = `GLIDER_${glider}`;
    const rate = load()[key];
    if (rate == null || rate === '') {
      return 0.00;  // Private glider - no charge
    }
    return Number(rate);
  }

  function winchFee()         { return get('WINCH_FEE'); }
  function winchFeeVisitor()  { return get('WINCH_FEE_VISITOR'); }
  function towRateTime()      { return get('TOW_RATE_TIME'); }
  function towRateAlt()       { return get('TOW_RATE_ALT'); }
  function dueDateDays()      { return get('DUE_DATE_DAYS'); }

  /**
   * EXTERNAL: club is billed by an external operator for AEF aerotows -
   *           AEF flights get a real AT line (qty only, price $0) and
   *           feed the AEF accrual journal export.
   * INHOUSE:  club provides tows itself - AEF aerotows are folded into
   *           a WL-style line instead (see Invoicing.buildFlightLines),
   *           and no accrual journal entry is generated.
   */
  function aefAerotowMode() {
    const mode = getString('AEF_AEROTOW_MODE');
    if (!['EXTERNAL', 'INHOUSE'].includes(mode)) {
      throw new Error("AEF_AEROTOW_MODE must be 'EXTERNAL' or 'INHOUSE'");
    }
    return mode;
  }

  // Accounts for the AEF aerotow accrual journal (X_AEFAccrualExport.gs)
  function aerotowExpenseAccount()  { return getString('AEROTOW_EXPENSE_ACCOUNT'); }
  function accruedAerotowAccount()  { return getString('ACCRUED_AEROTOW_ACCOUNT'); }

  // Account placeholders - for the future Reckon IIF export
  function arAccount()       { return getString('AR_ACCOUNT'); }
  function incomeAccount()   { return getString('INCOME_ACCOUNT'); }

  return {
    load,
    get,
    getString,
    gliderRate,
    winchFee,
    winchFeeVisitor,
    towRateTime,
    towRateAlt,
    dueDateDays,
    aefAerotowMode,
    aerotowExpenseAccount,
    accruedAerotowAccount,
    arAccount,
    incomeAccount,
    assertConfigured
  };
})();
