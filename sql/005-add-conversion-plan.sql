-- 005-add-conversion-plan.sql
-- Make conversions multi-class: which plan did they buy?
--   0 = no conversion, 1 = base, 2 = pro, 3 = enterprise
-- `converted` stays (converted = plan > 0) so binary analyses still work.

ALTER TABLE conversions ADD COLUMN IF NOT EXISTS plan SMALLINT NOT NULL DEFAULT 0;
