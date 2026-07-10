import { Link } from "@tanstack/react-router";
import { format, isPast, parseISO } from "date-fns";
import { PriorityBadge, type Priority } from "@/components/priority-badge";
import { StatusBadge, type Status } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { CalendarDays } from "lucide-react";

export type TaskRow = {
  id: string;
  title: string;
  priority: Priority;
  status: Status;
  due_date: string | null;
  assigned_to: string | null;
  expected_hours: number | null;
  assignee_name?: string | null;
};

export function TaskRowItem({ task }: { task: TaskRow }) {
  const overdue = task.due_date && isPast(parseISO(task.due_date)) && !["completed", "approved", "cancelled"].includes(task.status);
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: task.id }}
      className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors border-b last:border-b-0"
    >
      <PriorityBadge value={task.priority} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{task.title}</div>
      </div>
      <StatusBadge value={task.status} />
      {task.due_date && (
        <div className={cn("text-xs flex items-center gap-1", overdue ? "text-destructive font-medium" : "text-muted-foreground")}>
          <CalendarDays className="h-3.5 w-3.5" />
          {format(parseISO(task.due_date), "MMM d")}
        </div>
      )}
      <Avatar className="h-6 w-6">
        <AvatarFallback className="text-[10px] bg-muted">
          {(task.assignee_name || "—").split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    </Link>
  );
}

export function TaskList({ tasks, empty = "No tasks" }: { tasks: TaskRow[]; empty?: string }) {
  if (tasks.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">{empty}</div>;
  }
  return (
    <div className="divide-y">
      {tasks.map((t) => (
        <TaskRowItem key={t.id} task={t} />
      ))}
    </div>
  );
}
