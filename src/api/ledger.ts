/**
 * GET /api/ledger/:userId — enforcement SDK
 *
 * Returns the authoritative quota state for a user.
 * userId = URL-encoded email (e.g. john%40acme.com)
 * Query: ?vendor_id=...
 * Auth: WITHIN_API_KEY (same key the enforcement SDK uses)
 */

import { Router } from 'express';
import { getEntitlement } from '../db/entitlements.js';

export function createLedgerRouter(): Router {
  const router = Router();

  router.get('/api/ledger/:userId', async (req, res) => {
    try {
      // Auth check
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || token !== process.env.WITHIN_API_KEY) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const email = decodeURIComponent(req.params.userId);
      const vendorId = req.query.vendor_id as string;

      if (!vendorId) {
        res.status(400).json({ error: 'vendor_id query param is required' });
        return;
      }

      const ledger = await getEntitlement(vendorId, email);

      if (!ledger) {
        res.status(404).json({ error: 'no_entitlement' });
        return;
      }

      res.json(ledger);
    } catch (err) {
      console.error('[/api/ledger] Error:', err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}
