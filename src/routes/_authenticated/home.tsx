import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/use-me";
import { format, startOfDay, endOfDay, addDays } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskList, type TaskRow } from "@/components/task-list";
import { AlertTriangle, CheckCircle2, Clock, ListTodo } from "lucide-react";

const homeQuery = queryOptions({
  queryKey: ["dashboard", "home"],
  queryFn: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Not signed in");
    const today = startOfDay(new Date()).toISOString();
    const endToday = endOfDay(new Date()).toISOString();
    const soon = addDays(new Date(), 7).toISOString();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [{ data: mine }, { data: overdue }, { data: dueToday }, { data: upcoming }] = await Promise.all([
      sb.from("tasks").select("id,title,priority,status,due_date,assigned_to,expected_hours").eq("assigned_to", u.user.id).not("status", "in", "(completed,approved,cancelled)").order("due_date", { ascending: true, nullsFirst: false }).limit(20),
      sb.from("tasks").select("id,title,priority,status,due_date,assigned_to,expected_hours").eq("assigned_to", u.user.id).eq("status", "overdue").limit(50),
      sb.from("tasks").select("id,title,priority,status,due_date,assigned_to,expected_hours").eq("assigned_to", u.user.id).gte("due_date", today.slice(0, 10)).lte("due_date", endToday.slice(0, 10)),
      sb.from("tasks").select("id,title,priority,status,due_date,assigned_to,expected_hours").eq("assigned_to", u.user.id).gt("due_date", endToday.slice(0, 10)).lte("due_date", soon.slice(0, 10)).order("due_date"),
    ]);
    return {
      mine: (mine ?? []) as TaskRow[],
      overdue: (overdue ?? []) as TaskRow[],
      dueToday: (dueToday ?? []) as TaskRow[],
      upcoming: (upcoming ?? []) as TaskRow[],
    };
  },
});

export const Route = createFileRoute("/_authenticated/home")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQuery),
  head: () => ({ meta: [{ title: "Home — TaskOps" }] }),
  component: HomePage,
});

function HomePage() {
  const { data } = useSuspenseQuery(homeQuery);
  const { data: me } = useMe();
  const name = me?.profile?.full_name?.split(" ")[0] || "there";
  const hours = data.mine.reduce((s, t) => s + (t.expected_hours || 0), 0);

  const stats = [
    { label: "Due today", value: data.dueToday.length, icon: Clock, tint: "text-status-review" },
    { label: "Overdue", value: data.overdue.length, icon: AlertTriangle, tint: "text-status-overdue" },
    { label: "Open tasks", value: data.mine.length, icon: ListTodo, tint: "text-status-progress" },
    { label: "Est. hours", value: hours.toFixed(1), icon: CheckCircle2, tint: "text-status-completed" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="font-display text-3xl font-semibold">Good {greeting()}, {name}.</h1>
        <p className="text-muted-foreground text-sm mt-1">Here's what's on your plate — {format(new Date(), "EEEE, MMMM d")}.</p>
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

      {data.overdue.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Overdue ({data.overdue.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TaskList tasks={data.overdue} />
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle>Due today</CardTitle>
            <Link to="/my-work" className="text-xs text-primary hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="p-0">
            <TaskList tasks={data.dueToday} empty="Nothing due today. Nice." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Upcoming (7 days)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TaskList tasks={data.upcoming} empty="Nothing scheduled." />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle>My open tasks</CardTitle>
          <Link to="/my-work" className="text-xs text-primary hover:underline">Open workspace</Link>
        </CardHeader>
        <CardContent className="p-0">
          <TaskList tasks={data.mine.slice(0, 12)} empty="No open tasks. Create one to get started." />
        </CardContent>
      </Card>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

// unused imports satisfied
