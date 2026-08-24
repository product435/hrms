import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, MailCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfAuthenticated } from "@/lib/auth-guard";
import { authService } from "@/services/authService";
import { passwordResetRequestService } from "@/services/passwordResetRequestService";
import { isValidEmail, sanitizeEmail } from "@/lib/email";

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: () => redirectIfAuthenticated(),
  head: () => ({
    meta: [{ title: "Forgot password · TeamNest" }],
  }),
  component: ForgotPasswordPage,
});

// Password resets go through Admin approval for every role except the one
// Admin account itself -- an Admin has no one else to approve their own
// request, so that one case still uses the direct Supabase recovery email.
type SentState = "none" | "email" | "request";

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<SentState>("none");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const cleanEmail = sanitizeEmail(email);
    if (!isValidEmail(cleanEmail)) {
      toast.error("Enter a valid email address");
      return;
    }

    setSubmitting(true);
    try {
      const { isAdminAccount } = await passwordResetRequestService.request(cleanEmail);
      if (isAdminAccount) {
        const result = await authService.resetPasswordForEmail(cleanEmail);
        if (result.error) {
          toast.error("Could not send reset email", { description: result.error.message });
          return;
        }
        setEmail(cleanEmail);
        setSent("email");
        toast.success("Reset link sent", { description: "Check your inbox for further instructions." });
        return;
      }
      setEmail(cleanEmail);
      setSent("request");
      toast.success("Request sent to Admin", {
        description: "An administrator will review and approve your reset request.",
      });
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
      {sent === "email" ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <MailCheck className="size-6" />
          </span>
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{email}</span>, you
            will receive password reset instructions shortly.
          </p>
          <Button asChild variant="outline" className="mt-2">
            <Link to="/sign-in">Return to sign in</Link>
          </Button>
        </div>
      ) : sent === "request" ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="size-6" />
          </span>
          <p className="text-sm font-medium text-foreground">Request sent to Admin</p>
          <p className="text-sm text-muted-foreground">
            If <span className="font-medium text-foreground">{email}</span> is a registered account, an
            administrator has been notified and will approve or reject the request. You&apos;ll be able to
            set a new password once it&apos;s approved.
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
