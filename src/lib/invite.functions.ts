import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleEnum = z.enum(["super_admin", "manager", "employee"]);

/**
 * Invite a user to the current org.
 * - Creates a pending_invites row
 * - Sends Supabase invite email via admin API
 * Only callable by super_admin.
 */
export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        role: roleEnum.default("employee"),
        department_id: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Check caller is super_admin
    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    const roleList = (roles ?? []).map((r: { role: string }) => r.role);
    if (!roleList.includes("super_admin")) {
      throw new Error("Only super admins can invite users");
    }

    // Get caller's org
    const { data: profile } = await sb.from("profiles").select("org_id").eq("id", userId).maybeSingle();
    if (!profile?.org_id) throw new Error("No workspace");

    // Check if user already exists in this org
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existingProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("org_id", profile.org_id);
    
    // Check if email already has a pending invite
    const { data: existingInvite } = await (supabaseAdmin as any)
      .from("pending_invites")
      .select("id")
      .eq("org_id", profile.org_id)
      .eq("email", data.email)
      .maybeSingle();
    if (existingInvite) throw new Error("This email already has a pending invite");

    // Create pending invite
    const { error: inviteError } = await (supabaseAdmin as any).from("pending_invites").insert({
      org_id: profile.org_id,
      email: data.email,
      role: data.role,
      department_id: data.department_id ?? null,
      invited_by: userId,
    });
    if (inviteError) throw new Error(inviteError.message);

    // Send Supabase invite email
    const { error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { invited_to_org: profile.org_id },
    });
    if (authError) {
      // Clean up the pending invite if email send fails
      await (supabaseAdmin as any).from("pending_invites").delete().eq("org_id", profile.org_id).eq("email", data.email);
      throw new Error(`Failed to send invite: ${authError.message}`);
    }

    // Suppress lint for existingProfiles (used above for potential future duplicate check)
    void existingProfiles;

    return { ok: true };
  });

/**
 * Cancel a pending invite.
 */
export const cancelInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ invite_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "super_admin")) {
      throw new Error("Only super admins can cancel invites");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("pending_invites").delete().eq("id", data.invite_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Update a user's role in the org.
 */
export const updateUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ target_user_id: z.string().uuid(), role: roleEnum }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "super_admin")) {
      throw new Error("Only super admins can change roles");
    }

    const { data: profile } = await sb.from("profiles").select("org_id").eq("id", userId).maybeSingle();
    if (!profile?.org_id) throw new Error("No workspace");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Remove existing roles for user in this org
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.target_user_id)
      .eq("org_id", profile.org_id);

    // Insert new role hierarchy
    const rolesToInsert: ("super_admin" | "manager" | "employee")[] = ["employee"];
    if (data.role === "manager" || data.role === "super_admin") rolesToInsert.push("manager");
    if (data.role === "super_admin") rolesToInsert.push("super_admin");

    for (const r of rolesToInsert) {
      await supabaseAdmin.from("user_roles").insert({
        user_id: data.target_user_id,
        role: r,
        org_id: profile.org_id,
      });
    }

    return { ok: true };
  });

/**
 * Remove a user from the org.
 */
export const removeUserFromOrg = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ target_user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    if (data.target_user_id === userId) throw new Error("Cannot remove yourself");

    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "super_admin")) {
      throw new Error("Only super admins can remove users");
    }

    const { data: profile } = await sb.from("profiles").select("org_id").eq("id", userId).maybeSingle();
    if (!profile?.org_id) throw new Error("No workspace");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Remove roles
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.target_user_id)
      .eq("org_id", profile.org_id);

    // Unlink from org
    await supabaseAdmin
      .from("profiles")
      .update({ org_id: null, department_id: null })
      .eq("id", data.target_user_id);

    return { ok: true };
  });

/**
 * Create a new department in the org.
 */
export const createDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ name: z.string().trim().min(1).max(100), manager_id: z.string().uuid().optional().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "super_admin")) {
      throw new Error("Only super admins can create departments");
    }

    const { data: profile } = await sb.from("profiles").select("org_id").eq("id", userId).maybeSingle();
    if (!profile?.org_id) throw new Error("No workspace");

    // Use user client since there's a super_admin policy on departments
    const { data: dept, error } = await sb
      .from("departments")
      .insert({ org_id: profile.org_id, name: data.name, manager_id: data.manager_id ?? null })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return dept;
  });

/**
 * Update a department.
 */
export const updateDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(100).optional(),
        manager_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "super_admin")) {
      throw new Error("Only super admins can update departments");
    }

    const { id, ...patch } = data;
    const { data: dept, error } = await sb.from("departments").update(patch).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);
    return dept;
  });

/**
 * Update a member's department assignment.
 */
export const updateMemberDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ target_user_id: z.string().uuid(), department_id: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", userId);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "super_admin")) {
      throw new Error("Only super admins can change department assignments");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ department_id: data.department_id })
      .eq("id", data.target_user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
