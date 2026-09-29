import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfAuthenticated } from "@/lib/auth-guard";
import { passwordResetRequestService } from "@/services/passwordResetRequestService";
import { isValidEmail, sanitizeEmail } from "@/lib/email";

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: () => redirectIfAuthenticated(),
  head: () => ({
    meta: [{ title: "Forgot password · JeeVijay HRMS" }],
  }),
  component: ForgotPasswordPage,
});

const RESET_RECEIVED =
  "If an account exists, an administrator will review the request or a reset email will be sent.";

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const cleanEmail = sanitizeEmail(email);
    if (!isValidEmail(cleanEmail)) {
      toast.error("Enter a valid email address");
      return;
    }

    setSubmitting(true);
    try {
      await passwordResetRequestService.request(cleanEmail);
      setEmail(cleanEmail);
      setSent(true);
      toast.success("Request received", { description: RESET_RECEIVED });
    } catch (error) {
      toast.error("Could not submit your request", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Forgot password"
      subtitle="Enter your registered email to start a secure password reset."
      footer={
        <Link to="/sign-in" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <MailCheck className="size-6" />
          </span>
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{email}</span>,
            an administrator will review the request or a reset email will be sent.
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link to="/sign-in">Return to sign in</Link>
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="email">Registered email</Label>
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
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Send reset request
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
