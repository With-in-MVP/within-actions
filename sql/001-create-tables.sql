-- Within GrowthAuth — Database Schema
-- Run this in the Supabase SQL Editor

-- =============================================================================
-- 1. CUSTOMERS — vendor's paying customers (seeded from billing/CRM)
-- =============================================================================
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id TEXT NOT NULL,
  email TEXT,
  domain TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'trialing', 'churned', 'cancelled')),
  plan TEXT,
  company_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (vendor_id, domain)
);

-- Index for email lookup (Action 1 checks email first)
CREATE INDEX IF NOT EXISTS idx_customers_vendor_email ON customers (vendor_id, email);

-- =============================================================================
-- 2. PROSPECT_IDENTITIES — scoring cache per prospect
-- =============================================================================
CREATE TABLE IF NOT EXISTS prospect_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id TEXT NOT NULL,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  tier INT NOT NULL DEFAULT 1,
  icp_score INT NOT NULL DEFAULT 20,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['tools:run', 'data:read'],
  enrichment_status TEXT,
  scored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (vendor_id, email)
);

-- =============================================================================
-- 3. ENTITLEMENTS — per-user quota ledger
-- =============================================================================
CREATE TABLE IF NOT EXISTS entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id TEXT NOT NULL,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  tier INT NOT NULL DEFAULT 1,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['tools:run', 'data:read'],
  quota_limit INT NOT NULL DEFAULT 10,
  quota_used INT NOT NULL DEFAULT 0,
  quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', now()) + INTERVAL '1 month'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (vendor_id, email)
);

-- Index for domain-level reporting
CREATE INDEX IF NOT EXISTS idx_entitlements_vendor_domain ON entitlements (vendor_id, domain);

-- =============================================================================
-- 4. ENRICHMENT_CACHE — firmographic data, 7-day TTL (enforced in app code)
-- =============================================================================
CREATE TABLE IF NOT EXISTS enrichment_cache (
  domain TEXT PRIMARY KEY,
  company_name TEXT,
  industry TEXT,
  employee_range TEXT,
  revenue_range TEXT,
  location TEXT,
  enriched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 5. USAGE_EVENTS — append-only tool call log
-- =============================================================================
CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id TEXT NOT NULL,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'quota_exceeded', 'scope_denied')),
  agent_session_id TEXT,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for per-user usage queries
CREATE INDEX IF NOT EXISTS idx_usage_events_vendor_email ON usage_events (vendor_id, email);
