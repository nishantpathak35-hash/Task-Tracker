
-- 1. Revoke EXECUTE on SECURITY DEFINER helpers from anon/authenticated (keep service_role + postgres)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.current_department_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_manager_of(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_overdue_tasks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- These helpers are used inside RLS policies; policy evaluation runs as the table owner
-- so it doesn't need EXECUTE on authenticated. But policies referencing them from
-- authenticated queries need the function callable from within the policy context —
-- SECURITY DEFINER functions run as owner regardless, and RLS policies can call them
-- via the definer path. We keep them callable by postgres/service_role only.

-- 2. profiles: self update — prevent org/department escalation
DROP POLICY IF EXISTS "profiles: self update" ON public.profiles;
CREATE POLICY "profiles: self update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND org_id IS NOT DISTINCT FROM (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    AND department_id IS NOT DISTINCT FROM (SELECT p.department_id FROM public.profiles p WHERE p.id = auth.uid())
  );

-- 3. tasks: create — enforce created_by = auth.uid()
DROP POLICY IF EXISTS "tasks: create in own org" ON public.tasks;
CREATE POLICY "tasks: create in own org" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = public.current_org_id()
    AND created_by = auth.uid()
  );

-- 4. task_activity: insert — verify task is in actor's org
DROP POLICY IF EXISTS "activity: insert self" ON public.task_activity;
CREATE POLICY "activity: insert self" ON public.task_activity
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_activity.task_id
        AND t.org_id = public.current_org_id()
    )
  );

-- 5. notifications: restrict inserts to service_role only (system-generated)
DROP POLICY IF EXISTS "notifications: create in org" ON public.notifications;
-- No authenticated INSERT policy: users cannot create notifications for others.
-- Notifications are inserted by SECURITY DEFINER functions (mark_overdue_tasks) and
-- server-side code using the service role.
