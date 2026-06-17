-- Within GrowthAuth — Enable Row Level Security (deny-all)
-- Run this in the Supabase SQL Editor.
--
-- WHY: This database is accessed ONLY by the backend (within-actions) and the
-- ML pipeline (within-ml), both using the SUPABASE_SERVICE_ROLE_KEY. The service
-- role BYPASSES RLS, so enabling RLS here breaks NOTHING for our own code.
--
-- WHAT IT CLOSES: Every Supabase project exposes a public PostgREST API reachable
-- with the project's anon key (anon keys are public by design). With RLS disabled,
-- that API can read/write our tables. Enabling RLS with NO policies = deny-all for
-- the anon/authenticated roles, while the service role keeps full access.
--
-- If a vendor dashboard ever reads THIS database directly with an anon/authenticated
-- key, it will be denied until you add explicit per-vendor policies (e.g. restrict
-- rows to the caller's vendor_id). Until then, deny-all is the correct posture.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'customers',
    'prospect_identities',
    'entitlements',
    'enrichment_cache',
    'usage_events',
    'conversions',
    'sim_ground_truth',
    'vendor_config'   -- exists in DB though it has no migration file; skipped if absent
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      -- FORCE ensures even the table owner is subject to RLS (service_role still bypasses).
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);
      RAISE NOTICE 'RLS enabled on %', t;
    ELSE
      RAISE NOTICE 'skipped % (does not exist)', t;
    END IF;
  END LOOP;
END $$;

-- Verify afterwards (should list every table with rowsecurity = true):
--   SELECT relname, relrowsecurity, relforcerowsecurity
--   FROM pg_class
--   WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
--   ORDER BY relname;
