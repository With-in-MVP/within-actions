/**
 * POST /api/usage — enforcement SDK (metering)
 *
 * Records a tool call outcome. Only "success" increments quotaUsed.
 * Burning >=60% flags user for re-scoring (intent signal → potential tier upgrade).
 *
 * Body: { vendor_id, email, domain, tool_name, outcome, agent_session_id?, latency_ms? }
 * Auth: WITHIN_API_KEY
 */

import { Router } from 'express';
import { recordUsage } from '../db/usage-events.js';
import { incrementUsage, getEntitlement } from '../db/entitlements.js';

export function createUsageRouter(): Router {
  const router = Router();

  router.post('/api/usage', async (req, res) => {
    try {
      // Auth check
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || token !== process.env.WITHIN_API_KEY) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const { vendor_id, email, domain, tool_name, outcome, agent_session_id, agent_client_name, ip_address, tool_arguments } = req.body;

      if (!vendor_id || !email || !tool_name || !outcome) {
        res.status(400).json({ error: 'vendor_id, email, tool_name, and outcome are required' });
        return;
      }

      // Record the usage event
      await recordUsage({
        vendor_id,
        email,
        domain: domain ?? email.split('@')[1],
        tool_name,
        outcome,
        agent_session_id,
        agent_client_name,
        ip_address,
        tool_arguments,
      });

      // Only success increments quota
      if (outcome === 'success') {
        await incrementUsage(vendor_id, email);

        // Check if user has burned >=60% of quota (flag for re-scoring)
        const ledger = await getEntitlement(vendor_id, email);
        if (ledger && ledger.quotaLimit > 0) {
          const burnRate = ledger.quotaUsed / ledger.quotaLimit;
          if (burnRate >= 0.6) {
            console.log(`[usage] ${email} at ${Math.round(burnRate * 100)}% quota — flagged for re-scoring`);
            // TODO: trigger async re-scoring
          }
        }
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('[/api/usage] Error:', err);
      // Fire-and-forget semantics — don't break the vendor's tool call
      res.json({ ok: true });
    }
  });

  return router;
}
