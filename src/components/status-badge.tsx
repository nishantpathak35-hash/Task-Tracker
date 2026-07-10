import { cn } from "@/lib/utils";

export type Status =
  | "draft"
  | "assigned"
  | "in_progress"
  | "waiting_review"
  | "completed"
  | "approved"
  | "rejected"
  | "cancelled"
  | "overdue";

const label: Record<Status, string> = {
  draft: "Draft",
  assigned: "Assigned",
  in_progress: "In progress",
  waiting_review: "Waiting review",
  completed: "Completed",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  overdue: "Overdue",
};

const styles: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  assigned: "bg-status-assigned/15 text-status-assigned",
  in_progress: "bg-status-progress/15 text-status-progress",
  waiting_review: "bg-status-review/15 text-status-review",
  completed: "bg-status-completed/15 text-status-completed",
  approved: "bg-status-completed/20 text-status-completed",
  rejected: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
  overdue: "bg-status-overdue/15 text-status-overdue",
};

export function StatusBadge({ value, className }: { value: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        styles[value],
        className,
      )}
    >
      {label[value]}
    </span>
  );
}
