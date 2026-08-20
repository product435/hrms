import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, LogOut, Menu, Moon, Search, Settings, Sun, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { workplaceService } from "@/services/workplaceService";
import { assetService } from "@/services/assetService";
import { employeeService } from "@/services/employeeService";

type SearchResult = {
  id: string;
  label: string;
  detail: string;
  kind: "employee" | "asset" | "request";
};

export function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const { user, role, signOut } = useSession();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [search, setSearch] = useState("");
  const notifications = useQuery({
    queryKey: ["notifications", "topbar"],
    queryFn: () => workplaceService.notifications(),
  });
  const notificationItems = notifications.data ?? [];
  const unread = notificationItems.filter((n) => !n.read).length;
  const searchQuery = useQuery({
    queryKey: ["global-search", search.trim()],
    enabled: search.trim().length >= 2,
    queryFn: async (): Promise<SearchResult[]> => {
      const [employees, assets, requests] = await Promise.all([
        employeeService.list({ search: search.trim() }),
        assetService.list({ search: search.trim() }),
        workplaceService.tickets({ search: search.trim() }),
      ]);
      return [
        ...employees.slice(0, 4).map((employee) => ({
          id: employee.id,
          label: `${employee.firstName} ${employee.lastName}`,
          detail: `${employee.designation} · ${employee.department}`,
          kind: "employee" as const,
        })),
        ...assets.slice(0, 3).map((asset) => ({
          id: asset.id,
          label: asset.name,
          detail: `${asset.tag} · ${asset.status}`,
          kind: "asset" as const,
        })),
        ...requests.slice(0, 3).map((request) => ({
          id: request.id,
          label: request.subject,
          detail: `${request.category} · ${request.status}`,
          kind: "request" as const,
        })),
      ];
    },
  });
  const searchResults = searchQuery.data ?? [];
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("");

  return (
    <header className="sticky top-0 z-30 flex h-[4.5rem] items-center gap-2 border-b border-border/80 bg-background/85 px-3 backdrop-blur-xl sm:gap-3 sm:px-5 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <div className="relative hidden min-w-0 flex-1 md:block md:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-10 bg-surface-2/70 pl-9"
          placeholder="Search people, assets, requests…"
          aria-label="Global search"
        />
        {search.trim().length >= 2 ? (
          <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-2xl border border-border bg-popover p-1.5 shadow-float">
            {searchQuery.isLoading ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">Searching…</p>
            ) : searchResults.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No results found.
              </p>
            ) : (
              searchResults.map((result) => (
                <button
                  key={`${result.kind}-${result.id}`}
                  type="button"
                  className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted"
                  onClick={() => {
                    setSearch("");
                    if (result.kind === "employee") {
                      navigate({ to: "/employees/$employeeId", params: { employeeId: result.id } });
                    } else {
                      navigate({ to: result.kind === "asset" ? "/assets" : "/helpdesk" });
                    }
                  }}
                >
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{result.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {result.detail}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

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
              {notificationItems.slice(0, 4).map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground/80">{item.createdAt}</p>
                </li>
              ))}
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
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-semibold">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/employees/$employeeId" params={{ employeeId: user.id }}>
                <UserCircle2 className="size-4" /> My profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <Settings className="size-4" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => {
                void signOut();
                void navigate({ to: "/sign-in" });
              }}
            >
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
