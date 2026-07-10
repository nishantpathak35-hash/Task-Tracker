# TaskOps — Full Remediation Prompt

> Paste this whole thing into Lovable (or Claude Code working on this repo) as one instruction. It is ordered by priority — do NOT skip Phase 0, the app is currently broken/insecure without it.

---

## Context

This is the TaskOps project (TanStack Start + React + Supabase). An audit found critical security/functional bugs, missing features from the original plan (`.lovable/plan.md`), and several UI/logic gaps. Fix everything below, in order, and after each phase run the app and verify with a real signup + second invited user before moving on.

---

## PHASE 0 — Fix what's currently broken (blocking, do first)

1. **RLS helper functions lost EXECUTE permission for `authenticated`.**
   Migration `20260710101253_...sql` runs:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.has_role(...) FROM PUBLIC, anon, authenticated;
   REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM PUBLIC, anon, authenticated;
   REVOKE EXECUTE ON FUNCTION public.current_department_id() FROM PUBLIC, anon, authenticated;
   REVOKE EXECUTE ON FUNCTION public.is_manager_of(uuid) FROM PUBLIC, anon, authenticated;
   ```
   These functions are called *inside* RLS policies on nearly every table. The role executing the query (`authenticated`) needs EXECUTE on them regardless of SECURITY DEFINER — SECURITY DEFINER only changes what the function body can access, not who may call it. Write a new migration that re-grants:
   ```sql
   GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
   GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
   GRANT EXECUTE ON FUNCTION public.current_department_id() TO authenticated;
   GRANT EXECUTE ON FUNCTION public.is_manager_of(uuid) TO authenticated;
   ```
   Keep them revoked from `anon` and `PUBLIC` — only `authenticated` and `service_role`/`postgres` should have EXECUTE. Test every table's SELECT/INSERT/UPDATE with a logged-in user afterward to confirm no "permission denied for function" errors remain.

2. **Notifications INSERT policy was removed but application code still inserts as the user.**
   `src/lib/tasks.functions.ts` (`createTask`, `updateTask`) inserts into `notifications` using the RLS-bound user client, but the only remaining path for notification inserts is `service_role`. Fix by moving all `notifications` inserts in server functions to use `supabaseAdmin` (`@/integrations/supabase/client.server`) instead of the request-scoped `supabase` client — import it inside the handler (`const { supabaseAdmin } = await import("@/integrations/supabase/client.server")`), not at module top level. Add real error handling (`if (error) console.error(...)`) instead of silently swallowing failures.

3. **No way for a second person to ever join an organization.**
   `handle_new_user()` always creates a brand-new org per signup. Build a real invite flow:
   - New `SECURITY DEFINER` server fn `inviteUser({ email, role, department_id })`, callable only by `super_admin` (check via `has_role`), that uses `supabaseAdmin.auth.admin.inviteUserByEmail()` and pre-creates a `user_roles` + `profiles` row (or a pending-invite table) scoped to the inviting admin's `org_id`.
   - Modify `handle_new_user()` to check for a pending invite (e.g. a `pending_invites` table keyed by email) and attach the new user to that org/department/role instead of always creating a new org.
   - Build the actual Admin UI: invite-by-email form, role assignment dropdown, department create/edit, and a page for reviewing/removing members — `admin.tsx` is currently 100% read-only.

---

## PHASE 1 — Security & authorization hardening

4. Restrict `tasks` SELECT policy so **row visibility matches the plan's role model**, not just org-wide:
   - employee: `assigned_to = auth.uid() OR created_by = auth.uid()`
   - manager: add `department_id = current_department_id()`
   - super_admin: full org (current behavior)
   Implement via `has_role()` branching in the policy, same pattern already used for UPDATE/DELETE.
5. Restrict task **creation** so only `manager`/`super_admin` can assign a task to someone other than themselves; employees may only create tasks with `assigned_to = auth.uid()` unless a manager/admin.
6. Add server-side + RLS guard so `department_id`/role assignment on `user_roles` can only ever be written by `service_role` / an admin-only server fn — there should be no path for a client to self-assign roles.
7. Add role-based route guards: `/admin` and `/team` should redirect (or show an access-denied state) for users without `super_admin`/`manager` role, both in the router `beforeLoad` and by hiding the nav items in `app-sidebar.tsx` for users who lack the role (fetch roles once via `useMe()` and filter the `nav` array).
8. Double check `.env` is actually excluded from version control (add `.env` explicitly to `.gitignore`, it's currently absent even though the file holds project identifiers).

---

## PHASE 2 — Missing Phase-1 features from the plan

9. **Email notifications** — add the `resend` package, create a server-side `sendEmail()` helper, and fire emails on: task assigned, task overdue, approval requested, mention in comment. Wire a daily 8am IST digest via `pg_cron` calling a server endpoint.
10. **Automate the compliance/recurring engine** — schedule `materializeDueRecurring`'s logic as a `pg_cron` job (SECURITY DEFINER Postgres function, same pattern as `mark_overdue_tasks`) that runs every 15–30 min server-side, instead of relying on a user clicking "Generate due tasks".
11. **Attachments UI** — file upload/list/download/version history on the task detail page, using the existing `task-files` storage bucket and `task_attachments` table.
12. **Task dependencies UI** — simple "blocked by / blocks" picker + display on task detail.
13. **Threaded comments + @mentions** — reply-to UI using `parent_comment_id`, and parse `@name` mentions to create `notifications` rows for mentioned users.
14. **Kanban drag-and-drop** in `my-work.tsx`'s Board view (e.g. `@dnd-kit/core`) that calls `updateTask` on drop.
15. **Settings/Profile page** — let a user edit their own `full_name`, `avatar_url`, `designation`, `phone`.
16. **Reports export** — add `xlsx` and `@react-pdf/renderer`, implement XLSX and PDF export alongside the existing CSV export.
17. **Calendar** — add week/day view toggle, and overlay `holidays` table entries on the month grid.

---

## PHASE 3 — Logic & UX fixes

18. `team.tsx`: fix the "Completed" stat to actually filter by "completed today" (`completed_at` within today's date range) — it currently counts all-time completed tasks under a `completedToday` variable name.
19. `home.tsx`: remove the dead `void isPast; void parseISO;` and actually use them to highlight overdue tasks consistently with `calendar.tsx`.
20. Add pagination (or virtualized infinite scroll) to `my-work.tsx` and `calendar.tsx` instead of hard `.limit(500)/.limit(1000)` — currently older/extra tasks silently disappear once a workspace grows.
21. Disable/hide the "Completed" option in the task detail Status `<Select>` when mandatory checklist items are incomplete, instead of letting the user pick it and get a generic error toast.
22. Replace the native `confirm()` on task delete with a shadcn `AlertDialog` to match the rest of the app's UI language.
23. Make notification bell items clickable, deep-linking to `/tasks/$taskId`, and mark individual notifications as read on click (not just "mark all as read on popover close").
24. Add `assigned_to`, `department`, `tag`, and `date range` filters to `my-work.tsx` (plan requires assignee/dept/priority/status/tag/date-range filtering; only priority/status/search text exist today).
25. Add `department_id`, `project_id`, `approver_id`, and `tags` fields to `TaskDialog` — the backend schema already supports them but the create-task form doesn't expose them.

---

## Acceptance checklist before calling this "done"

- [ ] Fresh signup as User A → invite User B into the same org → User B actually lands in the same org/department with the assigned role.
- [ ] As an employee, cannot see another employee's private task (unless assigned/created/approver), cannot see Admin/Team nav.
- [ ] Creating a task as an employee auto-assigns to self only; as manager/admin can assign to anyone in dept/org.
- [ ] Task-assigned and overdue notifications actually appear (no more silent RLS failures on insert).
- [ ] Compliance filing enabled today will auto-generate its next occurrence without anyone touching the "Generate due tasks" button.
- [ ] Attachments can be uploaded and downloaded from a task.
- [ ] Reports page can export CSV, XLSX, and PDF.
- [ ] No `permission denied for function` errors anywhere in server logs.
