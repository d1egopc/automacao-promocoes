-- Read-only precheck for 001-local-worker-idempotency-active.sql.
-- Both queries must return zero rows. If either returns rows, STOP and
-- reconcile manually; this file does not modify the database.

SELECT idempotency_key, COUNT(*) AS total
  FROM public.local_worker_tasks
 WHERE status IN ('pending', 'leased')
 GROUP BY idempotency_key
HAVING COUNT(*) > 1;

SELECT marketplace, product_id, type, COUNT(*) AS total
  FROM public.local_worker_tasks
 WHERE status IN ('pending', 'leased')
 GROUP BY marketplace, product_id, type
HAVING COUNT(*) > 1;
