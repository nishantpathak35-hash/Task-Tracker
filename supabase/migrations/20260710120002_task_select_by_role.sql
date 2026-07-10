-- =========================================================
-- Security hardening: role-based task visibility + creation
-- =========================================================

-- Item 4: Replace org-wide task SELECT with role-based visibility
DROP POLICY IF EXISTS "tasks: org members read" ON public.tasks;
DROP POLICY IF EXISTS "tasks: role-based read" ON public.tasks;

CREATE POLICY "tasks: role-based read" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    org_id = public.current_org_id()
    AND (
      -- super_admin: sees everything in org
      public.has_role(auth.uid(), 'super_admin')
      -- manager: sees their department + own tasks
      OR (
        public.has_role(auth.uid(), 'manager')
        AND (
          department_id IS NOT DISTINCT FROM public.current_department_id()
          OR assigned_to = auth.uid()
          OR created_by = auth.uid()
          OR approver_id = auth.uid()
        )
      )
      -- employee: only own tasks (assigned, created, or approver)
      OR assigned_to = auth.uid()
      OR created_by = auth.uid()
      OR approver_id = auth.uid()
    )
  );

-- Item 5: The INSERT policy already enforces created_by = auth.uid()
-- (from migration 20260710101253). Server-side enforcement for
-- employee assigned_to restriction is done in tasks.functions.ts.

-- Item 6: Verify user_roles write lockdown
-- The base migration only grants SELECT to authenticated and ALL to service_role.
-- No INSERT/UPDATE/DELETE policies exist for authenticated — confirmed secure.
-- Double-check: drop any accidental policies if they exist
DROP POLICY IF EXISTS "user_roles: insert" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles: update" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles: delete" ON public.user_roles;
