import { useEffect, useRef } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export const IDLE_SESSION_MESSAGE =
  "Your session expired due to inactivity. Sign in again to continue.";

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "click"] as const;

let lastActivityAt = Date.now();

function recordActivity() {
  lastActivityAt = Date.now();
}

export function IdleSessionGuard() {
  const { isAuthenticated, isLoading, signOut } = useSession();
  const navigate = useNavigate();
  const router = useRouter();
  const signOutRef = useRef(signOut);
  const navigateRef = useRef(navigate);
  const routerRef = useRef(router);
  signOutRef.current = signOut;
  navigateRef.current = navigate;
  routerRef.current = router;

  useEffect(() => {
    if (isLoading || !isAuthenticated || !isSupabaseConfigured || !supabase) return;

    const client = supabase;
    recordActivity();
    let active = true;
    let expiring = false;

    const expireIfIdle = () => {
      if (!active || expiring) return;
      if (Date.now() - lastActivityAt < IDLE_TIMEOUT_MS) return;
      expiring = true;
      void (async () => {
        const { data } = await client.auth.getSession();
        if (!active) return;
        if (!data.session) {
          expiring = false;
          return;
        }
        if (Date.now() - lastActivityAt < IDLE_TIMEOUT_MS) {
          expiring = false;
          return;
        }
        const result = await signOutRef.current({ scope: "local" });
        if (!active) return;
        if (result.error) {
          expiring = false;
          toast.error("Could not end the idle session", { description: result.error.message });
          return;
        }
        await navigateRef.current({ to: "/sign-in", search: { expired: "idle" }, replace: true });
        await routerRef.current.invalidate();
      })();
    };

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, recordActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", expireIfIdle);
    const timer = window.setInterval(expireIfIdle, 5_000);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", expireIfIdle);
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, recordActivity);
      }
    };
  }, [isAuthenticated, isLoading]);

  return null;
}
