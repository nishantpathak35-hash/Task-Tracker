import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskList, type TaskRow } from "@/components/task-list";
import { AlertTriangle, CheckCircle2, ListTodo, Zap } from "lucide-react";

const teamQuery = queryOptions({
  queryKey: ["dashboard", "team"],
  queryFn: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [{ data: all }, { data: members }] = await Promise.all([
      sb.from("tasks").select("id,title,priority,status,due_date,assigned_to,expected_hours,completed_at").limit(500),
      sb.from("profiles").select("id,full_name"),
    ]);
    return { all: (all ?? []) as TaskRow[], members: members ?? [] };
  },
});

export const Route = createFileRoute("/_authenticated/team")({
  loader: ({ context }) => context.queryClient.ensureQueryData(teamQuery),
  head: () => ({ meta: [{ title: "Team — TaskOps" }] }),
  component: TeamPage,
});

function TeamPage() {
  const { data } = useSuspenseQuery(teamQuery);
  const nameOf = (id: string | null) => data.members.find((m: { id: string; full_name: string | null }) => m.id === id)?.full_name || "Unassigned";

  const open = data.all.filter((t) => !["completed", "approved", "cancelled"].includes(t.status));
  const overdue = data.all.filter((t) => t.status === "overdue");
  const critical = data.all.filter((t) => t.priority === "critical" || t.priority === "blocker");
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const completedToday = data.all.filter((t: any) => {
    if (t.status !== "completed" || !t.completed_at) return false;
    const completedAt = new Date(t.completed_at);
    return completedAt >= todayStart;
  });

  // Workload by assignee
  const byAssignee = new Map<string, { open: number; hours: number; name: string }>();
  for (const t of open) {
    if (!t.assigned_to) continue;
    const cur = byAssignee.get(t.assigned_to) || { open: 0, hours: 0, name: nameOf(t.assigned_to) };
    cur.open += 1;
    cur.hours += t.expected_hours || 0;
    byAssignee.set(t.assigned_to, cur);
  }
  const workload = Array.from(byAssignee.entries()).sort((a, b) => b[1].open - a[1].open);
  const maxOpen = workload[0]?.[1].open || 1;

  const stats = [
    { label: "Open", value: open.length, icon: ListTodo, tint: "text-status-progress" },
    { label: "Overdue", value: overdue.length, icon: AlertTriangle, tint: "text-status-overdue" },
    { label: "Critical", value: critical.length, icon: Zap, tint: "text-prio-critical" },
    { label: "Completed", value: completedToday.length, icon: CheckCircle2, tint: "text-status-completed" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="font-display text-3xl font-semibold">Team</h1>
        <p className="text-sm text-muted-foreground">Workload, delays, and department health.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <s.icon className={`h-4 w-4 ${s.tint}`} />
              </div>
              <div className="mt-2 font-display text-2xl font-semibold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Workload by teammate</CardTitle></CardHeader>
        <CardContent>
          {workload.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assigned tasks yet.</p>
          ) : (
            <div className="space-y-3">
              {workload.map(([id, w]) => (
                <div key={id}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{w.name}</span>
                    <span className="text-muted-foreground">{w.open} open · {w.hours.toFixed(1)}h</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(w.open / maxOpen) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {overdue.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2"><CardTitle className="text-destructive">Overdue across team</CardTitle></CardHeader>
          <CardContent className="p-0">
            <TaskList tasks={overdue} />
          </CardContent>
        </Card>
      )}

      {critical.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle>Critical & blockers</CardTitle></CardHeader>
          <CardContent className="p-0">
            <TaskList tasks={critical} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
