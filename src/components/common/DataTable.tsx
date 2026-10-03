import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { cn } from "@/lib/utils";

export type SortValue = string | number | boolean | Date | null | undefined;

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right";
  /** Provide a primitive to make this column sortable. Existing columns stay unsorted until set. */
  sortValue?: (row: T) => SortValue;
  /** When true and `sortValue` is omitted, sort by a primitive field of the same name as `key`. */
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows?: T[] | undefined;
  data?: T[];
  rowKey: (row: T) => string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  toolbar?: ReactNode;
  caption?: string;
  /**
   * Rows per page. Defaults to 10.
   * Pass `0` to show every row without a pager.
   */
  pageSize?: number;
}

type SortState = { key: string; direction: "asc" | "desc" };

function columnIsSortable<T>(column: Column<T>) {
  return Boolean(column.sortValue) || column.sortable === true;
}

function readSortValue<T>(row: T, column: Column<T>): SortValue {
  if (column.sortValue) return column.sortValue(row);
  if (column.sortable && row && typeof row === "object" && column.key in row) {
    const raw = (row as Record<string, unknown>)[column.key];
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean" ||
      raw instanceof Date ||
      raw == null
    ) {
      return raw;
    }
  }
  return null;
}

function compareSortValues(left: SortValue, right: SortValue) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left instanceof Date || right instanceof Date) {
    const leftTime = left instanceof Date ? left.getTime() : Number(left);
    const rightTime = right instanceof Date ? right.getTime() : Number(right);
    return leftTime - rightTime;
  }
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function DataTable<T>({
  columns,
  rows,
  data,
  rowKey,
  isLoading,
  isError,
  onRetry,
  onRowClick,
  emptyTitle = "Nothing here yet",
  emptyDescription = "Once records exist they will show up in this table.",
  toolbar,
  caption,
  pageSize = 10,
}: DataTableProps<T>) {
  const tableRows = data ?? rows;
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(0);
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 0;

  const sortedRows = useMemo(() => {
    const source = tableRows ?? [];
    if (!sort) return source;
    const column = columns.find((item) => item.key === sort.key);
    if (!column || !columnIsSortable(column)) return source;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...source].sort(
      (left, right) =>
        direction * compareSortValues(readSortValue(left, column), readSortValue(right, column)),
    );
  }, [columns, sort, tableRows]);

  const pageCount = size > 0 ? Math.max(1, Math.ceil(sortedRows.length / size)) : 1;
  const safePage = size > 0 ? Math.min(page, pageCount - 1) : 0;
  const visibleRows =
    size > 0 ? sortedRows.slice(safePage * size, safePage * size + size) : sortedRows;
  const rangeStart = sortedRows.length === 0 ? 0 : safePage * (size || sortedRows.length) + 1;
  const rangeEnd =
    size > 0 ? Math.min(sortedRows.length, rangeStart + visibleRows.length - 1) : sortedRows.length;

  function toggleSort(key: string) {
    setPage(0);
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  return (
    <section className="surface-card overflow-hidden">
      {toolbar ? (
        <div className="border-b border-border bg-surface-2/25 p-3 sm:p-4">{toolbar}</div>
      ) : null}
      {isLoading ? (
        <TableSkeleton columns={Math.min(columns.length, 6)} />
      ) : isError ? (
        <ErrorState onRetry={onRetry} />
      ) : !tableRows || tableRows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="scroll-slim overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-surface-2/55 hover:bg-surface-2/70">
                  {columns.map((col) => {
                    const sortable = columnIsSortable(col);
                    const active = sort?.key === col.key ? sort.direction : undefined;
                    return (
                      <TableHead
                        key={col.key}
                        aria-sort={
                          sortable
                            ? active === "asc"
                              ? "ascending"
                              : active === "desc"
                                ? "descending"
                                : "none"
                            : undefined
                        }
                        className={cn(
                          "whitespace-nowrap text-xs font-semibold uppercase tracking-widest text-muted-foreground",
                          col.align === "right" && "text-right",
                          col.className,
                        )}
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              col.align === "right" && "ml-auto",
                            )}
                          >
                            {col.header}
                            <span className="sr-only">
                              {active === "asc"
                                ? ", sorted ascending"
                                : active === "desc"
                                  ? ", sorted descending"
                                  : ", not sorted"}
                            </span>
                            {active === "asc" ? (
                              <ChevronUp className="size-3.5" aria-hidden />
                            ) : active === "desc" ? (
                              <ChevronDown className="size-3.5" aria-hidden />
                            ) : (
                              <ChevronDown className="size-3.5 opacity-40" aria-hidden />
                            )}
                          </button>
                        ) : (
                          col.header
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRows.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        className={cn(
                          "py-4 align-middle",
                          col.align === "right" && "text-right",
                          col.className,
                        )}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {size > 0 && pageCount > 1 ? (
            <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Showing {rangeStart}-{rangeEnd} of {sortedRows.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                >
                  Previous
                </Button>
                <p className="min-w-16 text-center text-xs text-muted-foreground">
                  Page {safePage + 1} of {pageCount}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {caption && tableRows && tableRows.length > 0 ? (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{caption}</p>
      ) : null}
    </section>
  );
}
