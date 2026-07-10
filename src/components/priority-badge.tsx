import { cn } from "@/lib/utils";

export type Priority = "low" | "medium" | "high" | "critical" | "blocker";

const label: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
  blocker: "Blocker",
};

const dot: Record<Priority, string> = {
  low: "bg-prio-low",
  medium: "bg-prio-medium",
  high: "bg-prio-high",
  critical: "bg-prio-critical",
  blocker: "bg-prio-blocker",
};

export function PriorityBadge({ value, className }: { value: Priority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", dot[value])} />
      {label[value]}
    </span>
  );
}
