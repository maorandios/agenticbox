-- Phase 1: document worker schedule (apply in Dashboard / pg_cron after project exists).
-- Worker must run once per minute. Queue processing is idempotent:
-- crash after DB upsert and before pgmq.archive may redeliver; handlers upsert by provider ids.

-- Example (run as supabase_admin after Edge/HTTP worker URL is known):
--   select cron.schedule(
--     'mail-jobs-worker',
--     '* * * * *',
--     $$
--     select net.http_post(
--       url := current_setting('app.settings.mail_worker_url'),
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret'),
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb
--     );
--     $$
--   );

comment on function private.mail_jobs_read(integer, integer) is
  'Read mail_jobs with visibility timeout. Cron should invoke the Next worker once per minute.';
