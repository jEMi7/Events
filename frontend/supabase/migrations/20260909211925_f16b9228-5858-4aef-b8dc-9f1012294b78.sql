ALTER TABLE public.sync_runs DROP CONSTRAINT IF EXISTS sync_runs_status_check;
ALTER TABLE public.sync_runs ADD CONSTRAINT sync_runs_status_check
  CHECK (status = ANY (ARRAY['running','success','succeeded','failed','connection_required']));