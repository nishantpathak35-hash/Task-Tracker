import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Check, Loader2, RefreshCw } from "lucide-react";
import { enableComplianceTemplate, disableRecurringRule, materializeDueRecurring } from "@/lib/recurring.functions";
import { toast } from "sonner";

type Template = {
  id: string;
  title: string;
  description: string | null;
  cadence: string;
  category: string;
  day_of_period: number | null;
  mandatory: boolean;
};

type Rule = { id: string; template_task: { compliance_template_id?: string }; next_run_at: string | null };

const templatesQuery = queryOptions({
  queryKey: ["compliance", "templates"],
  queryFn: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("compliance_templates")
      .select("*")
      .order("category")
      .order("title");
    return (data ?? []) as Template[];
  },
});

const rulesQuery = queryOptions({
  queryKey: ["compliance", "rules"],
  queryFn: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("recurring_rules")
      .select("id,template_task,next_run_at,active")
      .eq("active", true);
    return (data ?? []) as Rule[];
  },
});

export const Route = createFileRoute("/_authenticated/compliance")({
  loader: ({ context }) => context.queryClient.ensureQueryData(templatesQuery),
  head: () => ({ meta: [{ title: "Compliance — TaskOps" }] }),
  component: CompliancePage,
});

function CompliancePage() {
  const { data: templates } = useSuspenseQuery(templatesQuery);
  const { data: rules = [] } = useQuery(rulesQuery);
  const qc = useQueryClient();
  const enable = useServerFn(enableComplianceTemplate);
  const disable = useServerFn(disableRecurringRule);
  const materialize = useServerFn(materializeDueRecurring);

  const ruleByTemplate = new Map<string, Rule>();
  for (const r of rules) {
    const tid = r.template_task?.compliance_template_id;
    if (tid) ruleByTemplate.set(tid, r);
  }

  const enableMut = useMutation({
    mutationFn: (template_id: string) => enable({ data: { template_id } }),
    onSuccess: () => {
      toast.success("Enabled — first task added to your calendar");
      qc.invalidateQueries({ queryKey: ["compliance", "rules"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error("Could not enable", { description: e.message }),
  });

  const disableMut = useMutation({
    mutationFn: (rule_id: string) => disable({ data: { rule_id } }),
    onSuccess: () => {
      toast.success("Disabled");
      qc.invalidateQueries({ queryKey: ["compliance", "rules"] });
    },
  });

  const runMut = useMutation({
    mutationFn: () => materialize({}),
    onSuccess: (r: { created: number }) => {
      toast.success(r.created ? `Generated ${r.created} task(s)` : "Nothing due yet");
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["compliance", "rules"] });
    },
  });

  const grouped = new Map<string, Template[]>();
  for (const c of templates) {
    const g = grouped.get(c.category) || [];
    g.push(c);
    grouped.set(c.category, g);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-7 w-7 text-primary" /> Compliance
          </h1>
          <p className="text-sm text-muted-foreground">
            India compliance calendar — GST, TDS, PF, ESI, ROC, and more. Enable a filing to auto-create recurring tasks on the due date.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => runMut.mutate()} disabled={runMut.isPending}>
          {runMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Generate due tasks
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {Array.from(grouped.entries()).map(([cat, items]) => (
          <Card key={cat}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                <span>{cat}</span>
                <Badge variant="secondary">{items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map((i) => {
                const rule = ruleByTemplate.get(i.id);
                const enabled = !!rule;
                return (
                  <div key={i.id} className="border rounded-md p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{i.title}</div>
                        {i.description && <div className="text-xs text-muted-foreground">{i.description}</div>}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {i.mandatory && <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/10">Mandatory</Badge>}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="text-xs text-muted-foreground">
                        {i.cadence}{i.day_of_period ? ` · day ${i.day_of_period}` : ""}
                        {enabled && rule?.next_run_at && (
                          <span> · next {new Date(rule.next_run_at).toLocaleDateString()}</span>
                        )}
                      </div>
                      {enabled ? (
                        <div className="flex items-center gap-2">
                          <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10">
                            <Check className="h-3 w-3" /> Enabled
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => rule && disableMut.mutate(rule.id)}
                            disabled={disableMut.isPending}
                          >
                            Disable
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => enableMut.mutate(i.id)}
                          disabled={enableMut.isPending}
                        >
                          {enableMut.isPending && enableMut.variables === i.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : null}
                          Enable
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
