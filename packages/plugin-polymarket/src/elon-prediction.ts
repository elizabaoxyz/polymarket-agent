/**
 * Elon Tweet Prediction Engine
 * 
 * Bayesian prediction system for Elon Musk tweet count markets.
 * Uses 81 weeks of historical data with seasonal adjustments.
 * 
 * @author ElizaBAO
 */

// ============================================================
// HISTORICAL DATA (81 weeks)
// ============================================================
export const ELON_HISTORICAL_DATA = {
  averageRate: 2.5,
  historicalPeriods: [
    { start: '2026-01-13', end: '2026-01-20', total: 530, rate: 3.15 },
    { start: '2026-01-06', end: '2026-01-13', total: 550, rate: 3.27 },
    { start: '2025-12-30', end: '2026-01-06', total: 530, rate: 3.15 },
    { start: '2025-12-23', end: '2025-12-30', total: 430, rate: 2.56 },
    { start: '2025-12-16', end: '2025-12-23', total: 350, rate: 2.08 },
    { start: '2025-12-09', end: '2025-12-16', total: 270, rate: 1.61 },
    { start: '2025-12-02', end: '2025-12-09', total: 430, rate: 2.56 },
    { start: '2025-11-25', end: '2025-12-02', total: 270, rate: 1.61 },
    { start: '2025-11-18', end: '2025-11-25', total: 210, rate: 1.25 },
    { start: '2025-11-11', end: '2025-11-18', total: 270, rate: 1.61 },
    { start: '2025-11-04', end: '2025-11-11', total: 550, rate: 3.27 },
    { start: '2025-10-28', end: '2025-11-04', total: 630, rate: 3.75 },
    { start: '2025-10-21', end: '2025-10-28', total: 530, rate: 3.15 },
    { start: '2025-10-14', end: '2025-10-21', total: 430, rate: 2.56 },
    { start: '2025-10-07', end: '2025-10-14', total: 350, rate: 2.08 },
    { start: '2025-09-30', end: '2025-10-07', total: 270, rate: 1.61 },
    { start: '2025-09-23', end: '2025-09-30', total: 310, rate: 1.85 },
    { start: '2025-09-16', end: '2025-09-23', total: 350, rate: 2.08 },
    { start: '2025-09-09', end: '2025-09-16', total: 310, rate: 1.85 },
    { start: '2025-09-02', end: '2025-09-09', total: 270, rate: 1.61 },
    { start: '2025-08-26', end: '2025-09-02', total: 230, rate: 1.37 },
    { start: '2025-08-19', end: '2025-08-26', total: 190, rate: 1.13 },
    { start: '2025-08-12', end: '2025-08-19', total: 230, rate: 1.37 },
    { start: '2025-08-05', end: '2025-08-12', total: 270, rate: 1.61 },
  ],
  seasonalFactors: {
    1: 1.15, // January - high activity
    2: 1.05,
    3: 1.0,
    4: 0.95,
    5: 0.9,
    6: 0.85, // Summer - lower
    7: 0.85,
    8: 0.9,
    9: 1.0,
    10: 1.1,  // Fall - increases
    11: 1.15, // November - election buzz
    12: 1.0,
  } as { [key: number]: number },
};

// ============================================================
// EDGE THRESHOLDS
// ============================================================
export const ELON_EDGE_CONFIG = {
  enabled: true,
  minEdge: 0.05,     // 5% minimum edge required to trade
  mediumEdge: 0.10,  // 10% = MEDIUM confidence
  highEdge: 0.20,    // 20% = HIGH confidence
};

// ============================================================
// PREDICTION FUNCTIONS
// ============================================================

export interface ElonPrediction {
  predicted: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
  stdDev: number;
}

/**
 * Predict final Elon tweet count using Bayesian estimation
 */
export function predictElonTweets(
  currentCount: number,
  elapsedHours: number,
  totalHours: number = 168
): ElonPrediction {
  const rates = ELON_HISTORICAL_DATA.historicalPeriods.map(p => p.rate);
  const simpleAvg = rates.reduce((a, b) => a + b, 0) / rates.length;

  // Use MEDIAN for more accurate predictions
  const sortedRates = [...rates].sort((a, b) => a - b);
  const medianRate = sortedRates[Math.floor(sortedRates.length / 2)];

  const remainingHours = totalHours - elapsedHours;
  let predicted: number;

  if (elapsedHours < 12 || currentCount < 10) {
    // FUTURE MARKET: Use median rate
    predicted = Math.round(medianRate * totalHours);
    console.log(`🐦 Prediction (future market): median rate ${medianRate.toFixed(2)}/h × ${remainingHours.toFixed(0)}h = ${predicted}`);
  } else {
    // ACTIVE MARKET: Use Bayesian update with observed rate
    const currentRate = currentCount / elapsedHours;
    const priorWeight = 0.3;
    const observedWeight = 0.7;
    const posteriorRate = (priorWeight * simpleAvg) + (observedWeight * currentRate);

    // Apply seasonal factor
    const month = new Date().getMonth() + 1;
    const seasonalFactor = ELON_HISTORICAL_DATA.seasonalFactors[month] || 1.0;
    const adjustedRate = posteriorRate * seasonalFactor;

    predicted = Math.round(currentCount + adjustedRate * remainingHours);
    console.log(`🐦 Prediction (active market): ${currentCount} + ${adjustedRate.toFixed(2)}/h × ${remainingHours.toFixed(0)}h = ${predicted}`);
  }

  const variance = rates.reduce((sum, r) => sum + Math.pow(r - simpleAvg, 2), 0) / rates.length;
  const stdDev = Math.sqrt(variance) * totalHours;
  const marginOfError = 1.96 * stdDev;

  const lowerBound = Math.max(currentCount, Math.round(predicted - marginOfError));
  const upperBound = Math.round(predicted + marginOfError);
  const confidence = Math.min(0.70 + (elapsedHours / totalHours) * 0.25, 0.95);

  return { predicted, lowerBound, upperBound, confidence, stdDev };
}

/**
 * Calculate probability that tweets fall in a specific bucket range
 */
export function calculateBucketProbability(
  lowerRange: number,
  upperRange: number,
  predicted: number,
  stdDev: number
): number {
  const mean = predicted;
  const sigma = stdDev / 1.96;

  // Z-scores for bucket boundaries
  const zLower = (lowerRange - mean) / sigma;
  const zUpper = (upperRange - mean) / sigma;

  // Error function approximation
  const erf = (x: number) => {
    const t = 1 / (1 + 0.5 * Math.abs(x));
    const tau = t * Math.exp(-x * x - 1.26551223 +
      t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
        t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 +
          t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? 1 - tau : tau - 1;
  };

  const cdf = (z: number) => 0.5 * (1 + erf(z / Math.sqrt(2)));

  return Math.max(0, cdf(zUpper) - cdf(zLower));
}

/**
 * Calculate edge (our probability vs market price)
 */
export function calculateEdge(
  lowerRange: number,
  upperRange: number,
  predicted: number,
  stdDev: number,
  marketPrice: number
): { edge: number; probability: number; level: "NONE" | "LOW" | "MEDIUM" | "HIGH" } {
  const probability = calculateBucketProbability(lowerRange, upperRange, predicted, stdDev);
  const edge = probability - marketPrice;

  let level: "NONE" | "LOW" | "MEDIUM" | "HIGH" = "NONE";
  if (edge >= ELON_EDGE_CONFIG.highEdge) level = "HIGH";
  else if (edge >= ELON_EDGE_CONFIG.mediumEdge) level = "MEDIUM";
  else if (edge >= ELON_EDGE_CONFIG.minEdge) level = "LOW";

  return { edge, probability, level };
}

/**
 * Extract date range from market question
 */
export function extractDateRange(question: string): {
  startMonth: string;
  startDay: number;
  endMonth: string;
  endDay: number;
} | null {
  const dateRegex = /(\w+)\s+(\d+)\s*(?:to|-)\s*(\w+)\s+(\d+)/i;
  const match = question.match(dateRegex);
  if (!match) return null;
  return {
    startMonth: match[1].toLowerCase(),
    startDay: parseInt(match[2]),
    endMonth: match[3].toLowerCase(),
    endDay: parseInt(match[4]),
  };
}

/**
 * Parse bucket range from market question
 */
export function parseBucketRange(question: string): { lower: number; upper: number } | null {
  const bucketRegex = /(\d+)-(\d+)\s*tweets?/i;
  const match = question.match(bucketRegex);
  if (!match) return null;
  return {
    lower: parseInt(match[1]),
    upper: parseInt(match[2]),
  };
}
