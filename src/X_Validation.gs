//X_Validation.gs
const X_Validation = (() => {

  function validateFlights(flights) {
    flights.forEach(f => {
      if (!f.key) throw new Error('Missing FlightKey');
      if (!f.date) throw new Error(`Missing Date for ${f.key}`);
      if (!f.pilot) {
  X_Audit.log(
    'WARNING',
    'validation',
    '',
    { notes: `Missing Pilot - flight skipped: ${f.key}` }
  );
}
      if (!f.glider) throw new Error(`Missing Glider for ${f.key}`);
      if (f.flightTime <= 0) throw new Error(`Invalid FlightTime for ${f.key}`);
      if (isNaN(f.maxAlt)) throw new Error(`Invalid MaxAlt for ${f.key}`);
    });
  }

  function validateConfig() {
    const mode = Config.get('TOW_BILLING');
    if (!['ALT', 'TIME'].includes(mode)) {
      throw new Error('Invalid TOW_BILLING');
    }
    Config.getNumber('MIN_ALT');
  }

  return {
    validateFlights,
    validateConfig
  };

})();
