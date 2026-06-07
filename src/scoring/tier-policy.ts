/**
 * Tier Policy — maps ICP score (0-100) to tier (0-4) with scopes
 *
 * Tier 0 (blocked):   ICP 0-15,   quota 0,   [tools:suggest]
 * Tier 1 (cold):      ICP 16-35,  quota 10,  [tools:run, data:read]
 * Tier 2 (warm):      ICP 36-55,  quota 50,  + data:write_limited
 * Tier 3 (hot):       ICP 56-75,  quota 200, + data:write, crm:read
 * Tier 4 (champion):  ICP 76-100, quota 500, + crm:write_limited, analytics:read
 */

export interface TierResult {
  tier: number;
  scopes: string[];
  quotaLimit: number;
}

const TIER_SCOPES: Record<number, string[]> = {
  0: ['tools:suggest'],
  1: ['tools:run', 'data:read'],
  2: ['tools:run', 'data:read', 'data:write_limited'],
  3: ['tools:run', 'data:read', 'data:write_limited', 'data:write', 'crm:read'],
  4: ['tools:run', 'data:read', 'data:write_limited', 'data:write', 'crm:read', 'crm:write_limited', 'analytics:read'],
};

const TIER_QUOTA: Record<number, number> = {
  0: 0,
  1: 10,
  2: 50,
  3: 200,
  4: 500,
};

export function scoreToTier(icpScore: number): TierResult {
  let tier: number;

  if (icpScore <= 15) tier = 0;
  else if (icpScore <= 35) tier = 1;
  else if (icpScore <= 55) tier = 2;
  else if (icpScore <= 75) tier = 3;
  else tier = 4;

  return {
    tier,
    scopes: TIER_SCOPES[tier],
    quotaLimit: TIER_QUOTA[tier],
  };
}

/** Floor tier — used when scoring fails or for first-time users */
export const FLOOR_TIER: TierResult = {
  tier: 1,
  scopes: ['tools:run', 'data:read'],
  quotaLimit: 10,
};

export function buildClaims(tier: number, scopes: string[], icpScore: number) {
  return {
    'https://within.com/tier': tier,
    'https://within.com/scopes': scopes,
    'https://within.com/icp_score': icpScore,
  };
}
