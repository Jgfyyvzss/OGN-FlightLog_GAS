
/**
 * Invoicing.gs - Shared invoice-building logic
 * Used by X_ManagerExport.gs and (later) X_ReckonExport.gs
 *
 * Produces a generic invoice structure:
 *   { customer, reference, description, lines: [{item, description, qty, unitPrice, division}] }
 *
 * AEF invoices: lines keep their real qty (record of launches/time
 * consumed) but unitPrice is forced to 0.00 - no money changes hands,
 * since AEF income was recognised at time of voucher sale. Any real
 * external aerotow cost is tracked separately via the AEF accrual
 * journal export (X_AEFAccrualExport.gs), not on this invoice.
 */
const Invoicing = (() => {

  /**
   * Group flights by customer, handling Payer field
   * Returns: Map of customerKey -> {customer, reference, flights, splitRatio, aefFlights?}
   */
  function groupFlightsByCustomer(flights) {
    const groups = new Map();

    flights.forEach(f => {
      const payer = f.payer || 'Pilot';

/* SHARED SPLIT - reinstate when needed
      if (payer === 'Shared') {
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

      } else */ if (payer === 'AEF') {
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

      } else if (payer === 'Passenger') {
        const paxKey = `PAX_${f.pax}`;
        if (!groups.has(paxKey)) {
          groups.set(paxKey, {
            customer: f.pax,
            reference: '',
            flights: [],
            splitRatio: 1.0
          });
        }
        groups.get(paxKey).flights.push(f);

      } else {
        // Default: Pilot pays
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
   * division is the last 3 chars of the cost key (e.g. "GCN"),
   * or empty string for private/visiting gliders.
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

  /**
   * Count how many line items a flight will generate.
   */
  function countFlightLines(flight) {
    let count = 1;
    if (flight.towPlane || flight.towType === 'Winch' || (!flight.towPlane && flight.maxAlt > 0)) {
      count++;
    }
    return count;
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

    const flightMinutes = flight.flightTime || 0;

    const gliderDesc =
      `${flight.date} – ${flight.glider} – ${flight.type} – Flight time`;

    lines.push({
      item: 'FT',
      description: gliderDesc,
      qty: (flightMinutes * splitRatio).toFixed(2),
      unitPrice: gliderRate.toFixed(2),
      division: division
    });

    // AEF + in-house tow provision: no external aerotow cost to track,
    // so treat the launch like a winch launch instead of an AT line.
    const treatAerotowAsWinch =
      context.isAEF && context.aerotowMode === 'INHOUSE' && !!flight.towPlane;

    if (flight.towPlane && !treatAerotowAsWinch) {

      const towBilling = Config.get('TOW_BILLING');

      const towQty =
        towBilling === 'ALT'
          ? (flight.towAlt || 0)
          : (flight.planeTime || 0);

      const towRate =
        towBilling === 'ALT'
          ? Costs.towRateAlt()
          : Costs.towRateTime();

      lines.push({
        item: 'AT',
        description: `${flight.date} – ${flight.glider} – Aerotow`,
        qty: (towQty * splitRatio).toFixed(2),
        unitPrice: towRate.toFixed(2),
        division: division
      });

    } else if (
      treatAerotowAsWinch ||
      flight.towType === 'Winch' ||
      (!flight.towPlane && flight.maxAlt > 0)
    ) {

      lines.push({
        item: 'WL',
        description: `${flight.date} – ${flight.glider} – Winch launch`,
        qty: splitRatio.toFixed(2),
        unitPrice: (flight.visitor ? Costs.winchFeeVisitor() : Costs.winchFee()).toFixed(2),
        division: division
      });
    }

    return lines;
  }

  /**
   * Build generic invoice objects from a list of eligible flights.
   * Returns: [{ customer, reference, description, lines }]
   *
   * AEF invoices: lines keep their real qty (record of launches/time
   * consumed) but unitPrice is forced to 0.00 - no money changes hands,
   * since AEF income was recognised at time of voucher sale. Any real
   * external aerotow cost is tracked separately via the AEF accrual
   * journal export (X_AEFAccrualExport.gs), not on this invoice.
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

      if (isAEF) {
        lines.forEach(l => { l.unitPrice = '0.00'; });
      }

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
    groupFlightsByCustomer,
    gliderInfo,
    countFlightLines,
    buildFlightLines,
    buildInvoices
  };

})();
