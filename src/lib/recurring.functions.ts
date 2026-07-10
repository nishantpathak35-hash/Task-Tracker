import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Freq = "daily" | "weekly" | "monthly" | "quarterly" | "half_yearly" | "yearly" | "cron";

function advance(from: Date, freq: Freq): Date {
  const d = new Date(from);
  switch (freq) {
    case "daily": d.setDate(d.getDate() + 1); break;
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "half_yearly": d.setMonth(d.getMonth() + 6); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
    default: d.setMonth(d.getMonth() + 1);
  }
  return d;
}

function nextOccurrence(freq: Freq, dayOfPeriod: number | null): Date {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), dayOfPeriod ?? now.getDate());
  if (target < now) return advance(target, freq);
  return target;
}

export const enableComplianceTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ template_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId, supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const { data: profile } = await sb.from("profiles").select("org_id,department_id").eq("id", userId).maybeSingle();
    if (!profile?.org_id) throw new Error("No workspace");

    const { data: tpl, error: te } = await sb
      .from("compliance_templates")
      .select("*")
      .eq("id", data.template_id)
      .maybeSingle();
    if (te || !tpl) throw new Error("Template not found");

    // Check if already enabled for this org
    const { data: existing } = await sb
      .from("recurring_rules")
      .select("id")
      .eq("org_id", profile.org_id)
      .eq("active", true)
      .contains("template_task", { compliance_template_id: tpl.id });
    if (existing && existing.length > 0) throw new Error("Already enabled for your workspace");

    const first = nextOccurrence(tpl.cadence as Freq, tpl.day_of_period);
    const templateTask = {
      compliance_template_id: tpl.id,
      title: tpl.title,
      description: tpl.description,
      priority: tpl.mandatory ? "high" : "medium",
      tags: ["compliance", tpl.category],
      department_id: profile.department_id,
    };

    const { data: rule, error: re } = await sb
      .from("recurring_rules")
      .insert({
        org_id: profile.org_id,
        frequency: tpl.cadence,
        template_task: templateTask,
        next_run_at: first.toISOString(),
        active: true,
        created_by: userId,
      })
      .select("*")
      .single();
    if (re) throw new Error(re.message);

    // Materialize the first task immediately so it shows up on the calendar
    const dueDate = first.toISOString().slice(0, 10);
    const { data: created, error: ce } = await sb
      .from("tasks")
      .insert({
        org_id: profile.org_id,
        department_id: profile.department_id,
        title: templateTask.title,
        description: templateTask.description,
        priority: templateTask.priority,
        status: "assigned",
        created_by: userId,
        due_date: dueDate,
        tags: templateTask.tags,
        recurring_rule_id: rule.id,
      })
      .select("id")
      .single();
    if (ce) throw new Error(ce.message);

    // Advance the rule
    const nextAfter = advance(first, tpl.cadence as Freq);
    await sb.from("recurring_rules").update({ next_run_at: nextAfter.toISOString() }).eq("id", rule.id);

    return { rule_id: rule.id, task_id: created.id };
  });

export const disableRecurringRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { error } = await sb.from("recurring_rules").update({ active: false }).eq("id", data.rule_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const materializeDueRecurring = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data: profile } = await sb.from("profiles").select("org_id").eq("id", userId).maybeSingle();
    if (!profile?.org_id) throw new Error("No workspace");

    const nowIso = new Date().toISOString();
    const { data: rules } = await sb
      .from("recurring_rules")
      .select("*")
      .eq("org_id", profile.org_id)
      .eq("active", true)
      .lte("next_run_at", nowIso);

    let created = 0;
    for (const r of rules ?? []) {
      const t = r.template_task as Record<string, unknown>;
      const runAt = new Date(r.next_run_at);
      const dueDate = runAt.toISOString().slice(0, 10);
      const { error } = await sb.from("tasks").insert({
        org_id: r.org_id,
        department_id: (t.department_id as string) ?? null,
        title: (t.title as string) ?? "Recurring task",
        description: (t.description as string) ?? null,
        priority: (t.priority as string) ?? "medium",
        status: "assigned",
        created_by: userId,
        due_date: dueDate,
        tags: (t.tags as string[]) ?? [],
        recurring_rule_id: r.id,
      });
      if (!error) {
        created += 1;
        const next = advance(runAt, r.frequency as Freq);
        await sb.from("recurring_rules").update({ next_run_at: next.toISOString() }).eq("id", r.id);
      }
    }
    return { created };
  });

export const globalSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ q: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const q = data.q.replace(/[%_]/g, (m) => `\\${m}`);
    const [tasksRes, projectsRes, peopleRes] = await Promise.all([
      sb.from("tasks").select("id,title,status,priority,due_date").ilike("title", `%${q}%`).limit(8),
      sb.from("projects").select("id,name").ilike("name", `%${q}%`).limit(5),
      sb.from("profiles").select("id,full_name,designation").ilike("full_name", `%${q}%`).limit(5),
    ]);
    return {
      tasks: tasksRes.data ?? [],
      projects: projectsRes.data ?? [],
      people: peopleRes.data ?? [],
    };
  });
