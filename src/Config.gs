/**
 * Config.gs - Configuration Management
 * Reads configuration from Config sheet
 * Shared by all modules
 */

const Config = (() => {
  let cache = null;

  function load() {
    if (cache) return cache;
    const cfg = {};
    Sheets.getTabAsObjects('Config').forEach(r => {
      if (r.Key) cfg[r.Key] = r.Value;
    });

    // Validate required keys
    const required = ["AIRPORT_CODE", "TIMEZONE", "SHEET_ID"];
    const missing = required.filter(k => !cfg[k]);
    if (missing.length > 0) throw new Error("Missing required config: " + missing.join(", "));

    cache = cfg;
    return cache;
  }

  function get(key) {
    const cfg = load();
    if (!(key in cfg)) throw new Error(`Missing Config key: ${key}`);
    return cfg[key];
  }

  function getNumber(key) {
    const v = Number(get(key));
    if (isNaN(v)) throw new Error(`Config ${key} must be numeric`);
    return v;
  }

  function getAll() {
    return { ...load() };
  }

  function clearCache() {
    cache = null;
  }

  return { get, getNumber, getAll, clearCache };
})();

/**
 * Legacy API for compatibility
 */
function getConfig() {
  return Config.getAll();
}

function getConfigValue(key, required = true) {
  try {
    return Config.get(key);
  } catch (e) {
    if (required) throw e;
    return null;
  }
}

function getTimezoneOffset() {
  const timezone = getConfigValue("TIMEZONE");
  const now = new Date();
  const formatted = Utilities.formatDate(now, timezone, "Z"); // "+11:00"
  const offsetHours = formatted.substring(1, 3);
  return parseInt(offsetHours, 10);
}

/**
 * Validated read of Config.AEF_AEROTOW_MODE.
 *
 * EXTERNAL: club is billed by an external operator for AEF aerotows -
 *           AEF flights get a real AT line (qty only, price $0) and
 *           feed the AEF accrual journal export.
 * INHOUSE:  club provides tows itself - AEF aerotows are folded into
 *           a WL-style line instead (see Invoicing.buildFlightLines),
 *           and no accrual journal entry is generated.
 *
 * A dedicated accessor (rather than a bare Config.get call at each
 * call site) keeps this validation in one place - some callers
 * (X_AEFAccrualExport.gs) don't otherwise run X_Validation.validateConfig()
 * first.
 */
function getAefAerotowMode() {
  const mode = Config.get('AEF_AEROTOW_MODE');
  if (![AEROTOW_MODE.EXTERNAL, AEROTOW_MODE.INHOUSE].includes(mode)) {
    throw new Error(`AEF_AEROTOW_MODE must be '${AEROTOW_MODE.EXTERNAL}' or '${AEROTOW_MODE.INHOUSE}'`);
  }
  return mode;
}