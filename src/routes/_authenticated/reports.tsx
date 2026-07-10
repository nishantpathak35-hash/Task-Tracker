import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  expected_hours: number | null;
  actual_hours: number | null;
};

const reportsQuery = queryOptions({
  queryKey: ["reports", "full"],
  queryFn: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("tasks")
      .select("id,title,status,priority,assigned_to,due_date,created_at,completed_at,expected_hours,actual_hours")
      .limit(5000);
    return (data ?? []) as TaskRow[];
  },
});

const statusColors: Record<string, string> = {
  assigned: "var(--status-assigned)",
  in_progress: "var(--status-progress)",
  waiting_review: "var(--status-review)",
  completed: "var(--status-completed)",
  approved: "var(--status-completed)",
  overdue: "var(--status-overdue)",
  rejected: "var(--destructive)",
  cancelled: "var(--muted)",
  draft: "var(--muted)",
};

export const Route = createFileRoute("/_authenticated/reports")({
  loader: ({ context }) => context.queryClient.ensureQueryData(reportsQuery),
  head: () => ({ meta: [{ title: "Reports — TaskOps" }] }),
  component: ReportsPage,
});

function toCsv(rows: TaskRow[]): string {
  const headers = ["id", "title", "status", "priority", "assigned_to", "due_date", "created_at", "completed_at", "expected_hours", "actual_hours"];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => esc((r as unknown as Record<string, unknown>)[h])).join(","));
  }
  return lines.join("\n");
}

function downloadBlob(name: string, content: Blob) {
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function download(name: string, content: string, mime: string) {
  downloadBlob(name, new Blob([content], { type: mime }));
}

async function exportXlsx(rows: TaskRow[], filename: string) {
  const XLSX = await import("xlsx");
  const headers = ["id", "title", "status", "priority", "assigned_to", "due_date", "created_at", "completed_at", "expected_hours", "actual_hours"];
  const ws = XLSX.utils.json_to_sheet(
    rows.map((r) => {
      const obj: Record<string, unknown> = {};
      for (const h of headers) obj[h] = (r as unknown as Record<string, unknown>)[h] ?? "";
      return obj;
    }),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tasks");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  downloadBlob(filename, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

function exportPdf(rows: TaskRow[], stats: { total: number; completed: number; overdue: number; rate: number }, filename: string) {
  // Generate a simple HTML-based PDF via print
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>TaskOps Report</title>
      <style>
        body { font-family: Inter, sans-serif; padding: 40px; color: #1a1a2e; }
        h1 { font-size: 24px; margin-bottom: 4px; }
        .subtitle { color: #666; margin-bottom: 24px; }
        .stats { display: flex; gap: 24px; margin-bottom: 24px; }
        .stat { background: #f8f9fa; padding: 16px; border-radius: 8px; min-width: 120px; }
        .stat-value { font-size: 28px; font-weight: 600; }
        .stat-label { font-size: 12px; color: #888; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; padding: 8px; border-bottom: 2px solid #ddd; font-weight: 600; }
        td { padding: 8px; border-bottom: 1px solid #eee; }
        tr:nth-child(even) { background: #fafafa; }
        .footer { margin-top: 24px; font-size: 11px; color: #999; }
      </style>
    </head>
    <body>
      <h1>TaskOps — Tasks Report</h1>
      <div class="subtitle">Generated on ${new Date().toLocaleDateString()} · ${rows.length} tasks</div>
      <div class="stats">
        <div class="stat"><div class="stat-value">${stats.total}</div><div class="stat-label">Total</div></div>
        <div class="stat"><div class="stat-value">${stats.completed}</div><div class="stat-label">Completed</div></div>
        <div class="stat"><div class="stat-value">${stats.overdue}</div><div class="stat-label">Overdue</div></div>
        <div class="stat"><div class="stat-value">${stats.rate}%</div><div class="stat-label">Completion rate</div></div>
      </div>
      <table>
        <thead><tr><th>Title</th><th>Status</th><th>Priority</th><th>Due Date</th><th>Est. Hours</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${r.title}</td><td>${r.status}</td><td>${r.priority}</td><td>${r.due_date || "—"}</td><td>${r.expected_hours ?? "—"}</td></tr>`).join("")}
        </tbody>
      </table>
      <div class="footer">TaskOps report — confidential</div>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.print();
    };
  }
}

function ReportsPage() {
  const { data } = useSuspenseQuery(reportsQuery);
  const byStatus = new Map<string, number>();
  const byPriority = new Map<string, number>();
  let completed = 0;
  let overdue = 0;
  let totalHrs = 0;
  for (const t of data) {
    byStatus.set(t.status, (byStatus.get(t.status) || 0) + 1);
    byPriority.set(t.priority, (byPriority.get(t.priority) || 0) + 1);
    if (t.status === "completed" || t.status === "approved") completed += 1;
    if (t.status === "overdue") overdue += 1;
    totalHrs += t.actual_hours ?? 0;
  }
  const statusData = Array.from(byStatus.entries()).map(([name, value]) => ({ name, value }));
  const prioData = Array.from(byPriority.entries()).map(([name, value]) => ({ name, value }));
  const completionRate = data.length ? Math.round((completed / data.length) * 100) : 0;

  const stamp = new Date().toISOString().slice(0, 10);
  const stats = { total: data.length, completed, overdue, rate: completionRate };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold">Reports</h1>
          <p className="text-sm text-muted-foreground">Workspace performance snapshot. Export for finance or leadership review.</p>
        </div>
        {/* Item 16: CSV, XLSX, and PDF export */}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => download(`taskops-tasks-${stamp}.csv`, toCsv(data), "text/csv")}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportXlsx(data, `taskops-tasks-${stamp}.xlsx`)}>
            <FileSpreadsheet className="h-4 w-4" /> XLSX
          </Button>
          <Button size="sm" variant="outline" onClick={() => exportPdf(data, stats, `taskops-tasks-${stamp}.pdf`)}>
            <FileText className="h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Total tasks</div><div className="text-2xl font-display font-semibold">{data.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Completed</div><div className="text-2xl font-display font-semibold">{completed}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Overdue</div><div className="text-2xl font-display font-semibold text-destructive">{overdue}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Completion rate</div><div className="text-2xl font-display font-semibold">{completionRate}%</div></CardContent></Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle>By status</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={90} innerRadius={45}>
                  {statusData.map((d) => (
                    <Cell key={d.name} fill={statusColors[d.name] || "var(--primary)"} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>By priority</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <BarChart data={prioData}>
                <XAxis dataKey="name" fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Hours logged</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {totalHrs.toFixed(1)} hours actual across {data.length} tasks.
        </CardContent>
      </Card>
    </div>
  );
}
