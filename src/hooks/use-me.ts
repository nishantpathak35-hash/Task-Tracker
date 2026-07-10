import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MeData = {
  user: { id: string; email: string | null };
  profile: {
    id: string;
    org_id: string | null;
    department_id: string | null;
    full_name: string | null;
    avatar_url: string | null;
    designation: string | null;
  } | null;
  org: { id: string; name: string; timezone: string; currency: string } | null;
  roles: Array<"super_admin" | "manager" | "employee">;
};

export function useMe() {
  return useQuery<MeData>({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not signed in");
      const client = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> };
          };
        };
      };
      const [{ data: profile }, { data: roles }] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("profiles").select("*").eq("id", u.user.id).maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from("user_roles").select("role").eq("user_id", u.user.id),
      ]);
      void client;
      let org = null;
      if (profile?.org_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: o } = await (supabase as any)
          .from("organizations")
          .select("id,name,timezone,currency")
          .eq("id", profile.org_id)
          .maybeSingle();
        org = o;
      }
      return {
        user: { id: u.user.id, email: u.user.email ?? null },
        profile: profile ?? null,
        org,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        roles: (roles ?? []).map((r: any) => r.role),
      };
    },
    staleTime: 60_000,
  });
}
