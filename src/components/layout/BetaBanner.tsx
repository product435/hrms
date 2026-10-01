import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, X } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { settingsService } from "@/services/settingsService";

function todayIso() {
  // en-CA formats as YYYY-MM-DD; Asia/Kolkata matches the server-side check.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function BetaBanner() {
  const { isAuthenticated } = useSession();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem("beta-banner-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const { data } = useQuery({
    queryKey: ["beta-until"],
    queryFn: () => settingsService.betaUntil(),
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });

  if (!data || dismissed || data < todayIso()) return null;

  const label = new Date(`${data}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="flex items-center gap-2 border-b border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 sm:px-5 lg:px-8">
      <FlaskConical className="size-3.5 shrink-0" />
      <p className="flex-1">Beta — data may be reset until {label}.</p>
      <button
        type="button"
        aria-label="Dismiss beta notice"
        className="rounded p-0.5 hover:bg-amber-100"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem("beta-banner-dismissed", "1");
          } catch {
            /* ignore */
          }
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
