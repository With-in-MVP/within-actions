-- 003-create-conversions.sql
-- Label store for ML training + sim-only ground-truth.
-- Run this in the Supabase SQL editor before running the simulator script.

-- Conversion labels (production-shaped). One row per prospect: did they convert?
CREATE TABLE IF NOT EXISTS conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id TEXT NOT NULL,
  email TEXT NOT NULL,
  converted BOOLEAN NOT NULL,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (vendor_id, email)
);

CREATE INDEX IF NOT EXISTS idx_conversions_vendor_email ON conversions (vendor_id, email);

-- Sim-only: the hidden latent variables behind each synthetic user.
-- Used ONLY to validate the simulator (e.g. "do hot leads really have denser timelines?").
-- NEVER fed to the model as a feature — that would be cheating.
CREATE TABLE IF NOT EXISTS sim_ground_truth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id TEXT NOT NULL,
  email TEXT NOT NULL,
  archetype TEXT NOT NULL,
  latent_intent DOUBLE PRECISION NOT NULL,
  latent_fit DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (vendor_id, email)
);
