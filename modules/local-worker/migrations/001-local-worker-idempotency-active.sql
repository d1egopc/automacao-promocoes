-- Local Worker V1: retry terminal tasks without mutating history.
--
-- Operational migration: CREATE/DROP INDEX CONCURRENTLY must run outside
-- BEGIN/COMMIT. Execute each statement as a separate autocommit command.
-- Precheck first; if either query returns rows, STOP and reconcile manually:
--
-- SELECT idempotency_key, COUNT(*)
--   FROM public.local_worker_tasks
--  WHERE status IN ('pending', 'leased')
--  GROUP BY idempotency_key
-- HAVING COUNT(*) > 1;
--
-- SELECT marketplace, product_id, type, COUNT(*)
--   FROM public.local_worker_tasks
--  WHERE status IN ('pending', 'leased')
--  GROUP BY marketplace, product_id, type
-- HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  local_worker_tasks_active_idempotency_unique
ON public.local_worker_tasks (idempotency_key)
WHERE status IN ('pending', 'leased');

DROP INDEX CONCURRENTLY IF EXISTS
  public.local_worker_tasks_idempotency_unique;
