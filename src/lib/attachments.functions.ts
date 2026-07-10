import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Record a file attachment after client-side upload to storage.
 */
export const recordAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        task_id: z.string().uuid(),
        storage_path: z.string().min(1),
        filename: z.string().min(1).max(500),
        mime: z.string().max(200).optional().nullable(),
        size_bytes: z.number().int().min(0).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;

    // Get current max version for this filename on this task
    const { data: existing } = await sb
      .from("task_attachments")
      .select("version")
      .eq("task_id", data.task_id)
      .eq("filename", data.filename)
      .order("version", { ascending: false })
      .limit(1);

    const nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;

    const { data: attachment, error } = await sb
      .from("task_attachments")
      .insert({
        task_id: data.task_id,
        storage_path: data.storage_path,
        filename: data.filename,
        mime: data.mime ?? null,
        size_bytes: data.size_bytes ?? null,
        version: nextVersion,
        uploaded_by: context.userId,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    // Log activity
    await sb.from("task_activity").insert({
      task_id: data.task_id,
      actor_id: context.userId,
      event: "attachment_added",
      payload: { filename: data.filename, version: nextVersion },
    });

    return attachment;
  });

/**
 * Delete an attachment record (and optionally the storage file).
 */
export const deleteAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;

    // Get attachment details first
    const { data: attachment } = await sb
      .from("task_attachments")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();

    if (!attachment) throw new Error("Attachment not found");

    // Delete from storage
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from("task-files").remove([attachment.storage_path]);

    // Delete record
    const { error } = await sb.from("task_attachments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
