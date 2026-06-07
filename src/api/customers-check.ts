/**
 * POST /api/customers/check — Action 1
 *
 * Called by Auth0 Action 1 to classify a user as customer or prospect.
 * Auth: INTERNAL_API_KEY
 * Body: { domain, email?, vendor_id }
 * Returns: { isCustomer, plan?, status?, companyName? }
 * Fails closed (isCustomer: false) on error.
 */

import { Router } from 'express';
import { checkIfCustomer } from '../db/customers.js';

export function createCustomersCheckRouter(): Router {
  const router = Router();

  router.post('/api/customers/check', async (req, res) => {
    try {
      // Auth check
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token || token !== process.env.INTERNAL_API_KEY) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const { domain, email, vendor_id } = req.body;

      if (!domain || !vendor_id) {
        res.status(400).json({ error: 'domain and vendor_id are required' });
        return;
      }

      const result = await checkIfCustomer(vendor_id, domain, email);
      res.json(result);
    } catch (err) {
      console.error('[/api/customers/check] Error:', err);
      // Fail closed — treat as prospect
      res.json({ isCustomer: false });
    }
  });

  return router;
}
