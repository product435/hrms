import { useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/useSession";
import { isStrongPassword, passwordChecks } from "@/lib/password";
import { authService } from "@/services/authService";

export function ChangePasswordForm() {
  const { signOut } = useSession();
  const navigate = useNavigate();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const passwordStatus = passwordChecks(password);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!currentPassword) {
      toast.error("Enter your current password");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (!isStrongPassword(password)) {
      toast.error("Password does not meet the requirements");
      return;
    }

    setSubmitting(true);
    const result = await authService.changePassword(currentPassword, password);
    if (result.error) {
      setSubmitting(false);
      toast.error("Could not change password", { description: result.error.message });
      return;
    }

    const signedOut = await signOut({ scope: "global" });
    setSubmitting(false);
    if (signedOut.error) {
      toast.error("Password changed, but other sessions are still signed in", {
        description: signedOut.error.message,
      });
      return;
    }

    toast.success("Password updated", {
      description: "You have been signed out of every device. Sign in with your new password.",
    });
    await navigate({ to: "/sign-in", replace: true });
    await router.invalidate();
  }

  return (
    <SectionCard
      title="Change password"
      description="Confirm your current password. A successful change signs you out of every device."
      bodyClassName="space-y-4 p-5"
    >
      <form className="max-w-md space-y-4" onSubmit={handleSubmit}>
        <PasswordField
          id="current-password"
          label="Current password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
          visible={showCurrent}
          onToggleVisible={() => setShowCurrent((visible) => !visible)}
        />
        <div className="space-y-2">
          <PasswordField
            id="new-password"
            label="New password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((visible) => !visible)}
          />
          <PasswordRequirements checks={passwordStatus} />
        </div>
        <div className="space-y-2">
          <PasswordField
            id="confirm-password"
            label="Confirm new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            visible={showConfirm}
            onToggleVisible={() => setShowConfirm((visible) => !visible)}
          />
          {confirmPassword.length > 0 && password !== confirmPassword ? (
            <p className="text-xs text-destructive">Passwords do not match.</p>
          ) : null}
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          Change password
        </Button>
      </form>
    </SectionCard>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
  visible,
  onToggleVisible,
}: {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={id === "current-password" ? undefined : 8}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pr-10"
        />
        <button
          type="button"
          onClick={onToggleVisible}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
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
