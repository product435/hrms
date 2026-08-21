import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth-guard";
import { ROLE_LABELS, useSession } from "@/hooks/useSession";

export const Route = createFileRoute("/unauthorized")({
  beforeLoad: () => requireAuth(),
  head: () => ({
    meta: [{ title: "Access denied · TeamNest" }],
  }),
  component: UnauthorizedPage,
});

function UnauthorizedPage() {
  const { role } = useSession();

  return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <ShieldAlert className="size-7" />
        </span>
        <div className="max-w-md space-y-2">
          <h1 className="text-2xl font-bold">Access denied</h1>
          <p className="text-sm text-muted-foreground">
            Your {ROLE_LABELS[role]} account does not have permission to view this page. Contact HR or
            your administrator if you believe this is a mistake.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/">Go to dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/helpdesk">Contact HR helpdesk</Link>
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
