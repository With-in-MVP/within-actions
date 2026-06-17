/**
 * Tier policy (prospects only) — mirrors the production scoping rules so
 * synthetic prospect_identities rows look exactly like real ones.
 */

export function tierForScore(icp: number): number {
  if (icp <= 15) return 0;
  if (icp <= 35) return 1;
  if (icp <= 55) return 2;
  if (icp <= 75) return 3;
  return 4;
}

const SCOPES_BY_TIER: Record<number, string[]> = {
  0: ['tools:suggest'],
  1: ['tools:run', 'data:read'],
  2: ['tools:run', 'data:read', 'data:write_limited'],
  3: ['tools:run', 'data:read', 'data:write_limited', 'data:write', 'crm:read'],
  4: [
    'tools:run',
    'data:read',
    'data:write_limited',
    'data:write',
    'crm:read',
    'crm:write_limited',
    'analytics:read',
  ],
};

export function scopesForTier(tier: number): string[] {
  return SCOPES_BY_TIER[tier] ?? SCOPES_BY_TIER[1];
}
