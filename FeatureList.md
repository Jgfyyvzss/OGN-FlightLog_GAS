# OGN-FlightLog_GAS — Feature List

## 1. Flight Data Ingestion
- **Primary source**: FlightBook API (flightbook.glidernet.org) — structured JSON per airport/date.
- **Fallback source**: HTML scraper (logbook.glidernet.org) — used automatically if the API fails or returns no flights (`smartFetchFlights`).
- Glider flights auto-paired with their tow plane when OGN successfully cross-references them.
- **Orphan tug detection** — tow flights OGN couldn't link to a glider are written as standalone tug rows (empty glider columns).
- **Unconfigured FLARM handling** — devices with no registration get a `~XXXXXX` identifier (last 6 chars of device address) so they still appear and can be manually fixed.
- Self-launch gliders, motorgliders, and other aircraft types are distinguished from tugs via `aircraft_type` + registration checks.
- Manual "Fetch Today's Flights" menu item; scheduled/triggerable via `fetchTodayFlights()`.

## 2. Pilot Entry Webapp (FlightLogForm.html)
- Mobile-friendly single-page form served at the deployment URL.
- Flight list with status badges: Needs Pilot / Flying / Logged.
- Select a flight → enter Pilot, Pax/Instructor, Winch Driver, Special Billing, Remarks.
- **Visitor toggle** on every people field — switch between club dropdown and free-text visitor name.
- **➕ Add Glider Flight** — manually log a flight not picked up by OGN, with optional attach-to-existing-orphan-tug.
- **🛩️ Add Tug Flight** — manually log a tow-only flight.
- **Edit Selected Flight** — correct any field on an already-logged flight, including tug pilot / winch driver.
- **✈️ Edit Tugs** — bulk view/fix tug pilot assignments across all of today's tug flights.
- **🔄 Refresh Flights** — re-pulls from OGN without leaving the page.
- Club branding (title, page heading) pulled dynamically from `Config.CLUB_ABBREVIATION`.

## 3. Special Billing System
- Unified **Special Billing** dropdown with options: blank, AEF, Shared, No Charge, Self Launch.
-**Blank** _ default. Invoices to Pilot
- **AEF** — qty preserved for records, price forced to $0; feeds AEF accrual journal when club uses an external tow operator.
- **Shared** — splits the flight 50/50 between Pilot and Pax as separate invoice lines (only active when `SPLIT_BILLING = ON`).
- **No Charge** — human override to zero-price a flight (cable break, waived training flight, etc.) while still logging it normally.
- **Self Launch** — suppresses the launch/tow billing line; flight-time billing still applies.
- **Ignored pilot** placeholder (`Z_IGNORE` by default, configurable) — permanently excludes a flight from all invoice exports (test flights, etc.).

## 4. Billing / Invoicing Engine (shared logic)
- Single `Invoicing.buildFlightLines()` used identically by Manager, Reckon, and CSV exports — figures always match across formats.
- Per-glider rates (private gliders bill $0 automatically).
- Aerotow billing by **time** or **altitude** (`TOW_BILLING` config toggle).
- Winch billing with separate member/visitor rates.
- `AEF_AEROTOW_MODE` (EXTERNAL vs INHOUSE) changes whether an AEF aerotow generates a real AT line + accrual entry, or is folded into a winch-style line.
- `MIN_BILLABLE_MINUTES` floors near-zero-duration flights to a nominal billable minimum without altering the raw logged time.
- Remarks (truncated to 80 chars) appended to each invoice line description for context.
- Customer grouping by Pilot, Visitor, AEF, or split Pilot/Pax (Shared).

## 5. Accounting Exports
All exports are password-gated web pages or menu items, track their own "already exported" state independently, and never duplicate a flight across runs.
- **Manager.io Invoice Export (CSV)** — batch invoice import format; also available from the webapp Accounting Exports page (paste-to-clipboard).
- **Reckon/QuickBooks Export (IIF)** — tab-delimited journal/invoice import, using the same invoice grouping logic as Manager.
- **Generic Billing CSV Export** — one row per line item per raw flight, for flight-by-flight reconciliation.
- **AEF Aerotow Accrual Journal** — debit/credit journal entry (Expense vs Accrued liability) for AEF flights towed by an external operator; only relevant in EXTERNAL mode.
- **Tow Pilot / Winch Driver Credit Notes** — one credit note per operator, split by AT (aerotow) vs WL (winch) operation counts.
- **Instructor Credit Notes** — one credit note per instructor, counting eligible dual/instructional flights.
- **SGGC Flight Log Export (TSV)** — club-specific format with derived flight-type codes (AEF/Guest/Passenger-Guest/Instructional/Solo), PIC/2nd-pilot derivation, and tow height conversion (metres → feet, rounded to 100ft).
- Credit exports are gated on the flight already being invoiced via Manager (**credit gate**), unless `CREDIT_GATE = OFF`.
- `ACCOUNTING_SYSTEM` config key (unset/MANAGER/RECKON) controls which invoice export sections are shown on the exports page.
- Every export writes a backup copy to Google Drive in addition to any on-screen/download output.

## 6. Data Model & Configuration
- **SCHEMA-driven FlightLog sheet** — single source of truth for all columns; adding a field requires one schema entry, propagates to writer/reader/normaliser automatically.
- **Preserve columns** — pilot-entered fields (Remarks, Visitor, Pilot, Pax, Payer, TowPilot, etc.) are never overwritten by automated re-fetches.
- **SheetCache** — batches sheet reads/writes per execution to minimise Apps Script overhead.
- **Config sheet** — non-dollar settings (account codes, item codes, mode flags, day counts, airport code, timezone, etc.), validated on load.
- **Costs sheet** — dollar-amount rates only (winch fee, tow rates, credit rates, glider-specific rates); firm architectural separation from Config.
- **People sheet** — single consolidated list (Pilot / Instructor / WinchDriver / TugPilot) replacing separate legacy lists.
- Club-to-club differences handled entirely via Config boolean/string flags — no code forks between clubs.

## 7. Validation & Data Integrity
- Pre-export validation of required Config keys and Costs keys, with clear errors before any file is generated.
- Per-flight validation (FlightKey, Date, Glider presence; zero-duration flight time flagged, not blocked).
- Audit logging (`AuditLog` sheet) for every export start/success/error, including flight and pilot counts.
- Missing-pilot flights are tracked and reported (not silently dropped) at export time, with a dedicated `MissingPilots` review sheet and dropdown validation tied to the People list.

## 8. Admin & Operational Tools
- **Script Backup** — on-demand export of the entire Apps Script project (all files) to a Google Doc or a browsable/copyable web page.
- **UserGuide sheet auto-linking** — writes live URLs for Flight Log, Accounting Exports, and Script Backup into a UserGuide sheet via a menu action.
- **Custom spreadsheet menu** ("Flight Log") — fetch flights, test data sources, and run any registered export, built dynamically from `X_ExportRegistry`.
- **onEdit triggers** — auto-refresh the MissingPilots dropdown when the People list changes; writing a pilot name into MissingPilots pushes it straight back into the FlightLog row.

## 9. Deployment & Development Workflow
- Google Apps Script (clasp-based), one bound project per club (ASMB, MBGC).
- GitHub mono-repo as source of truth; `workflow_dispatch` GitHub Actions deploy with a club-target dropdown and push/deploy toggle.
- `filePushOrder` entry required for `X_ExportRegistry.gs` due to a top-level cross-file load-order dependency.
- Developed primarily via github.dev — no local IDE dependency.
