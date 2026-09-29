import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { ErrorState, CardsSkeleton } from "@/components/common/States";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { MobileInput } from "@/components/common/MobileInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAuthForPath } from "@/lib/auth-guard";
import {
  ACCOUNT_NUMBER,
  IFSC_CODE,
  INDIAN_STATES,
  PIN_CODE,
  digitsOnly,
  formatIfscInput,
  isIndianMobile,
} from "@/lib/onboarding-schema";
import { onboardingService } from "@/services/onboardingService";
import { useSession } from "@/hooks/useSession";
import { shortDate } from "@/lib/format";

export const Route = createFileRoute("/profile-status")({
  beforeLoad: () => requireAuthForPath("/profile-status"),
  head: () => ({
    meta: [
      { title: "Profile status · JeeVijay HRMS" },
      {
        name: "description",
        content:
          "See whether HR has approved your profile, asked for changes, or declined the application.",
      },
    ],
  }),
  component: ProfileStatusPage,
});

const ACTIVE = new Set(["active", "probation", "notice", "on-leave"]);

function ProfileStatusPage() {
  const navigate = useNavigate();
  const { signOut } = useSession();
  const draft = useQuery({
    queryKey: ["onboarding-draft"],
    queryFn: () => onboardingService.draft(),
  });
  const requests = useQuery({
    queryKey: ["profile-change-requests", "mine"],
    queryFn: () => onboardingService.changeRequests(),
    enabled: Boolean(draft.data && ACTIVE.has(draft.data.employmentStatus)),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Onboarding"
        title="Profile status"
        description="HR reviews new profiles before the rest of the workspace opens."
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void signOut().then(() => navigate({ to: "/sign-in" }));
            }}
          >
            Sign out
          </Button>
        }
      />
      {draft.isLoading ? (
        <CardsSkeleton count={2} className="sm:grid-cols-1 xl:grid-cols-1" />
      ) : draft.isError ? (
        <ErrorState
          message={draft.error instanceof Error ? draft.error.message : undefined}
          onRetry={() => void draft.refetch()}
        />
      ) : draft.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Application"
            description="This is the decision on the profile you submitted."
          >
            <div className="space-y-3">
              <StatusBadge status={draft.data.employmentStatus || draft.data.submissionStatus} />
              <StatusCopy draft={draft.data} />
              {draft.data.employmentStatus === "rejected" ? null : (
                <Button asChild>
                  <Link to="/complete-profile">
                    {draft.data.submissionStatus === "changes_requested"
                      ? "Update requested sections"
                      : "Open profile form"}
                  </Link>
                </Button>
              )}
            </div>
          </SectionCard>
          {ACTIVE.has(draft.data.employmentStatus) ? (
            <ChangeRequestPanel
              onSubmitted={() => void requests.refetch()}
              requests={requests.data ?? []}
              loading={requests.isLoading}
              error={requests.error}
              onRetry={() => void requests.refetch()}
            />
          ) : null}
        </div>
      ) : null}
      <ChangePasswordForm />
    </AppLayout>
  );
}

function StatusCopy({
  draft,
}: {
  draft: {
    employmentStatus: string;
    submissionStatus: string;
    remarks: string;
    sectionFlags: Record<string, string>;
    submittedAt: string | null;
    employeeCode: string;
  };
}) {
  if (draft.employmentStatus === "rejected" || draft.submissionStatus === "rejected") {
    return (
      <div className="space-y-2 text-sm">
        <p>Your application was not approved. You cannot open the rest of JeeVijay HRMS.</p>
        <p className="rounded-md border bg-muted/40 px-3 py-2">
          {draft.remarks || "HR did not add a reason."}
        </p>
      </div>
    );
  }
  if (
    draft.employmentStatus === "profile_changes_requested" ||
    draft.submissionStatus === "changes_requested"
  ) {
    const sections = Object.entries(draft.sectionFlags);
    return (
      <div className="space-y-2 text-sm">
        <p>HR asked you to update part of the profile. Only those sections can be edited.</p>
        {draft.remarks ? (
          <p className="rounded-md border bg-muted/40 px-3 py-2">{draft.remarks}</p>
        ) : null}
        {sections.length ? (
          <ul className="list-disc space-y-1 pl-5">
            {sections.map(([section, remark]) => (
              <li key={section}>
                <span className="capitalize">{section}</span>
                {remark ? `: ${remark}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  if (ACTIVE.has(draft.employmentStatus)) {
    return (
      <p className="text-sm">
        Your profile is {draft.employmentStatus}
        {draft.employeeCode ? ` · employee code ${draft.employeeCode}` : ""}. Address, bank and
        mobile changes go through HR.
      </p>
    );
  }
  return (
    <p className="text-sm">
      {draft.submissionStatus === "submitted"
        ? `Submitted${draft.submittedAt ? ` on ${shortDate(draft.submittedAt)}` : ""}. HR is reviewing it.`
        : "Your profile is still a draft. Submit it when every step is complete."}
    </p>
  );
}

function ChangeRequestPanel({
  requests,
  loading,
  error,
  onRetry,
  onSubmitted,
}: {
  requests: Awaited<ReturnType<typeof onboardingService.changeRequests>>;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSubmitted: () => void;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<"phone" | "address" | "bank">("phone");
  const [phone, setPhone] = useState("");
  const [alternatePhone, setAlternatePhone] = useState("");
  const [address, setAddress] = useState({
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "India",
  });
  const [bank, setBank] = useState({
    accountName: "",
    accountNumber: "",
    accountNumberConfirm: "",
    ifsc: "",
    bankName: "",
    branch: "",
  });

  const submit = useMutation({
    mutationFn: () => {
      if (section === "phone") {
        if (!isIndianMobile(phone)) throw new Error("Enter a 10-digit mobile number.");
        if (alternatePhone && !isIndianMobile(alternatePhone)) {
          throw new Error("Enter a 10-digit mobile number.");
        }
        return onboardingService.requestProfileChange("phone", { phone, alternatePhone });
      }
      if (section === "address") {
        if (!PIN_CODE.test(address.postalCode)) throw new Error("PIN code must be 6 digits.");
        if (!address.addressLine1.trim() || !address.city.trim() || !address.state) {
          throw new Error("Address line, city and state are required.");
        }
        return onboardingService.requestProfileChange("address", { current: address });
      }
      if (bank.accountNumber !== bank.accountNumberConfirm)
        throw new Error("Account numbers do not match.");
      if (!ACCOUNT_NUMBER.test(bank.accountNumber))
        throw new Error("Account number must be 9 to 18 digits.");
      if (!IFSC_CODE.test(bank.ifsc.toUpperCase())) {
        throw new Error("IFSC must look like HDFC0001234.");
      }
      return onboardingService.requestProfileChange("bank", {
        ...bank,
        ifsc: bank.ifsc.toUpperCase(),
      });
    },
    onSuccess: async () => {
      toast.success("Change request sent to HR");
      await queryClient.invalidateQueries({ queryKey: ["profile-change-requests"] });
      onSubmitted();
    },
    onError: (requestError) =>
      toast.error("Could not send the request", {
        description: requestError instanceof Error ? requestError.message : "Try again.",
      }),
  });

  return (
    <SectionCard
      title="Request a change"
      description="Address, bank and mobile updates are applied only after HR approves them."
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading your requests…</p>
      ) : error ? (
        <ErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={onRetry}
        />
      ) : (
        <div className="space-y-4">
          <div>
            <Label htmlFor="change-section">Section</Label>
            <select
              id="change-section"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={section}
              onChange={(event) => setSection(event.target.value as "phone" | "address" | "bank")}
            >
              <option value="phone">Mobile number</option>
              <option value="address">Current address</option>
              <option value="bank">Bank account</option>
            </select>
          </div>
          {section === "phone" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>New mobile</Label>
                <MobileInput value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
              <div>
                <Label>Alternate mobile</Label>
                <MobileInput
                  value={alternatePhone}
                  onChange={(event) => setAlternatePhone(event.target.value)}
                />
              </div>
            </div>
          ) : null}
          {section === "address" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Address line 1</Label>
                <Input
                  value={address.addressLine1}
                  onChange={(event) => setAddress({ ...address, addressLine1: event.target.value })}
                />
              </div>
              <div>
                <Label>City</Label>
                <Input
                  value={address.city}
                  onChange={(event) => setAddress({ ...address, city: event.target.value })}
                />
              </div>
              <div>
                <Label>State</Label>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={address.state}
                  onChange={(event) => setAddress({ ...address, state: event.target.value })}
                >
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>PIN</Label>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  value={address.postalCode}
                  onChange={(event) =>
                    setAddress({
                      ...address,
                      postalCode: digitsOnly(event.target.value).slice(0, 6),
                    })
                  }
                />
              </div>
            </div>
          ) : null}
          {section === "bank" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Account holder</Label>
                <Input
                  value={bank.accountName}
                  onChange={(event) => setBank({ ...bank, accountName: event.target.value })}
                />
              </div>
              <div>
                <Label>Bank</Label>
                <Input
                  value={bank.bankName}
                  onChange={(event) => setBank({ ...bank, bankName: event.target.value })}
                />
              </div>
              <div>
                <Label>Account number</Label>
                <Input
                  inputMode="numeric"
                  maxLength={18}
                  autoComplete="off"
                  value={bank.accountNumber}
                  onChange={(event) =>
                    setBank({ ...bank, accountNumber: digitsOnly(event.target.value).slice(0, 18) })
                  }
                />
              </div>
              <div>
                <Label>Confirm account number</Label>
                <Input
                  inputMode="numeric"
                  maxLength={18}
                  autoComplete="off"
                  value={bank.accountNumberConfirm}
                  onChange={(event) =>
                    setBank({
                      ...bank,
                      accountNumberConfirm: digitsOnly(event.target.value).slice(0, 18),
                    })
                  }
                />
              </div>
              <div>
                <Label>IFSC</Label>
                <Input
                  className="uppercase"
                  maxLength={11}
                  placeholder="HDFC0001234"
                  value={bank.ifsc}
                  onChange={(event) =>
                    setBank({ ...bank, ifsc: formatIfscInput(event.target.value) })
                  }
                />
              </div>
              <div>
                <Label>Branch</Label>
                <Input
                  value={bank.branch}
                  onChange={(event) => setBank({ ...bank, branch: event.target.value })}
                />
              </div>
            </div>
          ) : null}
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            Send to HR
          </Button>
          <ul className="space-y-2 text-sm">
            {requests.map((request) => (
              <li
                key={request.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span className="capitalize">{request.section}</span>
                <StatusBadge status={request.status} />
              </li>
            ))}
          </ul>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No change requests yet.</p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
