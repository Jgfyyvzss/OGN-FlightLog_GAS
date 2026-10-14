//X_Validation.gs
const X_Validation = (() => {

  function validateFlights(flights) {
    const ignorePilot = getConfigValue('IGNORE_PILOT', false) || IGNORE_PILOT_DEFAULT;

    flights.forEach(f => {
      if (!f.key) throw new Error('Missing FlightKey');
      if (!f.date) throw new Error(`Missing Date for ${f.key}`);

      if (!f.glider) {
        // Orphan tug record - no glider is ever expected here (see DataWriter
        // SCHEMA / orphan tug design). Only a genuine problem if billing data
        // has somehow landed directly on it - a real (non-ignore-placeholder)
        // pilot name means something's wrong.
        if (f.pilot && f.pilot !== ignorePilot) {
          throw new Error(`Pilot set on gliderless flight ${f.key}`);
        }
        return;
      }

      if (!f.pilot) {
        X_Audit.log(
          'WARNING',
          'validation',
          '',
          { notes: `Missing Pilot - flight skipped: ${f.key}` }
        );
      }
      if (f.flightTime <= 0) {
        X_Audit.log(
          'WARNING',
          'validation',
          '',
          { notes: `FlightTime is zero — will bill at MIN_BILLABLE_MINUTES: ${f.key}` }
        );
      }
      if (isNaN(f.maxAlt)) throw new Error(`Invalid MaxAlt for ${f.key}`);
    });
  }

  function validateConfig() {
    const mode = Config.get('TOW_BILLING');
    if (![TOW_BILLING_MODE.ALT, TOW_BILLING_MODE.TIME].includes(mode)) {
      throw new Error('Invalid TOW_BILLING');
    }
    Config.getNumber('MIN_ALT');
  }

  return {
    validateFlights,
    validateConfig
  };

})();
