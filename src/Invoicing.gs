/**
 * Invoicing.gs - Shared invoice-building logic
 * Used by X_ManagerExport.gs, X_ReckonExport.gs, and X_CsvExport.gs
 *
 * Produces a generic invoice structure:
 *   { customer, reference, description, lines: [{item, description, qty, unitPrice, division}] }
 *
 * Special Billing (Payer field) values:
 *   ''         - default: Pilot pays in full
 *   'AEF'      - pre-paid voucher: qty preserved for record-keeping, price forced to $0
 *   'Shared'   - split 50/50 between Pilot and Pax, only when Config SPLIT_BILLING = 'ON'
 *                (falls through to default "Pilot pays" when off)
 *   'No Bill'  - qty preserved, price forced to $0 (manual override, e.g. cable break,
 *                training/review flight normally billable but waived)
 *
 * AEF and No Bill share one mechanism: payerPriceMultiplier() returns 0 for both,
 * applied uniformly to every line a flight generates. This replaces the old approach
 * of forcing AEF lines to $0.00 after the fact.
 *
 * MIN_BILLABLE_MINUTES (Config): floors the billable glider flight time (and tow
 * plane time, when TOW_BILLING = 'TIME') so a flight logged with zero/near-zero
 * duration still bills a nominal minimum rather than $0. This does not alter the
 * raw FlightTime stored in the sheet - it only affects the billing calculation.
 *
 * Remarks: appended (truncated to 80 chars) to each line's description, so
 * context set by the exporter (e.g. reason for No Bill) is visible on the
 * invoice/CSV line itself.
 */
const Invoicing = (() => {

  /**
   * Price multiplier for a flight, driven by Payer.
   * AEF and No Bill both zero the price while preserving qty.
   * Extension point: future tiered rates (e.g. a partial-rate launch category)
   * would add another entry here.
   */
  function payerPriceMultiplier(payer) {
    if (payer === PAYER.AEF || payer === PAYER.NO_BILL) return 0;
    return 1;
  }

  /**
   * Group flights by customer, handling the Payer field.
   * Returns: Map of customerKey -> {customer, reference, flights, splitRatio, aefFlights?}
   */
  function groupFlightsByCustomer(flights) {
    const groups = new Map();
    const splitBillingOn = (getConfigValue('SPLIT_BILLING', false) || '').toUpperCase() === 'ON';

    flights.forEach(f => {
      const payer = f.payer || 'Pilot';

      if (payer === PAYER.SHARED && splitBillingOn) {
        const pilotKey = `PILOT_${f.pilot}`;
        const paxKey = `PAX_${f.pax}`;

        if (!groups.has(pilotKey)) {
          groups.set(pilotKey, {
            customer: f.pilot,
            reference: '',
            flights: [],
            splitRatio: 0.5
          });
        }
        groups.get(pilotKey).flights.push(f);

        if (!groups.has(paxKey)) {
          groups.set(paxKey, {
            customer: f.pax,
            reference: '',
            flights: [],
            splitRatio: 0.5
          });
        }
        groups.get(paxKey).flights.push(f);

      } else if (payer === PAYER.AEF) {
        const aefKey = `AEF_${f.pilot}`;
        if (!groups.has(aefKey)) {
          groups.set(aefKey, {
            customer: 'AEF',
            reference: f.pilot,
            flights: [],
            splitRatio: 1.0,
            aefFlights: []
          });
        }
        groups.get(aefKey).flights.push(f);
        groups.get(aefKey).aefFlights.push({
          passenger: f.pax,
          date: f.date
        });

      } else {
        // Default: Pilot pays. Covers blank, 'Shared' when split billing is off,
        // 'No Bill' (grouping unaffected - only price is zeroed), and any other value.
        const pilotKey = f.visitor ? `VISITOR_${f.pilot}` : `PILOT_${f.pilot}`;
        if (!groups.has(pilotKey)) {
          groups.set(pilotKey, {
            customer: f.visitor ? 'Visitor' : f.pilot,
            reference: f.visitor ? f.pilot : '',
            flights: [],
            splitRatio: 1.0
          });
        }
        groups.get(pilotKey).flights.push(f);
      }
    });

    return groups;
  }

  /**
   * Returns { isPrivate, division } for a glider.
   */
  function gliderInfo(glider) {
    const key = `GLIDER_${glider}`;
    const rate = Costs.load()[key];
    const isPrivate = (rate == null || rate === '');
    return {
      isPrivate,
      division: isPrivate ? '' : key.slice(-3)
    };
  }

  function countFlightLines(flight) {
    let count = 1;
    if (flight.towPlane || flight.towType === 'Winch' || (!flight.towPlane && flight.maxAlt > 0)) {
      count++;
    }
    return count;
  }

  /** Append truncated remarks to a base line description, if present. */
  function _withRemarks(base, remarks) {
    if (!remarks) return base;
    const trimmed = String(remarks).trim().slice(0, 80);
    return trimmed ? `${base} (${trimmed})` : base;
  }

  /** Floor a duration (minutes) at MIN_BILLABLE_MINUTES, if configured. */
  function _floorMinutes(minutes) {
    const min = Number(getConfigValue('MIN_BILLABLE_MINUTES', false)) || 0;
    return Math.max(minutes || 0, min);
  }

  /**
   * Build line items for a single flight.
   * context: { isAEF, aerotowMode }
   */
  function buildFlightLines(flight, splitRatio, context) {
    context = context || {};
    const lines = [];

    const { isPrivate, division } = gliderInfo(flight.glider);
    const gliderRate = isPrivate ? 0 : Costs.gliderRate(flight.glider);
    const multiplier = payerPriceMultiplier(flight.payer);

    const flightMinutes = _floorMinutes(flight.flightTime);

    lines.push({
      item: 'FT',
      description: _withRemarks(
        `${flight.date} – ${flight.glider} – ${flight.type} – Flight time`,
        flight.remarks
      ),
      qty: (flightMinutes * splitRatio).toFixed(2),
      unitPrice: (gliderRate * multiplier).toFixed(2),
      division: division
    });

    // AEF + in-house tow provision: no external aerotow cost to track,
    // so treat the launch like a winch launch instead of an AT line.
    const treatAerotowAsWinch =
      context.isAEF && context.aerotowMode === AEROTOW_MODE.INHOUSE && !!flight.towPlane;

    if (flight.towPlane && !treatAerotowAsWinch) {

      const towBilling = Config.get('TOW_BILLING');

      const towQty =
        towBilling === TOW_BILLING_MODE.ALT
          ? (flight.towAlt || 0)
          : _floorMinutes(flight.planeTime);

      const towRate =
        towBilling === TOW_BILLING_MODE.ALT
          ? Costs.towRateAlt()
          : Costs.towRateTime();

      lines.push({
        item: 'AT',
        description: _withRemarks(`${flight.date} – ${flight.glider} – Aerotow`, flight.remarks),
        qty: (towQty * splitRatio).toFixed(2),
        unitPrice: (towRate * multiplier).toFixed(2),
        division: division
      });

    } else if (
      treatAerotowAsWinch ||
      flight.towType === 'Winch' ||
      (!flight.towPlane && flight.maxAlt > 0)
    ) {

      const winchRate = flight.visitor ? Costs.winchFeeVisitor() : Costs.winchFee();

      lines.push({
        item: 'WL',
        description: _withRemarks(`${flight.date} – ${flight.glider} – Winch launch`, flight.remarks),
        qty: splitRatio.toFixed(2),
        unitPrice: (winchRate * multiplier).toFixed(2),
        division: division
      });
    }

    return lines;
  }

  /**
   * Build generic invoice objects from a list of eligible flights.
   * Returns: [{ customer, reference, description, lines }]
   */
  function buildInvoices(flights) {
    const groups = groupFlightsByCustomer(flights);
    const aerotowMode = Costs.aefAerotowMode();

    const invoices = [];

    groups.forEach(group => {
      let description = 'Flight charges';
      if (group.aefFlights && group.aefFlights.length > 0) {
        const passengers = group.aefFlights.map(a => a.passenger).join(', ');
        description += ` - AEF: ${passengers}`;
      }

      const isAEF = group.customer === 'AEF';
      const context = { isAEF, aerotowMode };

      const lines = [];
      group.flights.forEach(f => {
        lines.push(...buildFlightLines(f, group.splitRatio, context));
      });

      invoices.push({
        customer: group.customer,
        reference: group.reference,
        description: description,
        lines: lines
      });
    });

    return invoices;
  }

  return {
    payerPriceMultiplier,
    groupFlightsByCustomer,
    gliderInfo,
    countFlightLines,
    buildFlightLines,
    buildInvoices
  };

})();
