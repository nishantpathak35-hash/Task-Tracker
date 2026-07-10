-- =========================================================
-- Invite flow: pending_invites table + modified handle_new_user()
-- =========================================================

-- 1. Create pending_invites table
CREATE TABLE public.pending_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'employee',
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  invited_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);
CREATE INDEX ON public.pending_invites(email);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_invites TO authenticated;
GRANT ALL ON public.pending_invites TO service_role;
ALTER TABLE public.pending_invites ENABLE ROW LEVEL SECURITY;

-- Only super_admins in the same org can see/manage invites
CREATE POLICY "invites: admin read own org" ON public.pending_invites
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "invites: admin manage own org" ON public.pending_invites
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role(auth.uid(), 'super_admin'));

-- 2. Modify handle_new_user() to check for pending invites
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_dept_id uuid;
  v_role public.app_role;
  v_name text;
  v_invite record;
BEGIN
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);

  -- Check if there's a pending invite for this email
  SELECT * INTO v_invite
  FROM public.pending_invites
  WHERE email = NEW.email
  LIMIT 1;

  IF v_invite IS NOT NULL THEN
    -- Invited user: join the existing org with the assigned role/department
    v_org_id := v_invite.org_id;
    v_dept_id := v_invite.department_id;
    v_role := v_invite.role;

    INSERT INTO public.profiles (id, org_id, department_id, full_name)
    VALUES (NEW.id, v_org_id, v_dept_id, v_name);

    -- Grant the assigned role
    INSERT INTO public.user_roles (user_id, role, org_id) VALUES (NEW.id, v_role, v_org_id);
    -- Always grant employee as base role if assigned something higher
    IF v_role <> 'employee' THEN
      INSERT INTO public.user_roles (user_id, role, org_id) VALUES (NEW.id, 'employee', v_org_id)
        ON CONFLICT DO NOTHING;
    END IF;
    -- If manager, also grant manager
    IF v_role = 'super_admin' THEN
      INSERT INTO public.user_roles (user_id, role, org_id) VALUES (NEW.id, 'manager', v_org_id)
        ON CONFLICT DO NOTHING;
    END IF;

    -- Consume the invite
    DELETE FROM public.pending_invites WHERE id = v_invite.id;
  ELSE
    -- No invite: create a brand-new org (original behavior)
    INSERT INTO public.organizations (name)
    VALUES (COALESCE(NEW.raw_user_meta_data->>'org_name', v_name || '''s Workspace'))
    RETURNING id INTO v_org_id;

    INSERT INTO public.departments (org_id, name, manager_id)
    VALUES (v_org_id, 'General', NEW.id)
    RETURNING id INTO v_dept_id;

    INSERT INTO public.profiles (id, org_id, department_id, full_name)
    VALUES (NEW.id, v_org_id, v_dept_id, v_name);

    INSERT INTO public.user_roles (user_id, role, org_id) VALUES (NEW.id, 'super_admin', v_org_id);
    INSERT INTO public.user_roles (user_id, role, org_id) VALUES (NEW.id, 'manager', v_org_id);
    INSERT INTO public.user_roles (user_id, role, org_id) VALUES (NEW.id, 'employee', v_org_id);
  END IF;

  RETURN NEW;
END;
$$;
