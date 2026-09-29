// Vacancy & Parking Scoring Engine
// In production: replace signals with real API data

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

const RESIDENTIAL_PURPOSES = ["woonfunctie"];
const COMMERCIAL_ACTIVE = ["winkelfunctie", "horecafunctie"];
const VACANCY_PRONE = ["kantoorfunctie", "industriefunctie", "celfunctie", "overige gebruiksfunctie"];
const PARKING_IDEAL = ["industriefunctie", "kantoorfunctie", "overige gebruiksfunctie", "celfunctie"];

export function scoresite(site, context, extras = {}) {
  const rng = seededRandom(
    site.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  );
  const r = () => rng();

  const reasons = [];
  let vacancyScore = 0;
  let parkingScore = 0;

  // --- VACANCY SIGNALS ---

  // 1. No active Google Places signal
  const noPlaceSignal = !COMMERCIAL_ACTIVE.includes(site.usePurpose) && r() > 0.3;
  if (noPlaceSignal) {
    vacancyScore += 20 + Math.floor(r() * 10);
    reasons.push({ type: "positive", signal: "no_active_place_signal", label: "No active business registered at address", weight: 20 });
  }

  // 2. Low activity context
  const lowActivity = context && context.totalCount < 8;
  if (lowActivity) {
    vacancyScore += 15 + Math.floor(r() * 8);
    reasons.push({ type: "positive", signal: "low_activity_context", label: "Low nearby business density", weight: 15 });
  }

  // 3. Inactive frontage — real Cloud Vision signal when available, else mock.
  const frontage = extras.frontage;
  const inactiveFrontage = frontage
    ? frontage.inactiveFrontage
    : r() > 0.45;
  if (inactiveFrontage) {
    vacancyScore += 18 + Math.floor(r() * 7);
    reasons.push({
      type: "positive",
      signal: "inactive_frontage",
      label: frontage
        ? `Vision: ${frontage.signals?.[0] || "inactive frontage"}`
        : "Street View suggests inactive frontage",
      weight: 18,
      source: frontage?.provider || "mock",
    });
  }

  // 4. Building status
  if (site.bagStatus === "Pand buiten gebruik") {
    vacancyScore += 25;
    reasons.push({ type: "positive", signal: "bag_status_inactive", label: "BAG status: Pand buiten gebruik", weight: 25 });
  } else if (site.bagStatus === "Sloopvergunning verleend") {
    vacancyScore += 30;
    reasons.push({ type: "positive", signal: "bag_status_sloop", label: "BAG status: Sloopvergunning verleend", weight: 30 });
  } else if (site.bagStatus === "Verbouwing pand") {
    vacancyScore += 10;
    reasons.push({ type: "positive", signal: "bag_status_verbouwing", label: "BAG status: Verbouwing pand", weight: 10 });
  }

  // 5. Use purpose vacancy prone
  if (VACANCY_PRONE.includes(site.usePurpose)) {
    vacancyScore += 12 + Math.floor(r() * 8);
    reasons.push({ type: "positive", signal: "vacancy_prone_purpose", label: `Use purpose '${site.usePurpose}' has elevated vacancy rates`, weight: 12 });
  }

  // 6. Age signal
  if (site.buildYear < 1975) {
    vacancyScore += 8;
    reasons.push({ type: "positive", signal: "aging_stock", label: `Build year ${site.buildYear} — aging building stock`, weight: 8 });
  }

  // PENALTIES
  if (RESIDENTIAL_PURPOSES.includes(site.usePurpose)) {
    vacancyScore -= 40;
    reasons.push({ type: "negative", signal: "residential_penalty", label: "Residential use purpose — unlikely vacancy site", weight: -40 });
  }

  if (COMMERCIAL_ACTIVE.includes(site.usePurpose) && r() > 0.5) {
    vacancyScore -= 20;
    reasons.push({ type: "negative", signal: "active_commercial", label: "Active commercial purpose detected", weight: -20 });
  }

  vacancyScore = Math.max(0, Math.min(100, vacancyScore));

  // --- PARKING SIGNALS ---

  // Floor area fit
  if (site.areaSqm >= 500) {
    parkingScore += 25 + Math.floor(r() * 10);
    reasons.push({ type: "parking", signal: "large_footprint", label: `Floor area ${site.areaSqm}m² — suitable for parking layout`, weight: 25 });
  } else if (site.areaSqm >= 200) {
    parkingScore += 12 + Math.floor(r() * 8);
    reasons.push({ type: "parking", signal: "medium_footprint", label: `Floor area ${site.areaSqm}m² — moderate parking potential`, weight: 12 });
  }

  // Use purpose fit
  if (PARKING_IDEAL.includes(site.usePurpose)) {
    parkingScore += 20 + Math.floor(r() * 10);
    reasons.push({ type: "parking", signal: "ideal_use_purpose", label: `Use purpose '${site.usePurpose}' converts well to parking`, weight: 20 });
  }

  // Demand context
  if (context && context.transitProximity) {
    parkingScore += 18;
    reasons.push({ type: "parking", signal: "transit_proximity", label: "Transit hub within 250m — high parking demand", weight: 18 });
  }
  if (context && context.retailProximity) {
    parkingScore += 12;
    reasons.push({ type: "parking", signal: "retail_proximity", label: "Retail cluster nearby — visitor parking demand", weight: 12 });
  }
  if (context && context.hospitalProximity) {
    parkingScore += 15;
    reasons.push({ type: "parking", signal: "hospital_proximity", label: "Hospital within 250m — captive parking demand", weight: 15 });
  }

  // Random residual
  parkingScore += Math.floor(r() * 15);
  parkingScore = Math.max(0, Math.min(100, parkingScore));

  // Confidence
  const totalSignals = reasons.length;
  const confidence = totalSignals >= 5 ? "high" : totalSignals >= 3 ? "medium" : "low";

  return {
    vacancyScore,
    parkingScore,
    confidence,
    reasons,
    scoredAt: new Date().toISOString(),
    modelVersion: "1.0.0",
  };
}

export function computeConversionModel(site, score) {
  const rng = seededRandom(site.areaSqm + score.parkingScore);
  const r = () => rng();

  const areaSqm = Number(site.areaSqm) || 0;
  const parkingScore = Number(score?.parkingScore) || 0;
  const demandMultiplier = parkingScore >= 80 ? 1.18 : parkingScore >= 65 ? 1.08 : parkingScore >= 45 ? 0.96 : 0.82;
  const layoutEfficiency = Math.min(0.86, Math.max(0.56, 0.62 + (parkingScore / 100) * 0.18 + r() * 0.06));
  const usableAreaSqm = Math.floor(areaSqm * layoutEfficiency);
  const sqmPerSpace = 27.5 + r() * 4.5; // stall + aisle circulation for a compact surface layout
  const spacesEst = Math.max(4, Math.floor(usableAreaSqm / sqmPerSpace));
  const spacesLow = Math.max(1, Math.floor(spacesEst * 0.85));
  const spacesHigh = Math.max(spacesEst, Math.ceil(spacesEst * 1.15));

  const setupCostPerSpace = 4200 + Math.floor(r() * 2200);
  const setupLow = Math.floor(spacesLow * setupCostPerSpace * 0.9);
  const setupBase = Math.floor(spacesEst * setupCostPerSpace);
  const setupHigh = Math.floor(spacesHigh * setupCostPerSpace * 1.18);

  const monthlyRatePerSpace = Math.round((115 + parkingScore * 1.25 + r() * 45) * demandMultiplier);
  const occupancyLow = 0.58;
  const occupancyBase = Math.min(0.92, 0.62 + (parkingScore / 100) * 0.22);
  const occupancyHigh = Math.min(0.97, occupancyBase + 0.1);
  const revenueLow = Math.floor(spacesLow * monthlyRatePerSpace * occupancyLow);
  const revenueBase = Math.floor(spacesEst * monthlyRatePerSpace * occupancyBase);
  const revenueHigh = Math.floor(spacesHigh * monthlyRatePerSpace * occupancyHigh);
  const operatingCostMonthly = Math.floor(spacesEst * (18 + r() * 10));
  const netRevenueMonthly = Math.max(0, revenueBase - operatingCostMonthly);
  const annualGrossRevenue = revenueBase * 12;
  const annualNetRevenue = netRevenueMonthly * 12;

  const activationLow = 24 + Math.floor(r() * 18);
  const activationHigh = activationLow + 28 + Math.floor(r() * 26);
  const roiMonths = netRevenueMonthly > 0 ? Math.ceil(setupBase / netRevenueMonthly) : null;
  const roiMonthsLow = revenueLow > 0 ? Math.ceil(setupHigh / Math.max(1, revenueLow - operatingCostMonthly)) : null;
  const roiMonthsHigh = revenueHigh > 0 ? Math.ceil(setupLow / Math.max(1, revenueHigh - operatingCostMonthly)) : null;
  const paybackYears = roiMonths ? Number((roiMonths / 12).toFixed(1)) : null;
  const annualRoiPct = setupBase > 0 ? Math.round((annualNetRevenue / setupBase) * 100) : 0;

  return {
    spacesEst,
    spacesLow,
    spacesHigh,
    usableAreaSqm,
    layoutEfficiency: Number(layoutEfficiency.toFixed(2)),
    sqmPerSpace: Number(sqmPerSpace.toFixed(1)),
    monthlyRatePerSpace,
    occupancyLow,
    occupancyBase: Number(occupancyBase.toFixed(2)),
    occupancyHigh: Number(occupancyHigh.toFixed(2)),
    setupCostLow: setupLow,
    setupCostBase: setupBase,
    setupCostHigh: setupHigh,
    revenueLow,
    revenueBase,
    revenueHigh,
    operatingCostMonthly,
    netRevenueMonthly,
    annualGrossRevenue,
    annualNetRevenue,
    activationDaysLow: activationLow,
    activationDaysHigh: activationHigh,
    roiMonths,
    roiMonthsLow,
    roiMonthsHigh,
    paybackYears,
    annualRoiPct,
    assumptions: [
      `${usableAreaSqm}m² usable parking area (${Math.round(layoutEfficiency * 100)}% of BAG floor area)`,
      `${sqmPerSpace.toFixed(1)}m² per bay including circulation`,
      `${Math.round(occupancyBase * 100)}% base occupancy at €${monthlyRatePerSpace}/space/month`,
    ],
    modelVersion: "2.0.0",
    computedAt: new Date().toISOString(),
  };
}
