/**
 * Constants.gs - Shared string constants
 *
 * Centralises values that are checked or written in more than one file,
 * so a rename or typo can't cause silent drift between them. Values used
 * in only one file are left local to that file (SGGC_EXPORT_ID etc.) -
 * no need to centralise something that isn't duplicated.
 *
 * No file in this project has a top-level (load-time) dependency on these
 * constants - they're only referenced inside function bodies, which run
 * after every file has finished loading. So, unlike X_ExportRegistry.gs,
 * this file does NOT need a filePushOrder entry in the deploy workflow.
 */

// Flight log sheet name - was previously a Config.SHEET_NAME value read
// per-club; now hardcoded here, consistent with how People/MissingPilots/
// Config/Costs sheet names are already handled (no per-club variation).
const FLIGHT_LOG_SHEET_NAME = 'FlightLog';

// "Special Billing" (Payer field) values.
const PAYER = {
  AEF:         'AEF',
  SHARED:      'Shared',
  NO_BILL:     'No Charge',
  SELF_LAUNCH: 'Self Launch'
};

// Manager.io invoice export ID - referenced by X_ManagerExport.gs itself,
// WebApp.gs (webapp entry point), and the two credit exports (which gate
// on "has this flight already been invoiced via Manager?").
const MANAGER_EXPORT_ID = 'manager_csv';

// Default placeholder pilot name used to mark a flight as permanently
// excluded from invoice exports (Config.IGNORE_PILOT overrides this).
const IGNORE_PILOT_DEFAULT = 'Z_IGNORE';

// Config.AEF_AEROTOW_MODE values.
const AEROTOW_MODE = {
  EXTERNAL: 'EXTERNAL',
  INHOUSE:  'INHOUSE'
};

// Config.TOW_BILLING values.
const TOW_BILLING_MODE = {
  ALT:  'ALT',
  TIME: 'TIME'
};

// Config.CREDIT_GATE value that disables the "already invoiced" gate
// on the tow/winch and instructor credit exports.
const CREDIT_GATE_OFF = 'OFF';
