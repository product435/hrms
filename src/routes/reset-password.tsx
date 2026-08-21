import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authService } from "@/services/authService";
import { isStrongPassword, passwordChecks } from "@/lib/password";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ title: "Reset password · TeamNest" }],
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
    setSubmitting(false);

    if (result.error) {
      toast.error("Could not update password", { description: result.error.message });
      return;
    }

    toast.success("Password updated");
    navigate({ to: "/sign-in" });
  }

  return (
    <AuthLayout
      title="Reset password"
      subtitle="Choose a new password for your TeamNest account."
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
