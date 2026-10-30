CREATE POLICY sync_admin_update ON public.sync_runs FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT UPDATE ON public.sync_runs TO authenticated;