import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/States";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: "left" | "right";
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
}: DataTableProps<T>) {
  const tableRows = data ?? rows;
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
        <div className="scroll-slim overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-2/55 hover:bg-surface-2/70">
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={cn(
                      "whitespace-nowrap text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground",
                      col.align === "right" && "text-right",
                      col.className,
                    )}
                  >
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRows.map((row) => (
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
      )}
      {caption && tableRows && tableRows.length > 0 ? (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{caption}</p>
      ) : null}
    </section>
  );
}
