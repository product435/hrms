import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface FilterConfig {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function FilterBar({
  search,
  onSearchChange,
  placeholder = "Search…",
  searchPlaceholder,
  filters = [],
  status,
  onStatusChange,
  statusOptions,
  actions,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  filters?: FilterConfig[];
  status?: string;
  statusLabel?: string;
  onStatusChange?: (value: string) => void;
  statusOptions?: { value: string; label: string }[];
  actions?: ReactNode;
}) {
  const allFilters = [
    ...filters,
    ...(status !== undefined && onStatusChange && statusOptions
      ? [
          {
            id: "status",
            label: "Status",
            value: status,
            options: statusOptions,
            onChange: onStatusChange,
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative min-w-0 flex-1 lg:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder ?? placeholder}
          className="h-10 pl-9"
          aria-label={placeholder}
        />
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {allFilters.map((filter) => (
          <Select key={filter.id} value={filter.value} onValueChange={filter.onChange}>
            <SelectTrigger className="h-10 w-full sm:w-[170px]" aria-label={filter.label}>
              <SelectValue placeholder={filter.label} />
            </SelectTrigger>
            <SelectContent>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {actions}
      </div>
    </div>
  );
}
