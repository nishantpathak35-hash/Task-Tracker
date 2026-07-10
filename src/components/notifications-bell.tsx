import { useEffect } from "react";
import { Bell } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { Link } from "@tanstack/react-router";

type Notif = {
  id: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
};

export function NotificationsBell() {
  const qc = useQueryClient();
  const { data: notifs = [] } = useQuery<Notif[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("notifications")
        .select("id,title,body,read_at,created_at,type,entity_type,entity_id")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
    refetchInterval: 30_000,
  });

  const markReadMut = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => qc.invalidateQueries({ queryKey: ["notifications"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const unread = notifs.filter((n) => !n.read_at).length;

  return (
    <Popover
      onOpenChange={async (open) => {
        if (!open && unread) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from("notifications")
            .update({ read_at: new Date().toISOString() })
            .is("read_at", null);
          qc.invalidateQueries({ queryKey: ["notifications"] });
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1 grid place-items-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="px-4 py-3 border-b">
          <div className="font-medium">Notifications</div>
          <div className="text-xs text-muted-foreground">
            {unread > 0 ? `${unread} unread` : "You're all caught up"}
          </div>
        </div>
        <ScrollArea className="max-h-96">
          {notifs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nothing yet.</div>
          ) : (
            <ul className="divide-y">
              {notifs.map((n) => {
                const content = (
                  <div className={`p-3 text-sm transition-colors hover:bg-accent/50 ${n.read_at ? "" : "bg-accent/20"}`}>
                    <div className="font-medium">{n.title}</div>
                    {n.body && <div className="text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>}
                    <div className="text-[10px] text-muted-foreground mt-1.5">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </div>
                  </div>
                );

                if (n.entity_type === "task" && n.entity_id) {
                  return (
                    <li key={n.id}>
                      <Link
                        to="/tasks/$taskId"
                        params={{ taskId: n.entity_id }}
                        className="block"
                        onClick={() => {
                          if (!n.read_at) markReadMut.mutate(n.id);
                        }}
                      >
                        {content}
                      </Link>
                    </li>
                  );
                }

                return <li key={n.id}>{content}</li>;
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
