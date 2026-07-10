
-- =========================================================
-- TaskOps Phase 1 schema
-- =========================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('super_admin','manager','employee');
CREATE TYPE public.task_status AS ENUM ('draft','assigned','in_progress','waiting_review','completed','approved','rejected','cancelled','overdue');
CREATE TYPE public.task_priority AS ENUM ('low','medium','high','critical','blocker');
CREATE TYPE public.recur_frequency AS ENUM ('daily','weekly','monthly','quarterly','half_yearly','yearly','cron');
CREATE TYPE public.compliance_category AS ENUM ('GST','TDS','IncomeTax','ROC','Payroll','PF','ESI','BoardMeeting','Audit','VendorPayment','FinancialClosing','Other');

-- =========================================================
-- CORE TENANCY
-- =========================================================
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'trial',
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  currency text NOT NULL DEFAULT 'INR',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  manager_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.departments(org_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  full_name text,
  avatar_url text,
  designation text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.profiles(org_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, org_id)
);
CREATE INDEX ON public.user_roles(user_id);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- SECURITY DEFINER HELPERS
-- =========================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_department_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT department_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_manager_of(_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = _department_id AND d.manager_id = auth.uid()
  );
$$;

-- =========================================================
-- SIGNUP TRIGGER: create org + profile + super_admin on first user
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_dept_id uuid;
  v_name text;
BEGIN
  v_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);

  -- Every new signup starts their own org (multi-tenant safe default; admins can invite others later)
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- RLS POLICIES: tenancy core
-- =========================================================
CREATE POLICY "orgs: members read own org" ON public.organizations
  FOR SELECT TO authenticated USING (id = public.current_org_id());
CREATE POLICY "orgs: super_admin update own org" ON public.organizations
  FOR UPDATE TO authenticated USING (id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "departments: read own org" ON public.departments
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "departments: super_admin manage" ON public.departments
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "profiles: read own org" ON public.profiles
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "profiles: self update" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles: super_admin manage org" ON public.profiles
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "user_roles: read own" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'super_admin'));

-- =========================================================
-- PROJECTS
-- =========================================================
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.projects(org_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects: read own org" ON public.projects
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "projects: managers/admins write" ON public.projects
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'manager')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'manager')));

-- =========================================================
-- TASKS
-- =========================================================
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  priority public.task_priority NOT NULL DEFAULT 'medium',
  status public.task_status NOT NULL DEFAULT 'assigned',
  created_by uuid REFERENCES auth.users(id),
  assigned_to uuid REFERENCES auth.users(id),
  approver_id uuid REFERENCES auth.users(id),
  start_date date,
  due_date date,
  expected_hours numeric(6,2),
  actual_hours numeric(6,2),
  tags text[] NOT NULL DEFAULT '{}',
  parent_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  recurring_rule_id uuid,
  escalation_days int NOT NULL DEFAULT 2,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.tasks(org_id);
CREATE INDEX ON public.tasks(assigned_to);
CREATE INDEX ON public.tasks(status);
CREATE INDEX ON public.tasks(due_date);
CREATE INDEX ON public.tasks(department_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "tasks: org members read" ON public.tasks
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "tasks: create in own org" ON public.tasks
  FOR INSERT TO authenticated WITH CHECK (org_id = public.current_org_id());
CREATE POLICY "tasks: assignee/creator/manager/admin update" ON public.tasks
  FOR UPDATE TO authenticated
  USING (org_id = public.current_org_id() AND (
    assigned_to = auth.uid() OR created_by = auth.uid() OR approver_id = auth.uid()
    OR public.has_role(auth.uid(),'super_admin')
    OR (public.has_role(auth.uid(),'manager') AND department_id IS NOT DISTINCT FROM public.current_department_id())
  ));
CREATE POLICY "tasks: manager/admin delete" ON public.tasks
  FOR DELETE TO authenticated
  USING (org_id = public.current_org_id() AND (public.has_role(auth.uid(),'super_admin') OR (public.has_role(auth.uid(),'manager') AND department_id IS NOT DISTINCT FROM public.current_department_id())));

-- =========================================================
-- CHECKLIST ITEMS
-- =========================================================
CREATE TABLE public.task_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  label text NOT NULL,
  is_mandatory boolean NOT NULL DEFAULT true,
  done boolean NOT NULL DEFAULT false,
  done_by uuid REFERENCES auth.users(id),
  done_at timestamptz,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.task_checklist_items(task_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_checklist_items TO authenticated;
GRANT ALL ON public.task_checklist_items TO service_role;
ALTER TABLE public.task_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist: through task" ON public.task_checklist_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()));

-- =========================================================
-- COMMENTS
-- =========================================================
CREATE TABLE public.task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  parent_comment_id uuid REFERENCES public.task_comments(id) ON DELETE CASCADE,
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.task_comments(task_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments: read via task" ON public.task_comments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()));
CREATE POLICY "comments: author write" ON public.task_comments
  FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "comments: author edit" ON public.task_comments
  FOR UPDATE TO authenticated USING (author_id = auth.uid());
CREATE POLICY "comments: author delete" ON public.task_comments
  FOR DELETE TO authenticated USING (author_id = auth.uid() OR public.has_role(auth.uid(),'super_admin'));

-- =========================================================
-- ATTACHMENTS
-- =========================================================
CREATE TABLE public.task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime text,
  size_bytes bigint,
  version int NOT NULL DEFAULT 1,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.task_attachments(task_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_attachments TO authenticated;
GRANT ALL ON public.task_attachments TO service_role;
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attachments: via task" ON public.task_attachments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()));

-- =========================================================
-- DEPENDENCIES
-- =========================================================
CREATE TABLE public.task_dependencies (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_task_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_dependencies TO authenticated;
GRANT ALL ON public.task_dependencies TO service_role;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deps: via task" ON public.task_dependencies
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()));

-- =========================================================
-- ACTIVITY LOG
-- =========================================================
CREATE TABLE public.task_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  event text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.task_activity(task_id);
GRANT SELECT, INSERT ON public.task_activity TO authenticated;
GRANT ALL ON public.task_activity TO service_role;
ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity: via task" ON public.task_activity
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.org_id = public.current_org_id()));
CREATE POLICY "activity: insert self" ON public.task_activity
  FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());

-- =========================================================
-- NOTIFICATIONS
-- =========================================================
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.notifications(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications: own read" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications: own update" ON public.notifications
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications: create in org" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (org_id = public.current_org_id());

-- =========================================================
-- RECURRING RULES
-- =========================================================
CREATE TABLE public.recurring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_task jsonb NOT NULL,
  frequency public.recur_frequency NOT NULL,
  cron text,
  next_run_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_rules TO authenticated;
GRANT ALL ON public.recurring_rules TO service_role;
ALTER TABLE public.recurring_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recurring: read own org" ON public.recurring_rules
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "recurring: manager/admin write" ON public.recurring_rules
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'manager')))
  WITH CHECK (org_id = public.current_org_id() AND (public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'manager')));

-- =========================================================
-- HOLIDAYS
-- =========================================================
CREATE TABLE public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  name text NOT NULL,
  UNIQUE (org_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;
GRANT ALL ON public.holidays TO service_role;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holidays: read own org" ON public.holidays
  FOR SELECT TO authenticated USING (org_id = public.current_org_id());
CREATE POLICY "holidays: admin write" ON public.holidays
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'));

-- =========================================================
-- COMPLIANCE TEMPLATES (global rows have org_id NULL)
-- =========================================================
CREATE TABLE public.compliance_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  category public.compliance_category NOT NULL,
  title text NOT NULL,
  description text,
  cadence public.recur_frequency NOT NULL,
  day_of_period int,
  mandatory boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_templates TO authenticated;
GRANT ALL ON public.compliance_templates TO service_role;
ALTER TABLE public.compliance_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compliance: read global or own org" ON public.compliance_templates
  FOR SELECT TO authenticated USING (org_id IS NULL OR org_id = public.current_org_id());
CREATE POLICY "compliance: admin write own org" ON public.compliance_templates
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (org_id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'));

-- Seed India compliance templates (global)
INSERT INTO public.compliance_templates (org_id, category, title, description, cadence, day_of_period, mandatory) VALUES
  (NULL,'GST','GSTR-1 Filing','Monthly outward supplies return','monthly',11,true),
  (NULL,'GST','GSTR-3B Filing','Monthly summary return and tax payment','monthly',20,true),
  (NULL,'TDS','TDS Payment','Monthly TDS deposit','monthly',7,true),
  (NULL,'TDS','TDS Return','Quarterly TDS return (Form 24Q/26Q)','quarterly',31,true),
  (NULL,'PF','EPF Contribution','Provident Fund monthly payment & ECR','monthly',15,true),
  (NULL,'ESI','ESI Contribution','Employee State Insurance monthly payment','monthly',15,true),
  (NULL,'IncomeTax','Advance Tax','Quarterly advance tax installment','quarterly',15,true),
  (NULL,'Payroll','Monthly Payroll Run','Salary processing and disbursement','monthly',1,true),
  (NULL,'ROC','Annual ROC Filing (AOC-4 / MGT-7)','Annual company filings with MCA','yearly',30,true),
  (NULL,'Audit','Annual Statutory Audit','Complete statutory audit','yearly',30,true),
  (NULL,'BoardMeeting','Quarterly Board Meeting','Board of Directors meeting','quarterly',30,true),
  (NULL,'VendorPayment','Vendor Payment Cycle','Weekly vendor payment review','weekly',5,false),
  (NULL,'FinancialClosing','Month-End Closing','Close books for the month','monthly',5,true),
  (NULL,'FinancialClosing','Year-End Closing','Close books for financial year','yearly',30,true);

-- =========================================================
-- AUDIT LOG
-- =========================================================
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  diff jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.audit_logs(org_id, created_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit: admins read own org" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (org_id = public.current_org_id() AND public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "audit: insert self" ON public.audit_logs
  FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid() AND org_id = public.current_org_id());

-- =========================================================
-- OVERDUE ENGINE (scheduled)
-- =========================================================
CREATE OR REPLACE FUNCTION public.mark_overdue_tasks()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, org_id, assigned_to, title, department_id
    FROM public.tasks
    WHERE due_date < CURRENT_DATE
      AND status NOT IN ('completed','approved','cancelled','overdue')
  LOOP
    UPDATE public.tasks SET status = 'overdue' WHERE id = r.id;
    IF r.assigned_to IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, org_id, type, title, body, entity_type, entity_id)
      VALUES (r.assigned_to, r.org_id, 'task_overdue', 'Task overdue', r.title, 'task', r.id);
    END IF;
    -- Notify department manager
    INSERT INTO public.notifications (user_id, org_id, type, title, body, entity_type, entity_id)
    SELECT d.manager_id, r.org_id, 'task_overdue_manager', 'Team task overdue', r.title, 'task', r.id
    FROM public.departments d WHERE d.id = r.department_id AND d.manager_id IS NOT NULL AND d.manager_id <> COALESCE(r.assigned_to,'00000000-0000-0000-0000-000000000000'::uuid);
  END LOOP;
END; $$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- pg_cron: run every 15 minutes
SELECT cron.schedule('taskops-mark-overdue', '*/15 * * * *', $$ SELECT public.mark_overdue_tasks(); $$);
