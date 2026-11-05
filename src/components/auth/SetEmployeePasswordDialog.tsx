import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isStrongPassword, passwordChecks } from "@/lib/password";
import { passwordResetRequestService } from "@/services/passwordResetRequestService";

export function SetEmployeePasswordDialog({
  employeeId,
  employeeName,
  open,
  onOpenChange,
}: {
  employeeId: string | null;
  employeeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const checks = passwordChecks(password);

  function resetFields() {
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirm(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetFields();
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeId) return;
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (!isStrongPassword(password) || password.length > 72) {
      toast.error("Password does not meet the requirements");
      return;
    }

    setSubmitting(true);
    try {
      await passwordResetRequestService.setEmployeePassword(employeeId, password);
      void queryClient.invalidateQueries({ queryKey: ["password-reset-requests"] });
      toast.success("Password updated", {
        description: `${employeeName} has been signed out. Share the new password with them directly.`,
      });
      handleOpenChange(false);
    } catch (error) {
      toast.error("Could not change password", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set password</DialogTitle>
          <DialogDescription>
            Choose a new sign-in password for {employeeName}. This signs them out of every device.
            The password is not emailed.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <PasswordField
            id="admin-new-password"
            label="New password"
            value={password}
            onChange={setPassword}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((visible) => !visible)}
          />
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]" aria-live="polite">
            {checks.map((requirement) => (
              <span
                key={requirement.key}
                className={requirement.met ? "text-success" : "text-muted-foreground"}
              >
                {requirement.met ? "✓" : "✗"} {requirement.label}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            <PasswordField
              id="admin-confirm-password"
              label="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              visible={showConfirm}
              onToggleVisible={() => setShowConfirm((visible) => !visible)}
            />
            {confirmPassword.length > 0 && password !== confirmPassword ? (
              <p className="text-xs text-destructive">Passwords do not match.</p>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !employeeId}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              Set password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  visible,
  onToggleVisible,
}: {
  id: string;
  label: string;
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
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
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
