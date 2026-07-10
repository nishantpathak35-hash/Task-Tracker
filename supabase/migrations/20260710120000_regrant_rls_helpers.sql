-- =========================================================
-- FIX: Re-grant EXECUTE on RLS helper functions to authenticated
-- =========================================================
-- Migration 20260710101253 revoked EXECUTE from authenticated on the
-- SECURITY DEFINER helper functions used inside RLS policies.
-- While SECURITY DEFINER changes what the function body can access,
-- the calling role (authenticated) still needs EXECUTE permission
-- to invoke the function in the first place — including from within
-- RLS policy expressions evaluated on that role's behalf.
--
-- Without this grant, every SELECT/INSERT/UPDATE/DELETE on tables
-- with policies referencing these helpers will fail with:
--   "permission denied for function has_role" (or similar)

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_department_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager_of(uuid) TO authenticated;

-- mark_overdue_tasks and handle_new_user remain revoked from authenticated
-- (they are only called by pg_cron / trigger context, never by user queries)
