import { Link, useRouterState } from "@tanstack/react-router";
import { UserCircle2 } from "lucide-react";
import { employeeLabelOverrides, managerLabelOverrides, navForRole } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { Brand } from "./Brand";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { role, user } = useSession();
  const profileEmployeeId = user.employeeId ?? user.id;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const sections = navForRole(role);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-[4.5rem] shrink-0 items-center border-b border-sidebar-border px-5">
        <Brand />
      </div>

      <nav className="scroll-slim flex-1 overflow-y-auto px-3 py-4">
        {role === "employee" ? (
          <ul className="mb-5 space-y-1">
            <li>
              <Link
                to="/employees/$employeeId"
                params={{ employeeId: profileEmployeeId }}
                onClick={onNavigate}
                className={cn(
                  "group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  pathname === `/employees/${profileEmployeeId}`
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-card"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <UserCircle2 className="size-4 shrink-0 opacity-70" />
                <span className="truncate">My Profile</span>
              </Link>
            </li>
          </ul>
        ) : null}
        {sections.map((section) => (
          <div key={section.title} className="mb-5">
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sidebar-foreground/45">
              {section.title}
            </p>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const label =
                  role === "employee"
                    ? (employeeLabelOverrides[item.to] ?? item.label)
                    : role === "manager"
                      ? (managerLabelOverrides[item.to] ?? item.label)
                      : item.label;
                const isActive = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      onClick={onNavigate}
                      className={cn(
                        "group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-card"
                          : "text-sidebar-foreground/75 hover:translate-x-0.5 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <item.icon
                        className={cn(
                          "size-4 shrink-0",
                          isActive ? "text-sidebar-primary" : "opacity-70",
                        )}
                      />
                      <span className="truncate">{label}</span>
                      {isActive ? (
                        <span className="ml-auto size-1.5 shrink-0 rounded-full bg-sidebar-primary" />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-3">
        <div className="rounded-xl bg-sidebar-accent/50 p-3">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-sidebar-foreground/60">{user.designation}</p>
        </div>
      </div>
    </div>
  );
}
