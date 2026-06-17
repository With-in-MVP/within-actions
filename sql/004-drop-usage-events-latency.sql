-- 004-drop-usage-events-latency.sql
-- Drop the latency_ms column from usage_events (no longer tracked).
-- Forward migration: applied after 001 created the column.

ALTER TABLE usage_events DROP COLUMN IF EXISTS latency_ms;
