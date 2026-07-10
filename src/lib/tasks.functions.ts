import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const priorityEnum = z.enum(["low", "medium", "high", "critical", "blocker"]);
const statusEnum = z.enum([
  "draft",
  "assigned",
  "in_progress",
  "waiting_review",
  "completed",
  "approved",
  "rejected",
  "cancelled",
  "overdue",
]);

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  priority: priorityEnum.default("medium"),
  status: statusEnum.default("assigned"),
  assigned_to: z.string().uuid().optional().nullable(),
  approver_id: z.string().uuid().optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  expected_hours: z.number().min(0).max(1000).optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  checklist: z
    .array(z.object({ label: z.string().min(1).max(200), is_mandatory: z.boolean().default(true) }))
    .max(50)
    .default([]),
});

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data: profile, error: pe } = await sb.from("profiles").select("org_id,department_id").eq("id", userId).maybeSingle();
    if (pe || !profile?.org_id) throw new Error("No workspace");

    // Item 5: Employees can only assign tasks to themselves
    const { data: userRoles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    const roleList = (userRoles ?? []).map((r: { role: string }) => r.role);
    const isManagerOrAdmin = roleList.includes("super_admin") || roleList.includes("manager");
    if (!isManagerOrAdmin && data.assigned_to && data.assigned_to !== userId) {
      throw new Error("Employees can only assign tasks to themselves");
    }

    const { checklist, ...task } = data;
    const { data: created, error } = await sb
      .from("tasks")
      .insert({
        ...task,
        org_id: profile.org_id,
        department_id: task.department_id ?? profile.department_id ?? null,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    if (checklist.length) {
      await sb.from("task_checklist_items").insert(
        checklist.map((c, i) => ({ task_id: created.id, label: c.label, is_mandatory: c.is_mandatory, sort_order: i })),
      );
    }

    await sb.from("task_activity").insert({ task_id: created.id, actor_id: userId, event: "created", payload: { title: created.title } });

    if (task.assigned_to && task.assigned_to !== userId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: notifError } = await supabaseAdmin.from("notifications").insert({
        user_id: task.assigned_to,
        org_id: profile.org_id,
        type: "task_assigned",
        title: "New task assigned",
        body: created.title,
        entity_type: "task",
        entity_id: created.id,
      });
      if (notifError) console.error("[notifications] Failed to insert task_assigned:", notifError);

      // Send email notification
      try {
        const { data: assigneeProfile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("id", task.assigned_to)
          .maybeSingle();
        if (assigneeProfile) {
          const { data: assigneeAuth } = await supabaseAdmin.auth.admin.getUserById(task.assigned_to);
          if (assigneeAuth?.user?.email) {
            const { sendTaskAssignedEmail } = await import("@/lib/email.server");
            await sendTaskAssignedEmail(assigneeAuth.user.email, created.title, created.id);
          }
        }
      } catch (emailErr) {
        console.error("[email] Failed to send task_assigned email:", emailErr);
      }
    }

    return created;
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  patch: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    priority: priorityEnum.optional(),
    status: statusEnum.optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    approver_id: z.string().uuid().nullable().optional(),
    due_date: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    expected_hours: z.number().min(0).max(1000).nullable().optional(),
    actual_hours: z.number().min(0).max(1000).nullable().optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
  }),
});

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const patch = { ...data.patch };
    if (patch.status === "completed") {
      // enforce mandatory checklist done
      const { data: incomplete } = await sb
        .from("task_checklist_items")
        .select("id")
        .eq("task_id", data.id)
        .eq("is_mandatory", true)
        .eq("done", false);
      if (incomplete && incomplete.length > 0) {
        throw new Error("All mandatory checklist items must be completed first");
      }
      (patch as { completed_at?: string }).completed_at = new Date().toISOString();
    }
    const { data: updated, error } = await sb.from("tasks").update(patch).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);

    await sb.from("task_activity").insert({
      task_id: data.id,
      actor_id: userId,
      event: "updated",
      payload: patch as Record<string, unknown>,
    });

    // notify approver on review request
    if (patch.status === "waiting_review" && updated.approver_id) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: notifError } = await supabaseAdmin.from("notifications").insert({
        user_id: updated.approver_id,
        org_id: updated.org_id,
        type: "approval_requested",
        title: "Approval requested",
        body: updated.title,
        entity_type: "task",
        entity_id: updated.id,
      });
      if (notifError) console.error("[notifications] Failed to insert approval_requested:", notifError);
    }
    return updated;
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { error } = await sb.from("tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ task_id: z.string().uuid(), body: z.string().min(1).max(2000), parent_comment_id: z.string().uuid().optional().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data: created, error } = await sb
      .from("task_comments")
      .insert({ ...data, author_id: context.userId })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Parse @mentions and notify mentioned users
    const mentionPattern = /@(\w[\w\s]*?\w|\w)/g;
    const mentions = [...data.body.matchAll(mentionPattern)].map((m) => m[1].trim());

    if (mentions.length > 0) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Get task info for notification
        const { data: task } = await sb.from("tasks").select("title,org_id").eq("id", data.task_id).maybeSingle();

        // Get the commenter's name
        const { data: commenterProfile } = await sb.from("profiles").select("full_name").eq("id", context.userId).maybeSingle();
        const commenterName = commenterProfile?.full_name || "Someone";

        // Look up mentioned users by name
        const { data: profiles } = await sb
          .from("profiles")
          .select("id,full_name")
          .not("id", "eq", context.userId);

        for (const mention of mentions) {
          const matchedUser = (profiles ?? []).find(
            (p: { id: string; full_name: string | null }) =>
              p.full_name && p.full_name.toLowerCase().includes(mention.toLowerCase()),
          );

          if (matchedUser && task) {
            await supabaseAdmin.from("notifications").insert({
              user_id: matchedUser.id,
              org_id: task.org_id,
              type: "mention",
              title: `${commenterName} mentioned you`,
              body: task.title,
              entity_type: "task",
              entity_id: data.task_id,
            });

            // Send email notification for mention
            try {
              const { data: mentionedAuth } = await supabaseAdmin.auth.admin.getUserById(matchedUser.id);
              if (mentionedAuth?.user?.email) {
                const { sendMentionEmail } = await import("@/lib/email.server");
                await sendMentionEmail(mentionedAuth.user.email, commenterName, task.title, data.body);
              }
            } catch (emailErr) {
              console.error("[email] Failed to send mention email:", emailErr);
            }
          }
        }
      } catch (mentionErr) {
        console.error("[mentions] Failed to process mentions:", mentionErr);
      }
    }

    return created;
  });

export const toggleChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), done: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const patch = data.done
      ? { done: true, done_by: context.userId, done_at: new Date().toISOString() }
      : { done: false, done_by: null, done_at: null };
    const { error } = await sb.from("task_checklist_items").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
