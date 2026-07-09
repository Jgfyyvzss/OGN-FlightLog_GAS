/**
 * Flights.gs - Normalised Flight Loader
 *
 * Loads rows from the FlightLog sheet and converts them to the normalised
 * shape expected by Billing, Validation, and all export scripts.
 *
 * The normalised shape uses `norm` property names from SCHEMA, so adding a
 * column to SCHEMA automatically makes it available here with no code change.
 *
 * Normalised shape reference (for export authors):
 *   key          {string}  FlightKey
 *   date         {string}  yyyy-mm-dd
 *   glider       {string}  Aircraft registration
 *   cn           {string}  Competition number
 *   type         {string}  Aircraft type description
 *   takeOff      {string}  HHhMM
 *   gLanding     {string}  HHhMM
 *   flightTime   {number}  Minutes
 *   maxAlt       {number}  Metres (ASL from API)
 *   maxHeight    {number}  Metres AGL
 *   towPlane     {string}  Tug registration
 *   towType      {string}  Tug type description
 *   towAlt       {number}  Tug max altitude
 *   pLanding     {string}  Tug landing time HHhMM
 *   planeTime    {number}  Tug flight duration minutes
 *   visitor      {boolean} true if pilot is a visitor
 *   pilot        {string}
 *   paxVisitor   {boolean} true if pax is a visitor
 *   pax          {string}
 *   payer        {string}  AEF | Shared | No Bill
 *   towPilot     {string}
 *   selfLaunch   {boolean} derived: true when no towPlane and maxAlt > 0
 *                          (kept for Billing compatibility)
 */

const Flights = (() => {

  function load() {
    return Sheets.getTabAsObjects(FLIGHT_LOG_SHEET_NAME).map(normalise);
  }

  function normalise(r) {
    return {
      key:        r.FlightKey,
      date:       r.Date,
      pilot:      r.Pilot,
      glider:     r.Glider,
      flightTime: parseDuration(r.FlightTime),
      maxAlt:     Number(r.MaxAlt) || 0,
      maxHeight:  Number(r.MaxHeight) || 0,    // metres AGL — used for Tow Height in SGGC export
      towPlane:   r.TowPlane,
      towAlt:     Number(r.TowMaxAlt) || 0,
      planeTime:  parseDuration(r.PlaneTime),
      pLanding:   r.PlaneLanding || '',         // tug/plane landing time — used in SGGC export
      gLanding:   r.Landing || '',              // glider landing time
      takeOff:    r.TakeOff || '',
      selfLaunch: r.SelfLaunch === true || r.SelfLaunch === 'Y',
      pax:        r.Pax,
      payer:      r.Payer,
      type:       r.Type,
      towType:    r.TowType,
      towPilot:   r.TowPilot || '',             // covers both tug pilot and winch driver
      visitor:    r.Visitor    === 'Y',
      paxVisitor: r.PaxVisitor === 'Y',
      remarks:    r.Remarks || ''
    };
  }

  function parseDuration(hhmm) {
    if (!hhmm) return 0;
    const str = hhmm.toString();
    const sep = str.includes('h') ? 'h' : ':';
    const parts = str.split(sep);
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return (h * 60) + m;
  }

  return { load };

})();
