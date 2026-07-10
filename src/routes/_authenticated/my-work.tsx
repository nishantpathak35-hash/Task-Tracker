import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { queryOptions, useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskList, type TaskRow } from "@/components/task-list";
import { PriorityBadge, type Priority } from "@/components/priority-badge";
import { StatusBadge, type Status } from "@/components/status-badge";
import { Link } from "@tanstack/react-router";
import { updateTask } from "@/lib/tasks.functions";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";

const PAGE_SIZE = 50;

const tasksQuery = queryOptions({
  queryKey: ["tasks", "all"],
  queryFn: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, count } = await (supabase as any)
      .from("tasks")
      .select("id,title,priority,status,due_date,assigned_to,expected_hours,department_id,tags", { count: "exact" })
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(500);
    return { tasks: (data ?? []) as (TaskRow & { department_id?: string; tags?: string[] })[], total: count ?? 0 };
  },
});

export const Route = createFileRoute("/_authenticated/my-work")({
  loader: ({ context }) => context.queryClient.ensureQueryData(tasksQuery),
  head: () => ({ meta: [{ title: "My Work — TaskOps" }] }),
  component: MyWork,
});

function MyWork() {
  const { data: { tasks: all, total } } = useSuspenseQuery(tasksQuery);
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [assignee, setAssignee] = useState<string>("all");
  const [department, setDepartment] = useState<string>("all");
  const [tag, setTag] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);

  // Fetch members and departments for filter dropdowns
  const { data: members = [] } = useQuery<{ id: string; full_name: string | null }[]>({
    queryKey: ["org-members"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("profiles").select("id,full_name").order("full_name");
      return data ?? [];
    },
  });

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["departments-list"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("departments").select("id,name").order("name");
      return data ?? [];
    },
  });

  // Collect all tags for filter
  const allTags = [...new Set(all.flatMap((t) => t.tags ?? []))].sort();

  const filtered = all.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q.toLowerCase())) return false;
    if (priority !== "all" && t.priority !== priority) return false;
    if (status !== "all" && t.status !== status) return false;
    if (assignee !== "all" && t.assigned_to !== assignee) return false;
    if (department !== "all" && t.department_id !== department) return false;
    if (tag !== "all" && !(t.tags ?? []).includes(tag)) return false;
    if (dateFrom && t.due_date && t.due_date < dateFrom) return false;
    if (dateTo && t.due_date && t.due_date > dateTo) return false;
    return true;
  });

  // Pagination
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">My Work</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} of {total} tasks</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search tasks…" className="max-w-xs" />
        <Select value={priority} onValueChange={(v) => { setPriority(v); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            <SelectItem value="blocker">Blocker</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="waiting_review">Waiting review</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
          </SelectContent>
        </Select>
        {/* Item 24: Additional filters */}
        <Select value={assignee} onValueChange={(v) => { setAssignee(v); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Assignee" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.full_name || m.id.slice(0, 6)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={department} onValueChange={(v) => { setDepartment(v); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {allTags.length > 0 && (
          <Select value={tag} onValueChange={(v) => { setTag(v); setPage(0); }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Tag" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tags</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
          className="w-36"
          placeholder="From"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
          className="w-36"
          placeholder="To"
        />
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="board">Board</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <Card>
            <CardContent className="p-0">
              <TaskList tasks={paged} empty="No tasks match your filters." />
            </CardContent>
          </Card>
          {/* Item 20: Pagination */}
          {pageCount > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {pageCount}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          )}
        </TabsContent>
        <TabsContent value="board">
          <DndBoard tasks={filtered} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Item 14: Kanban Board with Drag-and-Drop                     */
/* ─────────────────────────────────────────────────────────── */
const columns: { key: Status; label: string }[] = [
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In progress" },
  { key: "waiting_review", label: "Waiting review" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Completed" },
];

function DndBoard({ tasks }: { tasks: TaskRow[] }) {
  const qc = useQueryClient();
  const update = useServerFn(updateTask);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over) return;
      const targetStatus = over.id as string;
      const task = tasks.find((t) => t.id === active.id);
      if (!task || task.status === targetStatus) return;

      try {
        await update({ data: { id: task.id, patch: { status: targetStatus as Status } } });
        toast.success(`Moved to ${targetStatus.replace("_", " ")}`);
        qc.invalidateQueries({ queryKey: ["tasks"] });
      } catch (err) {
        toast.error("Failed to update status", {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [tasks, update, qc],
  );

  const activeTask = tasks.find((t) => t.id === activeId);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 mt-3">
        {columns.map((c) => {
          const items = tasks.filter((t) => t.status === c.key);
          return <DroppableColumn key={c.key} column={c} items={items} />;
        })}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function DroppableColumn({ column, items }: { column: { key: Status; label: string }; items: TaskRow[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    <div
      ref={setNodeRef}
      className={`bg-muted/40 rounded-lg p-2 min-h-[300px] transition-colors ${isOver ? "bg-primary/5 ring-2 ring-primary/20" : ""}`}
    >
      <div className="flex items-center justify-between px-2 py-1 text-xs font-medium">
        <span>{column.label}</span>
        <span className="text-muted-foreground">{items.length}</span>
      </div>
      <div className="space-y-2 mt-1">
        {items.map((t) => (
          <DraggableTask key={t.id} task={t} />
        ))}
        {items.length === 0 && <div className="px-2 py-4 text-xs text-muted-foreground">Empty</div>}
      </div>
    </div>
  );
}

function DraggableTask({ task }: { task: TaskRow }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`${isDragging ? "opacity-30" : ""}`}
    >
      <TaskCard task={task} />
    </div>
  );
}

function TaskCard({ task: t, isDragging = false }: { task: TaskRow; isDragging?: boolean }) {
  return (
    <Link
      to="/tasks/$taskId"
      params={{ taskId: t.id }}
      className={`block bg-card rounded-md p-3 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-elevated)] transition-shadow ${isDragging ? "shadow-lg ring-2 ring-primary/30" : ""}`}
      onClick={(e) => {
        if (isDragging) e.preventDefault();
      }}
    >
      <div className="text-sm font-medium leading-tight">{t.title}</div>
      <div className="mt-2 flex items-center gap-2">
        <PriorityBadge value={t.priority as Priority} />
        <StatusBadge value={t.status} />
      </div>
    </Link>
  );
}
