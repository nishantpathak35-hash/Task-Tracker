import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-me";
import {
  inviteUser,
  cancelInvite,
  updateUserRole,
  removeUserFromOrg,
  createDepartment,
  updateDepartment,
  updateMemberDepartment,
} from "@/lib/invite.functions";
import { toast } from "sonner";
import { Mail, Plus, Trash2, UserPlus, Users, Building2, Shield } from "lucide-react";
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

type Member = { id: string; full_name: string | null; designation: string | null; department_id: string | null };
type Dept = { id: string; name: string; manager_id: string | null };
type Role = { user_id: string; role: string };
type Invite = { id: string; email: string; role: string; department_id: string | null; created_at: string };

const adminQuery = queryOptions({
  queryKey: ["admin", "overview"],
  queryFn: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [{ data: members }, { data: departments }, { data: roles }, { data: invites }] = await Promise.all([
      sb.from("profiles").select("id,full_name,designation,department_id"),
      sb.from("departments").select("id,name,manager_id"),
      sb.from("user_roles").select("user_id,role"),
      sb.from("pending_invites").select("id,email,role,department_id,created_at").order("created_at", { ascending: false }),
    ]);
    return {
      members: (members ?? []) as Member[],
      departments: (departments ?? []) as Dept[],
      roles: (roles ?? []) as Role[],
      invites: (invites ?? []) as Invite[],
    };
  },
});

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    // Role guard is handled in the component via useMe — we don't block the route
    // since the query for roles needs the client-side supabase session
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(adminQuery),
  head: () => ({ meta: [{ title: "Admin — TaskOps" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { data } = useSuspenseQuery(adminQuery);
  const { data: me } = useMe();
  const isAdmin = me?.roles.includes("super_admin");

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="h-8 w-8 text-muted-foreground" />
          <div>
            <h1 className="font-display text-3xl font-semibold">Admin</h1>
            <p className="text-sm text-muted-foreground">Access denied — super admin role required.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">Manage workspace members, roles, departments, and invitations.</p>
      </div>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people"><Users className="h-4 w-4 mr-1" /> People</TabsTrigger>
          <TabsTrigger value="departments"><Building2 className="h-4 w-4 mr-1" /> Departments</TabsTrigger>
          <TabsTrigger value="invites"><Mail className="h-4 w-4 mr-1" /> Invitations</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="space-y-4">
          <InviteForm departments={data.departments} />
          <MembersList members={data.members} roles={data.roles} departments={data.departments} currentUserId={me?.user.id} />
        </TabsContent>

        <TabsContent value="departments" className="space-y-4">
          <DepartmentsPanel departments={data.departments} members={data.members} />
        </TabsContent>

        <TabsContent value="invites" className="space-y-4">
          <InvitesList invites={data.invites} departments={data.departments} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Invite Form                                                  */
/* ─────────────────────────────────────────────────────────── */
function InviteForm({ departments }: { departments: Dept[] }) {
  const qc = useQueryClient();
  const invite = useServerFn(inviteUser);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("employee");
  const [deptId, setDeptId] = useState<string>("");

  const mut = useMutation({
    mutationFn: () =>
      invite({
        data: { email, role: role as "super_admin" | "manager" | "employee", department_id: deptId || null },
      }),
    onSuccess: () => {
      toast.success(`Invitation sent to ${email}`);
      setEmail("");
      setRole("employee");
      setDeptId("");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error("Invite failed", { description: e.message }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-4 w-4" /> Invite a team member
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px] space-y-1">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" />
          </div>
          <div className="w-40 space-y-1">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-44 space-y-1">
            <Label>Department</Label>
            <Select value={deptId} onValueChange={setDeptId}>
              <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => mut.mutate()} disabled={!email || mut.isPending}>
            {mut.isPending ? "Sending…" : "Send invite"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Members List                                                 */
/* ─────────────────────────────────────────────────────────── */
function MembersList({
  members,
  roles,
  departments,
  currentUserId,
}: {
  members: Member[];
  roles: Role[];
  departments: Dept[];
  currentUserId?: string;
}) {
  const qc = useQueryClient();
  const changeRole = useServerFn(updateUserRole);
  const changeDept = useServerFn(updateMemberDepartment);
  const remove = useServerFn(removeUserFromOrg);

  const roleMut = useMutation({
    mutationFn: (v: { target_user_id: string; role: string }) =>
      changeRole({ data: { target_user_id: v.target_user_id, role: v.role as "super_admin" | "manager" | "employee" } }),
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["admin"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deptMut = useMutation({
    mutationFn: (v: { target_user_id: string; department_id: string | null }) =>
      changeDept({ data: v }),
    onSuccess: () => {
      toast.success("Department updated");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (target_user_id: string) => remove({ data: { target_user_id } }),
    onSuccess: () => {
      toast.success("Member removed");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const highestRole = (userId: string) => {
    const userRoles = roles.filter((r) => r.user_id === userId).map((r) => r.role);
    if (userRoles.includes("super_admin")) return "super_admin";
    if (userRoles.includes("manager")) return "manager";
    return "employee";
  };

  const deptName = (deptId: string | null) => departments.find((d) => d.id === deptId)?.name ?? "—";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Members ({members.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.map((m) => {
          const role = highestRole(m.id);
          const isSelf = m.id === currentUserId;
          return (
            <div key={m.id} className="flex items-center gap-3 border rounded-lg p-3">
              <div className="h-9 w-9 rounded-full bg-primary/10 text-primary grid place-items-center text-sm font-semibold shrink-0">
                {(m.full_name || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{m.full_name || m.id.slice(0, 8)}</div>
                <div className="text-xs text-muted-foreground">{m.designation || deptName(m.department_id)}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={role}
                  onValueChange={(v) => roleMut.mutate({ target_user_id: m.id, role: v })}
                  disabled={isSelf}
                >
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={m.department_id ?? ""}
                  onValueChange={(v) => deptMut.mutate({ target_user_id: m.id, department_id: v || null })}
                >
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue placeholder="No dept" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isSelf && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove member?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {m.full_name || "This user"} will lose access to all workspace data. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => removeMut.mutate(m.id)}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          );
        })}
        {members.length === 0 && <p className="text-sm text-muted-foreground">No members yet.</p>}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Departments Panel                                            */
/* ─────────────────────────────────────────────────────────── */
function DepartmentsPanel({ departments, members }: { departments: Dept[]; members: Member[] }) {
  const qc = useQueryClient();
  const create = useServerFn(createDepartment);
  const update = useServerFn(updateDepartment);
  const [name, setName] = useState("");

  const createMut = useMutation({
    mutationFn: () => create({ data: { name } }),
    onSuccess: () => {
      toast.success("Department created");
      setName("");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; manager_id: string | null }) =>
      update({ data: v }),
    onSuccess: () => {
      toast.success("Department updated");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" /> Create department
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="flex-1 space-y-1">
              <Label htmlFor="dept-name">Name</Label>
              <Input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" />
            </div>
            <Button onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending}>
              {createMut.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Departments ({departments.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {departments.map((d) => {
            const memberCount = members.filter((m) => m.department_id === d.id).length;
            return (
              <div key={d.id} className="flex items-center gap-3 border rounded-lg p-3">
                <div className="flex-1">
                  <div className="font-medium text-sm">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{memberCount} member{memberCount !== 1 ? "s" : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-muted-foreground">Manager</div>
                    <Select
                      value={d.manager_id ?? ""}
                      onValueChange={(v) => updateMut.mutate({ id: d.id, manager_id: v || null })}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.full_name || m.id.slice(0, 6)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            );
          })}
          {departments.length === 0 && <p className="text-sm text-muted-foreground">No departments.</p>}
        </CardContent>
      </Card>
    </>
  );
}

/* ─────────────────────────────────────────────────────────── */
/* Pending Invites List                                         */
/* ─────────────────────────────────────────────────────────── */
function InvitesList({ invites, departments }: { invites: Invite[]; departments: Dept[] }) {
  const qc = useQueryClient();
  const cancel = useServerFn(cancelInvite);

  const cancelMut = useMutation({
    mutationFn: (invite_id: string) => cancel({ data: { invite_id } }),
    onSuccess: () => {
      toast.success("Invite cancelled");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Pending invitations ({invites.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {invites.map((inv) => (
          <div key={inv.id} className="flex items-center gap-3 border rounded-lg p-3">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{inv.email}</div>
              <div className="text-xs text-muted-foreground">
                {inv.role.replace("_", " ")} · {deptName(inv.department_id)} · sent {new Date(inv.created_at).toLocaleDateString()}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="secondary" className="text-[10px]">Pending</Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => cancelMut.mutate(inv.id)}
                disabled={cancelMut.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {invites.length === 0 && <p className="text-sm text-muted-foreground">No pending invitations.</p>}
      </CardContent>
    </Card>
  );
}
