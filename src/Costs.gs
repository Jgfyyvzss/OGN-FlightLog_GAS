// Costs.gs
//
// Costs holds ONLY dollar-amount values (rates, fees, credits). Account
// names, mode flags, and day-count settings are Config's job - see
// Config.gs and getAefAerotowMode() there. This split was completed by
// moving AEF_AEROTOW_MODE, DUE_DATE_DAYS, AR_ACCOUNT, INCOME_ACCOUNT,
// AEROTOW_EXPENSE_ACCOUNT, and ACCRUED_AEROTOW_ACCOUNT out of this sheet
// and out of this file.

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
   * For item codes, mode flags, etc. that live in the Costs sheet.
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

  return {
    load,
    get,
    getString,
    gliderRate,
    winchFee,
    winchFeeVisitor,
    towRateTime,
    towRateAlt,
    assertConfigured
  };
})();