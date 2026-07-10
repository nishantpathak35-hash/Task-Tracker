import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  ListTodo,
  Users,
  CalendarDays,
  ShieldCheck,
  BarChart3,
  Settings,
  UserCog,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useMe } from "@/hooks/use-me";

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredRole?: "super_admin" | "manager";
};

const allNav: NavItem[] = [
  { title: "Home", url: "/home", icon: Home },
  { title: "My Work", url: "/my-work", icon: ListTodo },
  { title: "Team", url: "/team", icon: Users, requiredRole: "manager" },
  { title: "Calendar", url: "/calendar", icon: CalendarDays },
  { title: "Compliance", url: "/compliance", icon: ShieldCheck },
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Admin", url: "/admin", icon: UserCog, requiredRole: "super_admin" },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useMe();
  const roles = me?.roles ?? [];

  // Filter nav items based on user's roles
  const nav = allNav.filter((n) => {
    if (!n.requiredRole) return true;
    if (n.requiredRole === "manager") {
      return roles.includes("manager") || roles.includes("super_admin");
    }
    if (n.requiredRole === "super_admin") {
      return roles.includes("super_admin");
    }
    return false;
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/home" className="flex items-center gap-2 px-2 py-2">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground grid place-items-center font-display font-semibold">
            T
          </div>
          <div className="font-display font-semibold group-data-[collapsible=icon]:hidden">TaskOps</div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((n) => (
                <SidebarMenuItem key={n.url}>
                  <SidebarMenuButton asChild isActive={pathname === n.url || pathname.startsWith(n.url + "/")}>
                    <Link to={n.url}>
                      <n.icon />
                      <span>{n.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
