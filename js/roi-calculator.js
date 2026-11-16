/**
 * Shared ROI engine for Rx Billing Genie + Rx MedMatch.
 *
 * Used by both the standalone /roi page and the homepage calculator so the two
 * can never disagree. Pure functions: no DOM, no side effects.
 *
 * Model (mirrors the agreed "how is the estimate calculated" definitions):
 *   time lost            = monthly rejections x minutes per rejection / 60
 *   staff time cost      = time lost x hourly staff cost
 *   recoverable staff $  = staff time cost x assumed time recovery %
 *   recoverable meds $   = annual purchase-cost value at risk x recoverable share %
 *   combined net value   = recoverable staff + recoverable meds - transfer costs - subscription
 *
 * Daily frequency uses operating days per month; weekly uses 52/12. Annual
 * values are 12x monthly. An annual subscription is spread over 12 months for
 * comparison. The subscription is deducted once.
 */
(function (root) {
  "use strict";

  var PLANS = {
    standard_monthly: { label: "Standard team · $49.99/month", price: 49.99, cadence: "monthly" },
    standard_annual:  { label: "Standard team · $599.88/year", price: 599.88, cadence: "yearly" },
    custom:           { label: "Group / association / custom price", price: null, cadence: null }
  };

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : (fallback || 0);
  }

  function clampPct(v) {
    var n = num(v, 0);
    return n < 0 ? 0 : n > 100 ? 100 : n;
  }

  /** Rejections expressed per month, from whichever cadence was entered. */
  function monthlyRejections(rejections, frequency, operatingDays) {
    var r = num(rejections, 0);
    if (frequency === "day") return r * num(operatingDays, 30);
    if (frequency === "week") return r * (52 / 12);
    return r;
  }

  function compute(input) {
    var minutes   = num(input.minutes, 0);
    var hourly    = num(input.hourly, 0);
    var recovery  = clampPct(input.recoveryPct) / 100;
    var teamSize  = Math.max(1, num(input.teamSize, 1));

    var rejMonthly   = monthlyRejections(input.rejections, input.frequency, input.days);
    var hoursMonthly = (rejMonthly * minutes) / 60;
    var staffCostMonthly = hoursMonthly * hourly;
    var staffValueMonthly = staffCostMonthly * recovery;
    var staffValueAnnual  = staffValueMonthly * 12;

    // Rx MedMatch side. Nothing is assumed until the pharmacy enters its own numbers.
    var wasteAnnual    = Math.max(0, num(input.wasteAnnual, 0));
    var medShare       = clampPct(input.medRecoveryPct) / 100;
    var medValueAnnual = wasteAnnual * medShare;
    var transferAnnual = Math.max(0, num(input.transferAnnual, 0));
    var medNetAnnual   = medValueAnnual - transferAnnual;

    // Subscription, normalised to both cadences.
    var price   = Math.max(0, num(input.price, 0));
    var subAnnual  = input.cadence === "yearly" ? price : price * 12;
    var subMonthly = subAnnual / 12;

    var netAnnual  = staffValueAnnual + medValueAnnual - transferAnnual - subAnnual;
    var netMonthly = netAnnual / 12;

    // Break-even: raw staff minutes per month needed to cover what the
    // medication side has not already covered.
    var remainingMonthly = Math.max(0, subMonthly + (transferAnnual / 12) - (medValueAnnual / 12));
    var costPerMinute = hourly / 60;
    var breakEvenMinutes = costPerMinute > 0 ? remainingMonthly / costPerMinute : null;
    var perRejectionMinutes = minutes * recovery;
    var breakEvenRejections = (breakEvenMinutes !== null && perRejectionMinutes > 0)
      ? Math.ceil(breakEvenMinutes / perRejectionMinutes)
      : null;

    return {
      rejectionsMonthly: rejMonthly,
      hoursLostMonthly: hoursMonthly,
      staffCostMonthly: staffCostMonthly,
      staffValueMonthly: staffValueMonthly,
      staffValueAnnual: staffValueAnnual,
      medValueAnnual: medValueAnnual,
      transferAnnual: transferAnnual,
      medNetAnnual: medNetAnnual,
      subscriptionMonthly: subMonthly,
      subscriptionAnnual: subAnnual,
      netMonthly: netMonthly,
      netAnnual: netAnnual,
      aboveBreakEven: netAnnual > 0,
      breakEvenMinutes: breakEvenMinutes === null ? null : Math.round(breakEvenMinutes),
      breakEvenRejections: breakEvenRejections,
      costPerMemberMonthly: subMonthly / teamSize,
      costPerMemberAnnual: subAnnual / teamSize,
      costPerMemberDay: subAnnual / teamSize / 365
    };
  }

  function money(n, dp) {
    var d = dp === undefined ? 2 : dp;
    return "$" + (isFinite(n) ? n : 0).toLocaleString("en-CA", {
      minimumFractionDigits: d, maximumFractionDigits: d
    });
  }

  root.RxROI = {
    PLANS: PLANS,
    compute: compute,
    money: money,
    monthlyRejections: monthlyRejections,
    DEFAULTS: {
      teamSize: 4, rejections: 3, frequency: "day", days: 30, minutes: 13,
      hourly: 35, recoveryPct: 50, price: 49.99, cadence: "monthly",
      wasteAnnual: 0, medRecoveryPct: 0, transferAnnual: 0
    }
  };
})(typeof window !== "undefined" ? window : this);
