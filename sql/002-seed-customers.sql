-- Within GrowthAuth — Seed mock customer data
-- Run AFTER 001-create-tables.sql
--
-- We are playing vendor for testing purposes.
-- vendor_id = 'test-vendor-real-estate' (matches the MCP server)
--
-- Test cases:
--   1. Active customer (domain match)  → Action 1 returns isCustomer: true
--   2. Active customer (email match)   → Action 1 returns isCustomer: true
--   3. Trialing customer               → Action 1 returns isCustomer: true
--   4. Churned customer                → Action 1 returns isCustomer: false (→ prospect)
--   5. Cancelled customer              → Action 1 returns isCustomer: false (→ prospect)
--
-- Users NOT in this table → prospect (goes through flywheel)
-- Users with @gmail.com etc → personal (tier 0, no flywheel)

INSERT INTO customers (vendor_id, email, domain, status, plan, company_name) VALUES

-- Active customers (should bypass Within entirely)
('test-vendor-real-estate', 'sarah@acmerealty.com', 'acmerealty.com', 'active', 'enterprise', 'Acme Realty Group'),
('test-vendor-real-estate', 'mike@brighthomes.io', 'brighthomes.io', 'active', 'pro', 'Bright Homes'),
('test-vendor-real-estate', 'lisa@urbancore.dev', 'urbancore.dev', 'active', 'starter', 'UrbanCore Development'),

-- Trialing customer (still counts as customer)
('test-vendor-real-estate', 'james@newbuilders.co', 'newbuilders.co', 'trialing', 'pro', 'New Builders Co'),

-- Churned customer (treated as prospect — Within governs them now)
('test-vendor-real-estate', 'alex@formerclients.com', 'formerclients.com', 'churned', 'pro', 'Former Clients LLC'),

-- Cancelled customer (treated as prospect)
('test-vendor-real-estate', 'dana@cancelled-corp.com', 'cancelled-corp.com', 'cancelled', 'starter', 'Cancelled Corp')

ON CONFLICT (vendor_id, domain) DO UPDATE SET
  email = EXCLUDED.email,
  status = EXCLUDED.status,
  plan = EXCLUDED.plan,
  company_name = EXCLUDED.company_name;
