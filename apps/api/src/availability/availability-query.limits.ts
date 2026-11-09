// Adjustable operational defaults for public availability reads, not academic thresholds.
export const availabilityQueryLimits = {
  maxRangeMs: 31 * 24 * 60 * 60 * 1000,
  maxCandidates: 5000,
} as const;
