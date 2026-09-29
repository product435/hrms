import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/button";
import { redirectIfAuthenticated } from "@/lib/auth-guard";

export const Route = createFileRoute("/sign-up")({
  beforeLoad: () => redirectIfAuthenticated(),
  head: () => ({
    meta: [{ title: "Sign in · JeeVijay HRMS" }],
  }),
  component: SignUpClosedPage,
});

function SignUpClosedPage() {
  return (
    <AuthLayout
      title="Accounts are created by an administrator"
      subtitle="Self-registration is closed. Sign in with the account your administrator already created."
      footer={
        <Link to="/sign-in" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <Button asChild className="w-full">
        <Link to="/sign-in">Go to sign in</Link>
      </Button>
    </AuthLayout>
  );
}
