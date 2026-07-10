import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  getHours,
  isSameDay,
  isSameMonth,
  isPast,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight, PartyPopper } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

type CalTask = {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string;
};

type Holiday = {
  id: string;
  date: string;
  name: string;
};

const calendarQuery = (cursorIso: string) =>
  queryOptions({
    queryKey: ["tasks", "calendar", cursorIso.slice(0, 7)],
    queryFn: async () => {
      const d = parseISO(cursorIso);
      const start = format(startOfMonth(addMonths(d, -1)), "yyyy-MM-dd");
      const end = format(endOfMonth(addMonths(d, 1)), "yyyy-MM-dd");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("tasks")
        .select("id,title,priority,status,due_date")
        .not("due_date", "is", null)
        .gte("due_date", start)
        .lte("due_date", end)
        .limit(1000);
      return (data ?? []) as CalTask[];
    },
  });

export const Route = createFileRoute("/_authenticated/calendar")({
  loader: ({ context }) => context.queryClient.ensureQueryData(calendarQuery(new Date().toISOString())),
  head: () => ({ meta: [{ title: "Calendar — TaskOps" }] }),
  component: CalendarPage,
});

function CalendarPage() {
  const [cursor, setCursor] = useState(new Date());
  const { data } = useQuery({
    ...calendarQuery(cursor.toISOString()),
    initialData: () => Route.useLoaderData(), // Can't easily useSuspenseQuery here without transition, so we just useQuery
  });
  const [view, setView] = useState<"month" | "week" | "day">("month");

  // Item 17: Fetch holidays
  const { data: holidays = [] } = useQuery<Holiday[]>({
    queryKey: ["holidays"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("holidays")
        .select("id,date,name")
        .order("date");
      return (data ?? []) as Holiday[];
    },
  });

  const navigateBack = () => {
    if (view === "month") setCursor((c) => addMonths(c, -1));
    else if (view === "week") setCursor((c) => addWeeks(c, -1));
    else setCursor((c) => addDays(c, -1));
  };

  const navigateForward = () => {
    if (view === "month") setCursor((c) => addMonths(c, 1));
    else if (view === "week") setCursor((c) => addWeeks(c, 1));
    else setCursor((c) => addDays(c, 1));
  };

  const headerText = () => {
    if (view === "month") return format(cursor, "MMMM yyyy");
    if (view === "week") {
      const ws = startOfWeek(cursor, { weekStartsOn: 1 });
      const we = endOfWeek(cursor, { weekStartsOn: 1 });
      return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
    }
    return format(cursor, "EEEE, MMMM d, yyyy");
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-muted-foreground">Tasks and compliance deadlines by due date.</p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as "month" | "week" | "day")}>
            <TabsList>
              <TabsTrigger value="month">Month</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="day">Day</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="icon" onClick={navigateBack}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-40 text-center font-medium">{headerText()}</div>
          <Button variant="outline" size="icon" onClick={navigateForward}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-2">
          {view === "month" && <MonthView cursor={cursor} tasks={data ?? []} holidays={holidays} />}
          {view === "week" && <WeekView cursor={cursor} tasks={data ?? []} holidays={holidays} />}
          {view === "day" && <DayView cursor={cursor} tasks={data ?? []} holidays={holidays} />}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Month View                                                   */
/* ─────────────────────────────────────────────────────────── */
function MonthView({ cursor, tasks, holidays }: { cursor: Date; tasks: CalTask[]; holidays: Holiday[] }) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <>
      <div className="grid grid-cols-7 text-xs font-medium text-muted-foreground border-b">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="p-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-border">
        {days.map((d) => {
          const items = tasks.filter((t) => t.due_date && isSameDay(parseISO(t.due_date), d));
          const dayHolidays = holidays.filter((h) => isSameDay(parseISO(h.date), d));
          const isCurrentMonth = isSameMonth(d, cursor);
          const today = isSameDay(d, new Date());
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "bg-card min-h-[110px] p-1.5",
                !isCurrentMonth && "opacity-40",
                dayHolidays.length > 0 && "bg-amber-50/50 dark:bg-amber-950/20",
              )}
            >
              <div className={cn("text-xs font-medium mb-1", today && "text-primary")}>{format(d, "d")}</div>
              {/* Holiday badges */}
              {dayHolidays.map((h) => (
                <div key={h.id} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 mb-1 truncate flex items-center gap-1">
                  <PartyPopper className="h-2.5 w-2.5 shrink-0" />
                  {h.name}
                </div>
              ))}
              <div className="space-y-1">
                {items.slice(0, 3).map((t) => (
                  <TaskPill key={t.id} task={t} />
                ))}
                {items.length > 3 && <div className="text-[10px] text-muted-foreground">+{items.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Week View                                                    */
/* ─────────────────────────────────────────────────────────── */
function WeekView({ cursor, tasks, holidays }: { cursor: Date; tasks: CalTask[]; holidays: Holiday[] }) {
  const weekStart = startOfWeek(cursor, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="grid grid-cols-7 gap-px bg-border">
      {days.map((d) => {
        const items = tasks.filter((t) => t.due_date && isSameDay(parseISO(t.due_date), d));
        const dayHolidays = holidays.filter((h) => isSameDay(parseISO(h.date), d));
        const today = isSameDay(d, new Date());
        return (
          <div
            key={d.toISOString()}
            className={cn(
              "bg-card min-h-[400px] p-2",
              dayHolidays.length > 0 && "bg-amber-50/50 dark:bg-amber-950/20",
            )}
          >
            <div className={cn("text-sm font-medium mb-2", today && "text-primary")}>
              {format(d, "EEE d")}
            </div>
            {dayHolidays.map((h) => (
              <div key={h.id} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 mb-1.5 truncate flex items-center gap-1">
                <PartyPopper className="h-2.5 w-2.5 shrink-0" />
                {h.name}
              </div>
            ))}
            <div className="space-y-1.5">
              {items.map((t) => (
                <TaskPill key={t.id} task={t} showFull />
              ))}
              {items.length === 0 && <div className="text-xs text-muted-foreground pt-2">No tasks</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Day View                                                     */
/* ─────────────────────────────────────────────────────────── */
function DayView({ cursor, tasks, holidays }: { cursor: Date; tasks: CalTask[]; holidays: Holiday[] }) {
  const dayTasks = tasks.filter((t) => t.due_date && isSameDay(parseISO(t.due_date), cursor));
  const dayHolidays = holidays.filter((h) => isSameDay(parseISO(h.date), cursor));

  return (
    <div className="min-h-[500px] p-4 space-y-4">
      <div className="text-lg font-medium">{format(cursor, "EEEE, MMMM d, yyyy")}</div>

      {dayHolidays.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dayHolidays.map((h) => (
            <Badge key={h.id} className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 hover:bg-amber-100">
              <PartyPopper className="h-3 w-3 mr-1" /> {h.name}
            </Badge>
          ))}
        </div>
      )}

      {dayTasks.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No tasks due on this day.</div>
      ) : (
        <div className="space-y-2">
          {dayTasks.map((t) => (
            <Link
              key={t.id}
              to="/tasks/$taskId"
              params={{ taskId: t.id }}
              className="block border rounded-lg p-3 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px]",
                    t.priority === "critical" && "bg-red-100 text-red-800",
                    t.priority === "high" && "bg-orange-100 text-orange-800",
                    t.priority === "blocker" && "bg-purple-100 text-purple-800",
                  )}
                >
                  {t.priority}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px]",
                    t.status === "overdue" && "border-red-500 text-red-600",
                  )}
                >
                  {t.status.replace("_", " ")}
                </Badge>
              </div>
              <div className="font-medium mt-1">{t.title}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Shared task pill                                              */
/* ─────────────────────────────────────────────────────────── */
function TaskPill({ task: t, showFull = false }: { task: CalTask; showFull?: boolean }) {
  const isOverdue =
    t.status === "overdue" ||
    (isPast(parseISO(t.due_date)) && !["completed", "approved", "cancelled"].includes(t.status));

  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: t.id }}
      className={cn(
        "block text-[11px] px-1.5 py-0.5 rounded truncate",
        isOverdue
          ? "bg-destructive/10 text-destructive"
          : "bg-primary/10 text-primary",
        showFull && "py-1.5 text-xs",
      )}
    >
      {t.title}
    </Link>
  );
}
