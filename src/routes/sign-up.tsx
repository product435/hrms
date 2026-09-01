import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfAuthenticated } from "@/lib/auth-guard";
import { authService } from "@/services/authService";
import { isStrongPassword, passwordChecks } from "@/lib/password";

export const Route = createFileRoute("/sign-up")({
  beforeLoad: () => redirectIfAuthenticated(),
  head: () => ({
    meta: [{ title: "Create account · JeeVijay HRMS" }],
  }),
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const passwordStatus = passwordChecks(password);
  const confirmPasswordStatus = passwordChecks(confirmPassword);
  const passwordProgress = passwordStatus.filter((requirement) => requirement.met).length;
  const confirmProgress = confirmPasswordStatus.filter((requirement) => requirement.met).length;

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
    const result = await authService.signUp({ name, email, password });
    setSubmitting(false);

    if (result.error) {
      toast.error("Could not create account", { description: result.error.message });
      return;
    }

    toast.success("Account created", {
      description: result.needsEmailConfirmation
        ? "Check your work email to confirm your account before signing in."
        : "You can now sign in with your credentials.",
    });
    navigate({ to: "/sign-in" });
  }

  return (
    <AuthLayout
      title="Create account"
      subtitle="Join JeeVijay HRMS through your organisation invite. Your role is assigned by HR after verification."
      footer={
        <Link to="/sign-in" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Aarav Sharma"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="text"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
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
          <PasswordRequirements checks={passwordStatus} progress={passwordProgress} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
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
          <PasswordRequirements checks={confirmPasswordStatus} progress={confirmProgress} />
          {confirmPassword.length > 0 && password !== confirmPassword ? (
            <p className="text-xs text-destructive">Passwords do not match.</p>
          ) : null}
        </div>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

function PasswordRequirements({
  checks,
  progress,
}: {
  checks: ReturnType<typeof passwordChecks>;
  progress: number;
}) {
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
