import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Search, Loader2, ListTodo, Folder, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { globalSearch } from "@/lib/recurring.functions";

type Results = {
  tasks: Array<{ id: string; title: string; status: string; priority: string }>;
  projects: Array<{ id: string; name: string }>;
  people: Array<{ id: string; full_name: string | null; designation: string | null }>;
};

export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const navigate = useNavigate();
  const search = useServerFn(globalSearch);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = (await search({ data: { q: trimmed } })) as Results;
        setResults(r);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, search]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const empty = results && !results.tasks.length && !results.projects.length && !results.people.length;

  return (
    <div ref={ref} className="relative max-w-md flex-1 hidden sm:block">
      <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
      <Input
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        placeholder="Search tasks, people, projects…"
        className="pl-8 h-9 bg-muted/50"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md z-50 overflow-hidden">
          {loading && (
            <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          )}
          {!loading && empty && (
            <div className="p-3 text-sm text-muted-foreground">No matches</div>
          )}
          {!loading && results && !empty && (
            <div className="max-h-80 overflow-auto py-1 text-sm">
              {results.tasks.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">Tasks</div>
                  {results.tasks.map((t) => (
                    <button
                      key={t.id}
                      className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2"
                      onClick={() => { setOpen(false); setQ(""); navigate({ to: "/tasks/$taskId", params: { taskId: t.id } }); }}
                    >
                      <ListTodo className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate flex-1">{t.title}</span>
                      <span className="text-xs text-muted-foreground">{t.status}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.projects.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">Projects</div>
                  {results.projects.map((p) => (
                    <div key={p.id} className="px-3 py-2 flex items-center gap-2">
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <span>{p.name}</span>
                    </div>
                  ))}
                </div>
              )}
              {results.people.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-xs uppercase tracking-wide text-muted-foreground">People</div>
                  {results.people.map((p) => (
                    <div key={p.id} className="px-3 py-2 flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">{p.full_name || "—"}</span>
                      {p.designation && <span className="text-xs text-muted-foreground">{p.designation}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
