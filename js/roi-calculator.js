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

    // Return on modelled costs: net value against what the pharmacy actually outlays.
    var modelledCostMonthly = subMonthly + (transferAnnual / 12);
    var combinedRoi = modelledCostMonthly > 0
      ? (netMonthly / modelledCostMonthly) * 100
      : null;

    return {
      rejectionsMonthly: rejMonthly,
      hoursLostMonthly: hoursMonthly,
      hoursLostAnnual: hoursMonthly * 12,
      staffCostMonthly: staffCostMonthly,
      staffCostAnnual: staffCostMonthly * 12,
      recoveredHoursMonthly: hoursMonthly * recovery,
      recoveredHoursAnnual: hoursMonthly * recovery * 12,
      staffValueMonthly: staffValueMonthly,
      staffValueAnnual: staffValueAnnual,
      medValueMonthly: medValueAnnual / 12,
      medValueAnnual: medValueAnnual,
      transferMonthly: transferAnnual / 12,
      transferAnnual: transferAnnual,
      medNetMonthly: medNetAnnual / 12,
      medNetAnnual: medNetAnnual,
      subscriptionMonthly: subMonthly,
      subscriptionAnnual: subAnnual,
      netMonthly: netMonthly,
      netAnnual: netAnnual,
      aboveBreakEven: netAnnual > 0,
      combinedRoi: combinedRoi,
      remainingCostMonthly: remainingMonthly,
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

  /**
   * Per-field validation. Returns a map of field -> message; empty means valid.
   * Mirrors the ranges agreed in the developer handoff.
   */
  var RULES = {
    teamSize:       [1, 1000, true,  "Enter a whole team size from 1 to 1,000."],
    rejections:     [0, 10000, false, "Enter a frequency from 0 to 10,000."],
    minutes:        [0, 1440, false, "Enter minutes from 0 to 1,440."],
    hourly:         [0, 10000, false, "Enter an hourly cost from $0 to $10,000."],
    days:           [1, 31, false, "Enter operating days from 1 to 31."],
    recoveryPct:    [0, 100, false, "Enter a recovery percentage from 0 to 100."],
    price:          [0, 1000000, false, "Enter a subscription price from $0 to $1,000,000."],
    wasteAnnual:    [0, 100000000, false, "Enter an annual inventory value from $0 to $100,000,000."],
    medRecoveryPct: [0, 100, false, "Enter an estimated recovery percentage from 0 to 100."],
    transferAnnual: [0, 100000000, false, "Enter annual transfer costs from $0 to $100,000,000."]
  };

  function validate(values) {
    var errors = {};
    Object.keys(RULES).forEach(function (key) {
      var rule = RULES[key];
      var raw = values[key];
      var n = Number(raw);
      if (raw === "" || raw === null || raw === undefined || !isFinite(n) ||
          n < rule[0] || n > rule[1] || (rule[2] && n !== Math.round(n))) {
        errors[key] = rule[3];
      }
    });
    if (["day", "week", "month"].indexOf(values.frequency) === -1) {
      errors.frequency = "Choose a frequency.";
    }
    if (["monthly", "yearly"].indexOf(values.cadence) === -1) {
      errors.cadence = "Choose a payment period.";
    }
    return errors;
  }

  /**
   * CPhA workload context, valued at the pharmacy's own hourly rate.
   * Context only — never added to the pharmacy's own ROI.
   * Source: Canadian Pharmacists Association, 4 September 2025.
   */
  function workloadIllustration(hourly, monthlyFee) {
    var rate = num(hourly, 0);
    var fee = num(monthlyFee, 49.99);
    var fiveHoursMonth = 5 * 52 / 12;      // ≈ 21.7 h
    var fifteenHoursMonth = 15 * 52 / 12;  // = 65 h
    var fiveCostMonth = fiveHoursMonth * rate;
    return {
      fiveHoursMonth: fiveHoursMonth,
      fifteenHoursMonth: fifteenHoursMonth,
      fiveCostMonth: fiveCostMonth,
      fifteenCostMonth: fifteenHoursMonth * rate,
      feeShare: fiveCostMonth > 0 ? (fee / fiveCostMonth) * 100 : null
    };
  }

  /** Complimentary access runs until midnight America/Toronto on 1 Jan 2027. */
  function isFreeOfferOpen(date) {
    var d = date || new Date();
    var torontoDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(d);
    return torontoDay < "2027-01-01";
  }

  root.RxROI = {
    PLANS: PLANS,
    compute: compute,
    validate: validate,
    workloadIllustration: workloadIllustration,
    isFreeOfferOpen: isFreeOfferOpen,
    money: money,
    monthlyRejections: monthlyRejections,
    DEFAULTS: {
      teamSize: 4, rejections: 3, frequency: "day", days: 30, minutes: 13,
      hourly: 35, recoveryPct: 50, price: 49.99, cadence: "monthly",
      wasteAnnual: 0, medRecoveryPct: 0, transferAnnual: 0
    }
  };
})(typeof window !== "undefined" ? window : this);
