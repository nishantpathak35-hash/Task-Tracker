-- =========================================================
-- Automated recurring task materialization via pg_cron
-- =========================================================

-- SECURITY DEFINER function that materializes due recurring tasks
-- Runs independently of any user session — uses service_role context
CREATE OR REPLACE FUNCTION public.materialize_due_recurring()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_due_date date;
  v_next timestamptz;
BEGIN
  FOR r IN
    SELECT *
    FROM public.recurring_rules
    WHERE active = true
      AND next_run_at <= now()
  LOOP
    v_due_date := (r.next_run_at AT TIME ZONE 'UTC')::date;

    -- Create the task from the template
    INSERT INTO public.tasks (
      org_id, department_id, title, description,
      priority, status, due_date, tags, recurring_rule_id,
      created_by
    ) VALUES (
      r.org_id,
      (r.template_task->>'department_id')::uuid,
      COALESCE(r.template_task->>'title', 'Recurring task'),
      r.template_task->>'description',
      COALESCE(r.template_task->>'priority', 'medium')::public.task_priority,
      'assigned'::public.task_status,
      v_due_date,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(r.template_task->'tags')),
        '{}'::text[]
      ),
      r.id,
      r.created_by
    );

    -- Advance next_run_at based on frequency
    v_next := CASE r.frequency
      WHEN 'daily' THEN r.next_run_at + interval '1 day'
      WHEN 'weekly' THEN r.next_run_at + interval '7 days'
      WHEN 'monthly' THEN r.next_run_at + interval '1 month'
      WHEN 'quarterly' THEN r.next_run_at + interval '3 months'
      WHEN 'half_yearly' THEN r.next_run_at + interval '6 months'
      WHEN 'yearly' THEN r.next_run_at + interval '1 year'
      ELSE r.next_run_at + interval '1 month' -- default fallback
    END;

    UPDATE public.recurring_rules
    SET next_run_at = v_next
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- Revoke from public/anon — only postgres/service_role should call this
REVOKE EXECUTE ON FUNCTION public.materialize_due_recurring() FROM PUBLIC, anon, authenticated;

-- Schedule pg_cron job: every 15 minutes
SELECT cron.schedule(
  'taskops-materialize-recurring',
  '*/15 * * * *',
  $$ SELECT public.materialize_due_recurring(); $$
);
