import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfAuthenticated } from "@/lib/auth-guard";
import { IDLE_SESSION_MESSAGE } from "@/components/auth/IdleSessionGuard";
import { authService, EMPLOYMENT_BLOCKED_MESSAGE } from "@/services/authService";

type SignInSearch = {
  redirect?: string;
  blocked?: "employment";
  expired?: "idle";
};

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    ...(typeof search["redirect"] === "string" ? { redirect: search["redirect"] } : {}),
    ...(search["blocked"] === "employment" ? { blocked: "employment" } : {}),
    ...(search["expired"] === "idle" ? { expired: "idle" as const } : {}),
  }),
  beforeLoad: () => redirectIfAuthenticated(),
  head: () => ({
    meta: [{ title: "Sign in · JeeVijay HRMS" }],
  }),
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const redirect = search.redirect;
  const employmentBlocked = search.blocked === "employment";
  const idleExpired = search.expired === "idle";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter your email and password");
      return;
    }

    setSubmitting(true);
    const result = await authService.signIn(email, password);
    setSubmitting(false);

    if (result.error) {
      toast.error("Sign in failed", { description: result.error.message });
      return;
    }

    toast.success("Welcome back");
    navigate({ to: redirect || "/" });
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Access your JeeVijay HRMS workspace with your organisation account."
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {employmentBlocked ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {EMPLOYMENT_BLOCKED_MESSAGE}
          </p>
        ) : null}
        {idleExpired ? (
          <p
            role="status"
            className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground"
          >
            {IDLE_SESSION_MESSAGE}
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
