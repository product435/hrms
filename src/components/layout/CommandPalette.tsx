import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { UserCircle2 } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useSession } from "@/hooks/useSession";
import {
  deptHeadLabelOverrides,
  employeeLabelOverrides,
  leadLabelOverrides,
  navForRole,
  type NavItem,
} from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";
import { assetService } from "@/services/assetService";
import { employeeService } from "@/services/employeeService";
import { workplaceService } from "@/services/workplaceService";
import type { Role } from "@/types";

type SearchResult = {
  id: string;
  label: string;
  detail: string;
  kind: "employee" | "asset" | "request";
};

function labelFor(role: Role, item: NavItem) {
  if (role === "employee") return employeeLabelOverrides[item.to] ?? item.label;
  if (role === "dept_head") return deptHeadLabelOverrides[item.to] ?? item.label;
  if (role === "team_lead") return leadLabelOverrides[item.to] ?? item.label;
  return item.label;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { role, user } = useSession();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const profileEmployeeId = user.employeeId ?? user.id;
  const needle = query.trim().toLowerCase();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const pages = useMemo(() => {
    const items: {
      to: string;
      label: string;
      icon: NavItem["icon"];
      badge?: string;
      section: string;
    }[] = navForRole(role).flatMap((section) =>
      section.items.map((item) => ({
        to: item.to,
        label: labelFor(role, item),
        icon: item.icon,
        ...(item.badge != null ? { badge: item.badge } : {}),
        section: section.title,
      })),
    );
    if (role === "employee") {
      items.unshift({
        to: "/employees/$employeeId",
        label: "My Profile",
        icon: UserCircle2 as NavItem["icon"],
        section: "Overview",
      });
    }
    if (!needle) return items;
    return items.filter(
      (item) => item.label.toLowerCase().includes(needle) || item.to.toLowerCase().includes(needle),
    );
  }, [needle, role]);

  const searchQuery = useQuery({
    queryKey: queryKeys.search.global(query.trim()),
    enabled: open && query.trim().length >= 2,
    queryFn: async (): Promise<SearchResult[]> => {
      const term = query.trim();
      const [employees, assets, requests] = await Promise.all([
        employeeService.list({ search: term }),
        assetService.list({ search: term }),
        workplaceService.tickets({ search: term }),
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

  function closeAndGo(to: string, employeeId?: string) {
    onOpenChange(false);
    if (to === "/employees/$employeeId" && employeeId) {
      void navigate({ to: "/employees/$employeeId", params: { employeeId } });
      return;
    }
    void navigate({ to: to as "/" });
  }

  const results = searchQuery.data ?? [];
  const people = results.filter((item) => item.kind === "employee");
  const assets = results.filter((item) => item.kind === "asset");
  const requests = results.filter((item) => item.kind === "request");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Jump to a page or search people, assets, and requests.
        </DialogDescription>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search pages, people, assets, requests"
          />
          <CommandList>
            {searchQuery.isFetching && query.trim().length >= 2 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Searching</p>
            ) : (
              <CommandEmpty>No matches</CommandEmpty>
            )}
            {pages.length > 0 ? (
              <CommandGroup heading="Pages">
                {pages.map((item) => (
                  <CommandItem
                    key={`${item.section}-${item.to}-${item.label}`}
                    value={`${item.label} ${item.to}`}
                    onSelect={() =>
                      closeAndGo(
                        item.to,
                        item.to === "/employees/$employeeId" ? profileEmployeeId : undefined,
                      )
                    }
                  >
                    <item.icon />
                    <span className="truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-foreground">
                        {item.badge}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {people.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="People">
                  {people.map((item) => (
                    <CommandItem
                      key={`employee-${item.id}`}
                      value={`${item.label} ${item.detail} ${query}`}
                      onSelect={() => closeAndGo("/employees/$employeeId", item.id)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.detail}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
            {assets.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Assets">
                  {assets.map((item) => (
                    <CommandItem
                      key={`asset-${item.id}`}
                      value={`${item.label} ${item.detail} ${query}`}
                      onSelect={() => closeAndGo("/assets")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.detail}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
            {requests.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Requests">
                  {requests.map((item) => (
                    <CommandItem
                      key={`request-${item.id}`}
                      value={`${item.label} ${item.detail} ${query}`}
                      onSelect={() => closeAndGo("/helpdesk")}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.detail}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
