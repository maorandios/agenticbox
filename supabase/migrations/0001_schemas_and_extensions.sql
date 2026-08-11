-- Phase 1: schemas + extensions
-- private + pgmq are never exposed via Data API (see RPCs in later migrations).

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to service_role;
grant all on schema private to service_role;
grant all on all tables in schema private to service_role;
grant all on all sequences in schema private to service_role;
grant all on all routines in schema private to service_role;
alter default privileges in schema private
  grant all on tables to service_role;
alter default privileges in schema private
  grant all on sequences to service_role;
alter default privileges in schema private
  grant all on routines to service_role;

-- Supabase Queues (pgmq). Requires Postgres/pgmq availability on the project.
create extension if not exists pgmq;

-- Queue for mail sync / webhook jobs. Access only via SECURITY DEFINER RPCs.
select pgmq.create('mail_jobs');
