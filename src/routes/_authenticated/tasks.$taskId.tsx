import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PriorityBadge, type Priority } from "@/components/priority-badge";
import { StatusBadge, type Status } from "@/components/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { addComment, deleteTask, toggleChecklistItem, updateTask } from "@/lib/tasks.functions";
import { recordAttachment, deleteAttachment } from "@/lib/attachments.functions";
import { toast } from "sonner";
import { CornerDownRight, Download, FileUp, Link2, Paperclip, Reply, Trash2, Upload, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Attachment = {
  id: string;
  filename: string;
  storage_path: string;
  mime: string | null;
  size_bytes: number | null;
  version: number;
  uploaded_by: string | null;
  created_at: string;
};

type Dep = { task_id: string; depends_on_task_id: string };

type Comment = {
  id: string;
  body: string;
  author_id: string;
  parent_comment_id: string | null;
  created_at: string;
};

const taskQuery = (id: string) =>
  queryOptions({
    queryKey: ["tasks", id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data: task } = await sb.from("tasks").select("*").eq("id", id).maybeSingle();
      if (!task) throw notFound();
      const [{ data: checklist }, { data: comments }, { data: activity }, { data: attachments }, { data: blockedBy }, { data: blocks }] =
        await Promise.all([
          sb.from("task_checklist_items").select("*").eq("task_id", id).order("sort_order"),
          sb.from("task_comments").select("*").eq("task_id", id).order("created_at"),
          sb.from("task_activity").select("*").eq("task_id", id).order("created_at", { ascending: false }).limit(20),
          sb.from("task_attachments").select("*").eq("task_id", id).order("created_at", { ascending: false }),
          sb.from("task_dependencies").select("depends_on_task_id").eq("task_id", id),
          sb.from("task_dependencies").select("task_id").eq("depends_on_task_id", id),
        ]);
      return {
        task,
        checklist: checklist ?? [],
        comments: (comments ?? []) as Comment[],
        activity: activity ?? [],
        attachments: (attachments ?? []) as Attachment[],
        blockedBy: (blockedBy ?? []).map((d: Dep) => d.depends_on_task_id) as string[],
        blocks: (blocks ?? []).map((d: Dep) => d.task_id) as string[],
      };
    },
  });

export const Route = createFileRoute("/_authenticated/tasks/$taskId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(taskQuery(params.taskId)),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.task.title} — TaskOps` : "Task — TaskOps" }],
  }),
  component: TaskDetail,
  notFoundComponent: () => <div className="p-8 text-center text-muted-foreground">Task not found.</div>,
  errorComponent: ({ error }) => (
    <div className="p-8 text-center text-destructive">Failed to load task: {error.message}</div>
  ),
});

function TaskDetail() {
  const { taskId } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(taskQuery(taskId));
  const update = useServerFn(updateTask);
  const del = useServerFn(deleteTask);
  const toggle = useServerFn(toggleChecklistItem);
  const comment = useServerFn(addComment);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const { data: members = [] } = useQuery<{ id: string; full_name: string | null }[]>({
    queryKey: ["org-members"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("profiles").select("id,full_name").order("full_name");
      return data ?? [];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`task-${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${taskId}` }, () =>
        qc.invalidateQueries({ queryKey: ["tasks", taskId] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `id=eq.${taskId}` }, () =>
        qc.invalidateQueries({ queryKey: ["tasks", taskId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [taskId, qc]);

  const t = data.task;

  // Item 21: Check if mandatory checklist items are incomplete
  const hasMandatoryIncomplete = data.checklist.some(
    (c: { is_mandatory: boolean; done: boolean }) => c.is_mandatory && !c.done,
  );

  const mutStatus = useMutation({
    mutationFn: (status: Status) => update({ data: { id: taskId, patch: { status } } }),
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e: Error) => toast.error("Update failed", { description: e.message }),
  });

  const mutAssignee = useMutation({
    mutationFn: (assigned_to: string) => update({ data: { id: taskId, patch: { assigned_to } } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  // Group comments into threads
  const topLevelComments = data.comments.filter((c) => !c.parent_comment_id);
  const repliesMap = new Map<string, Comment[]>();
  for (const c of data.comments) {
    if (c.parent_comment_id) {
      const existing = repliesMap.get(c.parent_comment_id) ?? [];
      existing.push(c);
      repliesMap.set(c.parent_comment_id, existing);
    }
  }

  const nameOf = (id: string) => members.find((m) => m.id === id)?.full_name || id.slice(0, 6);

  return (
    <div className="p-6 max-w-5xl mx-auto grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <PriorityBadge value={t.priority as Priority} />
              <StatusBadge value={t.status as Status} />
            </div>
            <h1 className="font-display text-2xl font-semibold">{t.title}</h1>
            {t.description && <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">{t.description}</p>}
          </div>
          {/* Item 22: AlertDialog for delete */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete "{t.title}" and all associated data (comments, checklist, attachments). This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={async () => {
                    await del({ data: { id: taskId } });
                    toast.success("Task deleted");
                    qc.invalidateQueries({ queryKey: ["tasks"] });
                    navigate({ to: "/my-work" });
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Checklist */}
        {data.checklist.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle>Checklist</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.checklist.map((c: { id: string; label: string; is_mandatory: boolean; done: boolean }) => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={c.done}
                    onCheckedChange={async (v) => {
                      await toggle({ data: { id: c.id, done: !!v } });
                      qc.invalidateQueries({ queryKey: ["tasks", taskId] });
                    }}
                  />
                  <span className={c.done ? "line-through text-muted-foreground" : ""}>{c.label}</span>
                  {c.is_mandatory && <span className="text-[10px] text-muted-foreground ml-1">required</span>}
                </label>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Item 11: Attachments */}
        <AttachmentsCard taskId={taskId} attachments={data.attachments} />

        {/* Item 12: Dependencies */}
        <DependenciesCard taskId={taskId} blockedBy={data.blockedBy} blocks={data.blocks} />

        {/* Item 13: Threaded Comments */}
        <Card>
          <CardHeader className="pb-2"><CardTitle>Comments</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {topLevelComments.length === 0 && data.comments.length === 0 && (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}
            {topLevelComments.map((c) => (
              <CommentThread
                key={c.id}
                comment={c}
                replies={repliesMap.get(c.id) ?? []}
                nameOf={nameOf}
                replyTo={replyTo}
                setReplyTo={setReplyTo}
              />
            ))}
            <div className="flex gap-2 pt-2">
              <div className="flex-1 space-y-1">
                {replyTo && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Reply className="h-3 w-3" />
                    <span>Replying to comment</span>
                    <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => setReplyTo(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={replyTo ? "Write a reply… Use @name to mention" : "Add a comment… Use @name to mention"}
                  rows={2}
                />
              </div>
              <Button
                disabled={!body.trim()}
                onClick={async () => {
                  await comment({ data: { task_id: taskId, body: body.trim(), parent_comment_id: replyTo } });
                  setBody("");
                  setReplyTo(null);
                  qc.invalidateQueries({ queryKey: ["tasks", taskId] });
                }}
              >
                Post
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sidebar */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Status</div>
              <Select value={t.status} onValueChange={(v) => mutStatus.mutate(v as Status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="waiting_review">Waiting review</SelectItem>
                  {/* Item 21: disable completed when mandatory checklist incomplete */}
                  <SelectItem value="completed" disabled={hasMandatoryIncomplete}>
                    Completed {hasMandatoryIncomplete ? "(checklist incomplete)" : ""}
                  </SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Assignee</div>
              <Select value={t.assigned_to ?? ""} onValueChange={(v) => mutAssignee.mutate(v)}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.full_name || m.id.slice(0, 6)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {t.tags && t.tags.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Tags</div>
                <div className="flex flex-wrap gap-1">
                  {t.tags.map((tag: string) => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Due</span>
              <span>{t.due_date ? format(parseISO(t.due_date), "MMM d, yyyy") : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. hours</span>
              <span>{t.expected_hours ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Created</span>
              <span>{format(parseISO(t.created_at), "MMM d")}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Activity</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-xs">
            {data.activity.length === 0 && <p className="text-muted-foreground">No activity yet.</p>}
            {data.activity.map((a: { id: string; event: string; created_at: string }) => (
              <div key={a.id} className="flex justify-between">
                <span>{a.event}</span>
                <span className="text-muted-foreground">{format(parseISO(a.created_at), "MMM d, HH:mm")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Comment Thread Component                                     */
/* ─────────────────────────────────────────────────────────── */
function CommentThread({
  comment: c,
  replies,
  nameOf,
  replyTo,
  setReplyTo,
}: {
  comment: Comment;
  replies: Comment[];
  nameOf: (id: string) => string;
  replyTo: string | null;
  setReplyTo: (id: string | null) => void;
}) {
  return (
    <div>
      <div className="flex gap-2">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-[10px]">{nameOf(c.author_id).slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1 bg-muted/40 rounded-md p-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium">{nameOf(c.author_id)}</div>
            <div className="text-xs text-muted-foreground">{format(parseISO(c.created_at), "MMM d, HH:mm")}</div>
          </div>
          <div className="text-sm whitespace-pre-wrap mt-0.5">{c.body}</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs px-2 mt-1"
            onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
          >
            <Reply className="h-3 w-3 mr-1" /> Reply
          </Button>
        </div>
      </div>
      {replies.length > 0 && (
        <div className="ml-9 mt-1 space-y-1 border-l-2 border-muted pl-3">
          {replies.map((r) => (
            <div key={r.id} className="flex gap-2">
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-[9px]">{nameOf(r.author_id).slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 bg-muted/30 rounded-md p-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">{nameOf(r.author_id)}</div>
                  <div className="text-[10px] text-muted-foreground">{format(parseISO(r.created_at), "MMM d, HH:mm")}</div>
                </div>
                <div className="text-sm whitespace-pre-wrap mt-0.5">{r.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Attachments Card (Item 11)                                   */
/* ─────────────────────────────────────────────────────────── */
function AttachmentsCard({ taskId, attachments }: { taskId: string; attachments: Attachment[] }) {
  const qc = useQueryClient();
  const record = useServerFn(recordAttachment);
  const remove = useServerFn(deleteAttachment);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const path = `${taskId}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from("task-files").upload(path, file);
        if (uploadError) throw new Error(uploadError.message);

        await record({
          data: {
            task_id: taskId,
            storage_path: path,
            filename: file.name,
            mime: file.type || null,
            size_bytes: file.size,
          },
        });
        toast.success(`Uploaded ${file.name}`);
        qc.invalidateQueries({ queryKey: ["tasks", taskId] });
      } catch (err) {
        toast.error("Upload failed", { description: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        setUploading(false);
      }
    },
    [taskId, qc, record],
  );

  const handleDownload = async (att: Attachment) => {
    const { data, error } = await supabase.storage.from("task-files").createSignedUrl(att.storage_path, 300);
    if (error || !data?.signedUrl) {
      toast.error("Download failed");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const removeMut = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Attachment removed");
      qc.invalidateQueries({ queryKey: ["tasks", taskId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const formatSize = (bytes: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4" /> Attachments ({attachments.length})
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Upload className="h-4 w-4 mr-1" /> {uploading ? "Uploading…" : "Upload"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {attachments.length === 0 && (
          <p className="text-sm text-muted-foreground">No attachments. Drag a file or click Upload.</p>
        )}
        {attachments.map((att) => (
          <div key={att.id} className="flex items-center gap-3 border rounded-md p-2 text-sm">
            <FileUp className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{att.filename}</div>
              <div className="text-xs text-muted-foreground">
                v{att.version} · {formatSize(att.size_bytes)} · {format(parseISO(att.created_at), "MMM d")}
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(att)}>
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => removeMut.mutate(att.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Dependencies Card (Item 12)                                  */
/* ─────────────────────────────────────────────────────────── */
function DependenciesCard({
  taskId,
  blockedBy,
  blocks,
}: {
  taskId: string;
  blockedBy: string[];
  blocks: string[];
}) {
  const qc = useQueryClient();
  const [addingBlockedBy, setAddingBlockedBy] = useState(false);

  // Get all tasks for the picker
  const { data: allTasks = [] } = useQuery<{ id: string; title: string }[]>({
    queryKey: ["tasks", "all-brief"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("tasks")
        .select("id,title")
        .neq("id", taskId)
        .order("title")
        .limit(200);
      return data ?? [];
    },
    enabled: addingBlockedBy,
  });

  const addDep = async (dependsOnId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("task_dependencies")
      .insert({ task_id: taskId, depends_on_task_id: dependsOnId });
    if (error) {
      toast.error("Failed to add dependency");
      return;
    }
    toast.success("Dependency added");
    setAddingBlockedBy(false);
    qc.invalidateQueries({ queryKey: ["tasks", taskId] });
  };

  const removeDep = async (dependsOnId: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("task_dependencies")
      .delete()
      .eq("task_id", taskId)
      .eq("depends_on_task_id", dependsOnId);
    qc.invalidateQueries({ queryKey: ["tasks", taskId] });
  };

  // Get titles for dependency task IDs
  const { data: depTasks = [] } = useQuery<{ id: string; title: string }[]>({
    queryKey: ["dep-tasks", ...blockedBy, ...blocks],
    queryFn: async () => {
      const ids = [...new Set([...blockedBy, ...blocks])];
      if (ids.length === 0) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("tasks").select("id,title").in("id", ids);
      return data ?? [];
    },
    enabled: blockedBy.length > 0 || blocks.length > 0,
  });

  const titleOf = (id: string) => depTasks.find((t) => t.id === id)?.title || id.slice(0, 8);
  const available = allTasks.filter((t) => !blockedBy.includes(t.id) && t.id !== taskId);

  if (blockedBy.length === 0 && blocks.length === 0 && !addingBlockedBy) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Dependencies
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setAddingBlockedBy(true)}>
              Add
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No dependencies.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Dependencies
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setAddingBlockedBy(!addingBlockedBy)}>
            {addingBlockedBy ? "Cancel" : "Add"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {blockedBy.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Blocked by</div>
            <div className="space-y-1">
              {blockedBy.map((id) => (
                <div key={id} className="flex items-center justify-between text-sm border rounded px-2 py-1">
                  <span className="truncate">{titleOf(id)}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeDep(id)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        {blocks.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Blocks</div>
            <div className="space-y-1">
              {blocks.map((id) => (
                <div key={id} className="text-sm border rounded px-2 py-1 truncate">
                  {titleOf(id)}
                </div>
              ))}
            </div>
          </div>
        )}
        {addingBlockedBy && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Add "blocked by"</div>
            <Select onValueChange={(v) => addDep(v)}>
              <SelectTrigger><SelectValue placeholder="Select a task…" /></SelectTrigger>
              <SelectContent>
                {available.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
