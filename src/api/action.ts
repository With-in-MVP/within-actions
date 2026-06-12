/**
 * POST /api/action — Action 2 (the flywheel)
 *
 * Called by Auth0 Action 2 for prospects only.
 * Pipeline: identity → enrichment (cached) → scoring → scoping → writes entitlement.
 * Auth: WITHIN_ACTION_SECRET
 * Body: { email, vendor_id, agent_session_id?, raw_task? }
 * Returns: { claims: { "https://within.com/...": ... } }
 * Fails to floor tier on error.
 */

import { Router } from 'express';
import { findProspect, upsertProspect } from '../db/prospects.js';
import { upsertEntitlement } from '../db/entitlements.js';
import { scoreProspect } from '../scoring/score-prospect.js';
import { scoreToTier, buildClaims, FLOOR_TIER } from '../scoring/tier-policy.js';

// 24h staleness threshold for cached scoring
const SCORE_TTL_MS = 24 * 60 * 60 * 1000;

export function createActionRouter(): Router {
  const router = Router();

  router.post('/api/action', async (req, res) => {
    try {
      // Auth check
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || token !== process.env.WITHIN_ACTION_SECRET) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const { email, vendor_id } = req.body;

      if (!email || !vendor_id) {
        res.status(400).json({ error: 'email and vendor_id are required' });
        return;
      }

      const domain = email.split('@')[1];

      // Check for cached scoring (returning user, scored < 24h ago)
      const existing = await findProspect(vendor_id, email);
      if (existing?.scored_at) {
        const scoredAge = Date.now() - new Date(existing.scored_at).getTime();
        if (scoredAge < SCORE_TTL_MS) {
          // Return cached decision — no LLM call
          const claims = buildClaims(existing.tier, existing.scopes, existing.icp_score);
          res.json({ claims });
          return;
        }
      }

      // Score the prospect
      const { icpScore, signals } = await scoreProspect({ email, domain, vendorId: vendor_id });
      const { tier, scopes, quotaLimit } = scoreToTier(icpScore);

      // Persist scoring result
      await upsertProspect(vendor_id, email, {
        domain,
        tier,
        icp_score: icpScore,
        scopes,
        scored_at: new Date().toISOString(),
        enrichment_status: signals.includes('enriched') ? 'enriched' : signals.includes('unknown_domain') ? 'unknown' : 'skipped',
        scoring_signals: signals,
      });

      // Write/update the entitlement ledger row
      await upsertEntitlement(vendor_id, email, domain, tier, scopes);

      const claims = buildClaims(tier, scopes, icpScore);
      res.json({ claims });
    } catch (err) {
      console.error('[/api/action] Error:', err);
      // Fail to floor tier so login always succeeds
      const claims = buildClaims(FLOOR_TIER.tier, FLOOR_TIER.scopes, 20);
      res.json({ claims });
    }
  });

  return router;
}
