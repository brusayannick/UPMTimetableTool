-- Catalogue details per course (from the incoming-student CSV).
-- Apply after 0001_schema.sql, or paste both into the SQL editor in order.

alter table courses add column if not exists details jsonb;
