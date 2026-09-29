import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  authService,
  hasPasswordRecoveryEvent,
  openedWithRecoveryCredentials,
} from "@/services/authService";
import { passwordResetRequestService } from "@/services/passwordResetRequestService";
import { supabase } from "@/lib/supabase";
import { isStrongPassword, passwordChecks } from "@/lib/password";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ title: "Reset password · JeeVijay HRMS" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const passwordStatus = passwordChecks(password);
  const confirmPasswordStatus = passwordChecks(confirmPassword);

  // Opening this page from the emailed reset link is what actually
  // establishes the recovery session (the Supabase browser client exchanges
  // the link's code/token for one as soon as it sees the URL). If someone
  // reaches this route any other way -- an expired link, a stale bookmark,
  // no link at all -- there's no session to update a password against, so
  // that's surfaced clearly instead of letting them fill out a form that can
  // only fail at the end.
  const [sessionStatus, setSessionStatus] = useState<
    "checking" | "valid" | "invalid" | "redirecting"
  >("checking");

  useEffect(() => {
    if (!supabase) {
      setSessionStatus("invalid");
      return;
    }
    const client = supabase;
    let active = true;
    let accepted = false;
    let left = false;

    const accept = () => {
      if (!active || left) return;
      accepted = true;
      setSessionStatus("valid");
    };

    const redirectSignedInUser = () => {
      if (!active || accepted || left || hasPasswordRecoveryEvent()) return;
      left = true;
      setSessionStatus("redirecting");
      void navigate({ to: "/", replace: true });
    };

    if (hasPasswordRecoveryEvent()) accept();

    const { data: subscription } = client.auth.onAuthStateChange((event) => {
      if (!active || accepted || left) return;
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && hasPasswordRecoveryEvent())) {
        accept();
      }
    });

    void client.auth.getSession().then(({ data }) => {
      if (!active || accepted || left) return;
      if (hasPasswordRecoveryEvent()) {
        accept();
        return;
      }
      if (data.session && !openedWithRecoveryCredentials()) redirectSignedInUser();
    });

    const timeout = setTimeout(() => {
      if (!active || accepted || left) return;
      if (hasPasswordRecoveryEvent()) {
        accept();
        return;
      }
      void client.auth.getSession().then(({ data }) => {
        if (!active || accepted || left) return;
        if (hasPasswordRecoveryEvent()) {
          accept();
          return;
        }
        if (data.session) redirectSignedInUser();
        else setSessionStatus("invalid");
      });
    }, 4000);

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (!isStrongPassword(password)) {
      toast.error("Password does not meet the requirements");
      return;
    }

    setSubmitting(true);
    const result = await authService.updatePassword(password);

    if (result.error) {
      setSubmitting(false);
      toast.error("Could not update password", { description: result.error.message });
      return;
    }

    // Best-effort: if this recovery session belongs to an approved
    // admin-reviewed request, close the loop on its lifecycle. Must happen
    // before signing out -- it relies on the current (recovery) session.
    // Never blocks the actual password-update success on this.
    try {
      await passwordResetRequestService.markCompleted();
    } catch {
      // No matching request is the common case (direct-flow resets, e.g.
      // the Admin's own) -- nothing to report.
    }

    // The recovery session is only meant to get the password changed, not to
    // leave the user silently signed in -- sign out so /sign-in shows the
    // actual sign-in form rather than bouncing straight past it.
    await authService.signOut();
    setSubmitting(false);
    toast.success("Password updated", { description: "Sign in with your new password." });
    navigate({ to: "/sign-in" });
  }

  if (sessionStatus === "checking" || sessionStatus === "redirecting") {
    return (
      <AuthLayout
        title="Reset password"
        subtitle={
          sessionStatus === "redirecting"
            ? "Taking you to your workspace…"
            : "Verifying your reset link…"
        }
      >
        <div className="flex justify-center py-6">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </AuthLayout>
    );
  }

  if (sessionStatus === "invalid") {
    return (
      <AuthLayout
        title="Reset link invalid or expired"
        subtitle="This password reset link is no longer valid."
        footer={
          <Link to="/sign-in" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldAlert className="size-6" />
          </span>
          <p className="text-sm text-muted-foreground">
            Reset links expire after a short time and can only be used once. Request a new one to
            continue.
          </p>
          <Button asChild className="mt-2">
            <Link to="/forgot-password">Request a new reset link</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset password"
      subtitle="Choose a new password for your JeeVijay HRMS account."
      footer={
        <Link to="/sign-in" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
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
          <PasswordRequirements checks={passwordStatus} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((visible) => !visible)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
            >
              {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <PasswordRequirements checks={confirmPasswordStatus} />
          {confirmPassword.length > 0 && password !== confirmPassword ? (
            <p className="text-xs text-destructive">Passwords do not match.</p>
          ) : null}
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Update password
        </Button>
      </form>
    </AuthLayout>
  );
}

function PasswordRequirements({ checks }: { checks: ReturnType<typeof passwordChecks> }) {
  const progress = checks.filter((requirement) => requirement.met).length;

  return (
    <div
      className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3"
      aria-live="polite"
    >
      <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
        <span>Password strength</span>
        <span>{progress}/5 requirements</span>
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {checks.map((requirement) => (
          <span
            key={requirement.key}
            className={`h-1.5 flex-1 rounded-full ${requirement.met ? "bg-success" : "bg-border"}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3">
        {checks.map((requirement) => (
          <span
            key={requirement.key}
            className={requirement.met ? "text-success" : "text-muted-foreground"}
          >
            {requirement.met ? "✓" : "✗"} {requirement.label}
          </span>
        ))}
      </div>
    </div>
  );
}
