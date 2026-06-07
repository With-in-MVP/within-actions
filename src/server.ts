/**
 * Within GrowthAuth API Server
 *
 * Endpoints:
 *   POST /api/customers/check  — Action 1 (customer lookup)
 *   POST /api/action           — Action 2 (flywheel: enrich→score→scope)
 *   GET  /api/ledger/:userId   — Enforcement SDK (quota read)
 *   POST /api/usage            — Enforcement SDK (metering)
 *   GET  /health               — Health check
 */

import express from 'express';
import { createCustomersCheckRouter } from './api/customers-check.js';
import { createActionRouter } from './api/action.js';
import { createLedgerRouter } from './api/ledger.js';
import { createUsageRouter } from './api/usage.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '4300', 10);

app.use(express.json());

// Mount API routes
app.use(createCustomersCheckRouter());
app.use(createActionRouter());
app.use(createLedgerRouter());
app.use(createUsageRouter());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'within-actions' });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'not_found' });
});

app.listen(PORT, () => {
  console.log(`
====================================================
  Within GrowthAuth API
  http://localhost:${PORT}
====================================================

Endpoints:
  POST /api/customers/check  (Action 1)
  POST /api/action           (Action 2 — flywheel)
  GET  /api/ledger/:userId   (Enforcement SDK)
  POST /api/usage            (Enforcement SDK)

====================================================
`);
});
