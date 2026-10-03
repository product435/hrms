import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Bell,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  UserCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/layout/CommandPalette";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ROLE_LABELS, useSession } from "@/hooks/useSession";
import { useTheme } from "@/hooks/useTheme";
import { indianDateTime } from "@/lib/format";
import { notificationTarget } from "@/lib/notification-target";
import { queryKeys } from "@/lib/query-keys";
import { workplaceService } from "@/services/workplaceService";

export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { user, role, signOut, can } = useSession();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [signingOut, setSigningOut] = useState<"local" | "global" | null>(null);

  async function handleSignOut(scope: "local" | "global") {
    if (signingOut) return;
    setSigningOut(scope);
    const result = await signOut({ scope });
    if (result.error) {
      toast.error(scope === "global" ? "Could not sign out of all devices" : "Sign out failed", {
        description: result.error.message,
      });
      setSigningOut(null);
      return;
    }

    await navigate({ to: "/sign-in", replace: true });
    await router.invalidate();
  }
  const notifications = useQuery({
    queryKey: queryKeys.notifications.topbar,
    queryFn: () => workplaceService.notifications(),
  });
  const markRead = useMutation({
    mutationFn: (id: string) => workplaceService.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.topbar });
    },
  });
  const notificationItems = notifications.data ?? [];
  const unread = notificationItems.filter((n) => !n.read).length;
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("");

  return (
    <header className="sticky top-0 z-30 flex h-18 items-center gap-2 border-b border-border/80 bg-background/85 px-3 backdrop-blur-xl sm:gap-3 sm:px-5 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <Button
        type="button"
        variant="outline"
        onClick={() => setPaletteOpen(true)}
        className="hidden h-10 min-w-0 flex-1 justify-start bg-surface-2/70 px-3 font-normal text-muted-foreground hover:translate-y-0 md:flex md:max-w-md"
      >
        <Search className="size-4" />
        <span className="truncate">Search people, assets, requests</span>
        <kbd className="ml-auto hidden rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground lg:inline">
          Ctrl K
        </kbd>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search"
      >
        <Search className="size-5" />
      </Button>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="hidden items-center gap-2 rounded-lg border border-border px-3 py-2 sm:flex">
          <UserCircle2 className="size-4 text-primary" />
          <span className="text-xs font-semibold">{ROLE_LABELS[role]}</span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="size-10 shrink-0"
        >
          {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative size-10 shrink-0"
              aria-label="Notifications"
            >
              <Bell className="size-5" />
              {unread > 0 ? (
                <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                  {unread}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold">Notifications</p>
              <StatusBadge status={`${unread} new`} tone="info" />
            </div>
            <ul className="scroll-slim max-h-72 divide-y divide-border overflow-y-auto">
              {notificationItems.slice(0, 4).map((item) => {
                const target = notificationTarget(item);
                const content = (
                  <>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground/80">
                      {indianDateTime(item.createdAt)}
                    </p>
                  </>
                );
                return (
                  <li key={item.id}>
                    {target ? (
                      <a
                        href={target.href}
                        onClick={() => {
                          if (!item.read) markRead.mutate(item.id);
                        }}
                        className="block px-4 py-3 transition-colors hover:bg-primary/10"
                      >
                        {content}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!item.read) markRead.mutate(item.id);
                        }}
                        className="block w-full px-4 py-3 text-left transition-colors hover:bg-primary/10"
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-border p-2">
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link to="/notifications">View all</Link>
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-xl border border-border bg-surface px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              aria-label="Profile menu"
            >
              <span className="gradient-hero grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-primary-foreground">
                {initials}
              </span>
              <span className="hidden min-w-0 leading-tight sm:block">
                <span className="block truncate text-xs font-semibold">{user.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {user.department}
                </span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-semibold">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/employees/$employeeId" params={{ employeeId: user.employeeId ?? user.id }}>
                <UserCircle2 className="size-4" /> My profile
              </Link>
            </DropdownMenuItem>
            {can(["admin", "hr", "dept_head", "team_lead"]) ? (
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <Settings className="size-4" /> Settings
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={signingOut !== null}
              onSelect={(event) => {
                event.preventDefault();
                void handleSignOut("local");
              }}
            >
              {signingOut === "local" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogOut className="size-4" />
              )}
              {signingOut === "local" ? "Signing out…" : "Sign out"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              disabled={signingOut !== null}
              onSelect={(event) => {
                event.preventDefault();
                void handleSignOut("global");
              }}
            >
              {signingOut === "global" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MonitorSmartphone className="size-4" />
              )}
              {signingOut === "global" ? "Signing out…" : "Sign out of all devices"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
