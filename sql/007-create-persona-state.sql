-- 007-create-persona-state.sql
-- Persisted roster for the cron population simulator (Phase C).
--
-- Today's persona runner is fire-and-forget (create user -> run -> judge -> delete).
-- Cron personas instead LIVE ACROSS TICKS: spawned once, they return on later
-- scheduled fires (re-login via ROPG with the stored creds), and are only judged +
-- deleted at the end of their journey. This table is the memory that makes that
-- multi-session lifecycle possible. Service-role only (see 006-enable-rls.sql).
CREATE TABLE IF NOT EXISTS persona_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id TEXT NOT NULL,
  email TEXT NOT NULL,
  auth0_user_id TEXT NOT NULL,          -- needed to delete the Auth0 user at resolve
  password TEXT NOT NULL,                -- needed to re-login (ROPG) on every return visit
  domain TEXT NOT NULL,                  -- fit axis (firmographic)
  latent_intent DOUBLE PRECISION NOT NULL, -- hidden intent (ground truth; drives P(return))
  brief TEXT NOT NULL,                   -- persona backstory (reused verbatim each visit)
  system_prompt TEXT NOT NULL,           -- actor system prompt (rehydrates the character)
  status TEXT NOT NULL DEFAULT 'active', -- active | converted | churned
  visit_count INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER NOT NULL DEFAULT 0,
  transcript TEXT NOT NULL DEFAULT '',   -- accumulated multi-session transcript (fed to the resolve judge)
  spawned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_visit_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,

  UNIQUE (vendor_id, email)
);

-- The hot path each tick is "list the active roster for this vendor".
CREATE INDEX IF NOT EXISTS idx_persona_state_active ON persona_state (vendor_id, status);
