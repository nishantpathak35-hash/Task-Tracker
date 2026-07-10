
# TaskOps — Enterprise Task & Operations Platform

Cloud-based platform for Finance / Compliance / HR / Legal / Ops teams. Built on the current stack (TanStack Start + React + TS + Tailwind + shadcn) with Lovable Cloud (Supabase under the hood) for auth, Postgres, RLS, Realtime, and Storage. Notifications start in-app + email; push/Firebase is Phase 3. Charts via Recharts (native shadcn-friendly) unless you require ECharts specifically.

Region: India — INR, IST, and preloaded GST / TDS / PF / ESI / ROC compliance templates.
Design: Asana / ClickUp-style — colorful accents, generous task surface, list + board + calendar views, sidebar nav, avatar-forward assignments.

---

## Phase 1 — Foundation (build first, in this order)

### 1.1 Database schema (Lovable Cloud)

Tables (all in `public`, RLS ON, GRANTs to `authenticated` + `service_role`):

- `organizations` — id, name, plan, timezone (default `Asia/Kolkata`), currency (`INR`).
- `departments` — id, org_id, name, manager_id.
- `profiles` — id (FK `auth.users`), org_id, full_name, avatar_url, department_id, designation, phone.
- `app_role` enum: `super_admin`, `manager`, `employee`.
- `user_roles` — (user_id, role) — separate table, per security rules. `has_role()` SECURITY DEFINER helper.
- `projects` — id, org_id, department_id, name, status.
- `tasks` — id, org_id, department_id, project_id, title, description, priority (`low|medium|high|critical|blocker`), status (`draft|assigned|in_progress|waiting_review|completed|approved|rejected|cancelled|overdue`), created_by, assigned_to, approver_id, start_date, due_date, expected_hours, actual_hours, tags text[], recurring_rule_id, parent_task_id, escalation_days, created_at, updated_at, completed_at.
- `task_checklist_items` — id, task_id, label, is_mandatory, done, done_by, done_at, sort_order.
- `task_comments` — id, task_id, author_id, body, parent_comment_id, edited_at, created_at. Mentions parsed from body.
- `task_attachments` — id, task_id, storage_path, filename, mime, size, uploaded_by, version.
- `task_dependencies` — task_id, depends_on_task_id.
- `task_activity` — id, task_id, actor_id, event, payload jsonb, created_at (audit trail).
- `recurring_rules` — id, org_id, template_task jsonb, frequency (`daily|weekly|monthly|quarterly|half_yearly|yearly|cron`), cron, next_run_at, active.
- `notifications` — id, user_id, type, title, body, entity_type, entity_id, read_at, created_at.
- `holidays` — org_id, date, name.
- `compliance_templates` — id, org_id (nullable = global), category (GST/TDS/PF/ESI/ROC/Payroll/Audit/BoardMeeting/VendorPayment/FinancialClosing), title, cadence, day_of_month/quarter, mandatory bool.
- `audit_logs` — id, org_id, actor_id, action, entity, entity_id, diff jsonb, ip, ua, created_at.

RLS policy shape:
- Row visibility scoped by `org_id = current_user's org`, then role-based expansion (employee sees own + assigned; manager sees their department; super_admin sees org).
- All checks go through `has_role()` — no recursive selects on the same table.

Storage bucket: `task-files` (private) with RLS on `storage.objects` scoped to task participants.

### 1.2 Auth + user management

- Email/password + Google (via Lovable OAuth broker) sign-in on public `/auth`.
- `_authenticated/` layout gate (managed).
- On first user in an org → seeded as `super_admin` with a demo org + department.
- Super Admin console: create departments, invite users (Auth Admin via a role-guarded server fn), assign managers, assign roles.

### 1.3 App shell

Layout: collapsible sidebar (Home / My Work / Team / Calendar / Compliance / Reports / Admin) + top bar (global search, notifications bell, avatar menu).

Routes (`src/routes/`):
```
_authenticated/
  index.tsx           → employee dashboard (Today)
  my-work.tsx         → list + board + calendar
  tasks.$taskId.tsx   → task detail drawer/page
  team.tsx            → manager: workload + team tasks
  calendar.tsx        → daily/weekly/monthly + compliance overlay
  compliance.tsx      → templates + upcoming filings
  reports.tsx         → dept / employee / delay / compliance
  admin/
    users.tsx
    departments.tsx
    roles.tsx
    holidays.tsx
    audit.tsx
auth.tsx              → sign-in / sign-up
```

### 1.4 Task engine (Phase 1 core)

- Task CRUD via `createServerFn` + `requireSupabaseAuth`.
- Views: **List**, **Board** (kanban by status), **Calendar** (by due date). Filters: assignee, dept, priority, status, tag, date range, overdue.
- Task detail: description (rich text), checklist, comments (threaded, @mentions), attachments (versioned in Storage), dependencies, activity log.
- Status transitions enforced server-side.
- Realtime subscription on `tasks` + `task_comments` so boards update live.

### 1.5 Smart Overdue Engine

- pg_cron job every 15 min: `UPDATE tasks SET status='overdue' WHERE due_date < now() AND status NOT IN ('completed','approved','cancelled')`.
- Same job inserts notifications + escalates after `escalation_days` (notifies approver + department manager).
- UI highlights overdue rows in red across all views.

### 1.6 Dashboards

**Employee Home (`/`)**: greeting, Today's Tasks, Due Today, Overdue, Upcoming (7d), Priority tasks, hours estimate, mini calendar, notifications feed, personal completion % (last 30d).

**Manager Dashboard (`/team`)**: team KPI cards (open, completed today, overdue, critical), workload bar per employee, top performers, employees needing attention, upcoming deadlines table, dept completion trend (Recharts line).

### 1.7 Notifications

- In-app bell (unread count, mark read, deep-links).
- Email via Resend (server fn on task assign / overdue / approval requested / mention). Secret added when we get there.
- Daily digest email at 8:00 IST (pg_cron → server fn).

**Phase 1 exit criteria:** an org can sign up, admin invites users, manager assigns tasks, employees complete them with checklist + files, overdue auto-flags, dashboards are real, emails fire.

---

## Phase 2 — Depth

### 2.1 Recurring tasks
- `recurring_rules` drives a pg_cron generator that materializes upcoming instances 30 days ahead.
- Frequencies: daily, weekly, monthly, quarterly, half-yearly, yearly, custom cron.
- UI to create from any existing task or from a compliance template.

### 2.2 Compliance module (India preload)
- Seed `compliance_templates` (global org_id null) with GSTR-1 (11th), GSTR-3B (20th), TDS payment (7th), TDS return quarterly, PF (15th), ESI (15th), ROC AOC-4/MGT-7 (annual), Advance Tax (quarterly), Payroll (monthly), Audit (annual), Board Meetings (quarterly).
- One-click "enable for my org" → creates recurring_rule + first instance.
- Compliance calendar overlay + "never miss" red banner if any active filing is within 3 days and not started.

### 2.3 Reports & exports
- Department, Employee, Delay, Compliance, Manager, Monthly/Quarterly/Yearly reports.
- Export CSV/XLSX (client-side via `xlsx`) and PDF (server fn via `@react-pdf/renderer`).

### 2.4 Global search
- Postgres `tsvector` across tasks, comments, attachments filename, projects, users. Server fn returns grouped results.

### 2.5 Performance engine
- Nightly job computes per-employee metrics: completion %, delay %, avg completion time, rework %, rejection %, quality score. Stored in `employee_performance_daily` for trend charts.

---

## Phase 3 — Intelligence

### 3.1 AI Daily Planner
Lovable AI Gateway (`google/gemini-2.5-flash`) via a `createServerFn`. Input: user's open tasks + hours + priorities + calendar. Output: greeting, ordered execution plan, likely delays, suggested schedule blocks.

### 3.2 AI analytics
- Predict at-risk tasks (features: days_to_due, priority, historical delay % of assignee, checklist completion).
- Workload balancer recommendation (LLM-assisted reassignment suggestions with one-click apply for managers).
- Weekly management report (auto-generated executive summary).
- Bottleneck detection on task_activity.

### 3.3 Integrations (stubs first)
- Google Calendar / Outlook (OAuth + ICS export now, two-way later).
- Slack / Teams / WhatsApp notifications.
- Drive / OneDrive / Dropbox attachment sources.

### 3.4 Firebase push
- FCM for browser + future mobile.

---

## Design language (Asana/ClickUp-style, enterprise-refined)

- Font pair: **Sora** (headings) + **Inter** (body). Confident, not childish.
- Palette: neutral surface + one strong accent per priority (blue=info, amber=medium, orange=high, red=critical, purple=blocker), status pills in muted tints. Dark + light mode via existing tokens.
- Density: comfortable in dashboards, compact in list view (toggle).
- Motion: 150–200ms tokened transitions, no bounces.
- Keyboard: `⌘K` command palette (later), `c` to create task, `/` to focus search.

---

## Non-functional

- All server logic through `createServerFn` (+ `requireSupabaseAuth`). Webhooks/cron endpoints under `/api/public/*` with HMAC.
- RLS on every table; role checks via `has_role()`.
- Zod validation on every input.
- Audit log written on every mutating server fn.
- Realtime enabled on `tasks`, `task_comments`, `notifications`.
- Loaders use TanStack Query `ensureQueryData` + `useSuspenseQuery`.

---

## Build order (concrete first commits)

1. Enable Lovable Cloud.
2. Migration 1: enums, orgs, departments, profiles, user_roles, has_role(), signup trigger, RLS.
3. Migration 2: tasks + related tables + RLS + overdue cron.
4. App shell + auth + role-aware sidebar.
5. Task list/board/detail + create/edit + checklist + comments + attachments.
6. Employee dashboard + Manager dashboard.
7. Notifications (in-app + email via Resend).
8. Ship Phase 1. Then Phase 2, then Phase 3.

---

## Tech deviations from the prompt (recommended)

- **Backend on Supabase, not Vercel + Supabase split.** TanStack Start already runs server functions on the Lovable edge — no separate Vercel app needed.
- **Recharts instead of Apache ECharts** unless you need ECharts' specific chart types — Recharts fits shadcn better and is lighter. Say the word if you want ECharts.
- **Resend for email**, Firebase deferred to Phase 3 (push only). Email covers 90% of the "eliminate manual follow-ups" objective.

Reply "approve" (or edit any section) and I'll start with Cloud enablement + Migration 1.
