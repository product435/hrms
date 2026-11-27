import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Text for a small count badge (notification bell, sidebar, etc.): exact
 * number up to 10, "10+" beyond that. Use alongside formatBadgeCount's
 * companion check (`count > 0`) to decide whether to render the badge at
 * all -- this only formats the label for an already-positive count. */
export function formatBadgeCount(count: number): string {
  return count > 10 ? "10+" : String(count);
}
