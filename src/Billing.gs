const Billing = (() => {

  function classifyLaunch(f) {
    if (f.selfLaunch) return 'SELF';
    if (f.towPlane) return 'AERO';
    return 'WINCH';
  }

  function billingStatus(f) {
    return f.maxAlt < Config.getNumber('MIN_ALT') ? 'ZERO' : 'NORMAL';
  }

  function billFlight(f) {
    const launch = classifyLaunch(f);
    const status = billingStatus(f);
    const lines = [];

    const gliderAmount =
      status === 'ZERO'
        ? 0
        : f.flightTime * Costs.gliderRate(f.glider);

    lines.push({
      type: 'GLIDER_TIME',
      amount: gliderAmount,
      meta: f
    });

    if (launch === 'AERO') {
      let towAmount = 0;
      if (status === 'NORMAL') {
        towAmount =
          Config.get('TOW_BILLING') === 'ALT'
            ? f.towAlt * Costs.towRateAlt()
            : f.planeTime * Costs.towRateTime();
      }
      lines.push({ type: 'AERO_TOW', amount: towAmount, meta: f });
    }

    if (launch === 'WINCH') {
      const winchAmount =
        status === 'ZERO' ? 0 : Costs.winchFee(f.glider);
      lines.push({ type: 'WINCH_LAUNCH', amount: winchAmount, meta: f });
    }

    return lines;
  }

  return { billFlight };

})();
