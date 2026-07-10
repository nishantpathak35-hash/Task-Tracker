import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { createTask } from "@/lib/tasks.functions";
import { supabase } from "@/integrations/supabase/client";

const schema = z.object({
  title: z.string().trim().min(1, "Required").max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(["low", "medium", "high", "critical", "blocker"]),
  due_date: z.string().optional(),
  expected_hours: z.string().optional(),
  assigned_to: z.string().optional(),
  department_id: z.string().optional(),
  project_id: z.string().optional(),
  approver_id: z.string().optional(),
  tags_string: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

type Member = { id: string; full_name: string | null };

export function TaskDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createTask);
  const [checklist, setChecklist] = useState<{ label: string; is_mandatory: boolean }[]>([]);

  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["org-members"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("profiles").select("id,full_name").order("full_name");
      return data ?? [];
    },
    enabled: open,
  });

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["departments-list"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("departments").select("id,name").order("name");
      return data ?? [];
    },
    enabled: open,
  });

  const { data: projects = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["projects-list"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("projects").select("id,name").order("name");
      return data ?? [];
    },
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", priority: "medium" },
  });

  const mut = useMutation({
    mutationFn: (v: FormValues) =>
      create({
        data: {
          title: v.title,
          description: v.description || null,
          priority: v.priority,
          status: "assigned",
          assigned_to: v.assigned_to || null,
          department_id: v.department_id || null,
          project_id: v.project_id || null,
          approver_id: v.approver_id || null,
          due_date: v.due_date || null,
          expected_hours: v.expected_hours ? Number(v.expected_hours) : null,
          tags: v.tags_string ? v.tags_string.split(",").map(t => t.trim()).filter(Boolean) : [],
          checklist,
        },
      }),
    onSuccess: () => {
      toast.success("Task created");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      form.reset();
      setChecklist([]);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Could not create task", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Create task</DialogTitle>
          <DialogDescription>Assign work with a due date, priority, and mandatory checklist.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" {...form.register("title")} placeholder="File GSTR-3B for October" />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="desc">Description</Label>
            <Textarea id="desc" rows={3} {...form.register("description")} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={form.watch("priority")} onValueChange={(v) => form.setValue("priority", v as FormValues["priority"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="blocker">Blocker</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="due">Due date</Label>
              <Input id="due" type="date" {...form.register("due_date")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hrs">Est. hours</Label>
              <Input id="hrs" type="number" step="0.5" min="0" {...form.register("expected_hours")} />
            </div>
            <div className="space-y-2">
              <Label>Assign to</Label>
              <Select value={form.watch("assigned_to") || ""} onValueChange={(v) => form.setValue("assigned_to", v)}>
                <SelectTrigger><SelectValue placeholder="Someone" /></SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.full_name || m.id.slice(0, 6)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Approver</Label>
              <Select value={form.watch("approver_id") || ""} onValueChange={(v) => form.setValue("approver_id", v)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.full_name || m.id.slice(0, 6)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={form.watch("department_id") || ""} onValueChange={(v) => form.setValue("department_id", v)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={form.watch("project_id") || ""} onValueChange={(v) => form.setValue("project_id", v)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <Input id="tags" {...form.register("tags_string")} placeholder="Comma-separated (e.g. frontend, bug)" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Checklist</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setChecklist((c) => [...c, { label: "", is_mandatory: true }])}
              >
                <Plus className="h-4 w-4" /> Add item
              </Button>
            </div>
            {checklist.length === 0 && (
              <p className="text-xs text-muted-foreground">Optional. All mandatory items must be completed before the task can be marked done.</p>
            )}
            <div className="space-y-2">
              {checklist.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Checkbox
                    checked={c.is_mandatory}
                    onCheckedChange={(v) =>
                      setChecklist((cs) => cs.map((x, j) => (j === i ? { ...x, is_mandatory: !!v } : x)))
                    }
                  />
                  <Input
                    value={c.label}
                    onChange={(e) =>
                      setChecklist((cs) => cs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                    }
                    placeholder="Item"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setChecklist((cs) => cs.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mut.isPending}>{mut.isPending ? "Creating…" : "Create task"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
