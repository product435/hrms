import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/SectionCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { ROLE_LABELS } from "@/hooks/useSession";
import { inr } from "@/lib/format";
import { ACCOUNT_NUMBER, IFSC_CODE, digitsOnly, formatIfscInput } from "@/lib/onboarding-schema";
import { onboardingService } from "@/services/onboardingService";
import type { Employee } from "@/types";
import { Field } from "./Field";

const emptyBankForm = {
  accountName: "",
  bankName: "",
  accountNumber: "",
  accountNumberConfirm: "",
  ifsc: "",
};

export function EmploymentTab({
  employee,
  isOwnProfile,
}: {
  employee: Employee;
  isOwnProfile: boolean;
}) {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [bank, setBank] = useState(emptyBankForm);
  const requests = useQuery({
    queryKey: ["profile-change-requests", "mine"],
    queryFn: () => onboardingService.changeRequests(),
    enabled: isOwnProfile,
  });
  const pendingBank = requests.data?.find(
    (request) => request.section === "bank" && request.status === "pending",
  );

  const submit = useMutation({
    mutationFn: () => {
      if (bank.accountNumber !== bank.accountNumberConfirm) {
        throw new Error("Account numbers do not match.");
      }
      if (!ACCOUNT_NUMBER.test(bank.accountNumber)) {
        throw new Error("Account number must be 9 to 18 digits.");
      }
      if (!IFSC_CODE.test(bank.ifsc.toUpperCase())) {
        throw new Error("IFSC must look like HDFC0001234.");
      }
      return onboardingService.requestProfileChange("bank", {
        accountName: bank.accountName,
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        accountNumberConfirm: bank.accountNumberConfirm,
        ifsc: bank.ifsc.toUpperCase(),
      });
    },
    onSuccess: async () => {
      toast.success("Bank update sent to HR");
      setFormOpen(false);
      setBank(emptyBankForm);
      await queryClient.invalidateQueries({ queryKey: ["profile-change-requests"] });
    },
    onError: (requestError) =>
      toast.error("Could not send the request", {
        description: requestError instanceof Error ? requestError.message : "Try again.",
      }),
  });

  return (
    <TabsContent value="employment" className="mt-4 space-y-4">
      <SectionCard
        title="Employment"
        description="Department, designation, CTC and role are managed by HR."
        bodyClassName="grid gap-4 p-5 sm:grid-cols-2"
      >
        <Field label="Department" value={employee.department} />
        <Field label="Designation" value={employee.designation} />
        <Field label="Employment type" value={employee.employmentType} />
        <Field label="Manager" value={employee.managerName ?? "—"} />
        <Field label="Annual CTC" value={inr(employee.ctcAnnual)} />
        <Field label="Access role" value={ROLE_LABELS[employee.role]} />
      </SectionCard>
      <SectionCard
        title="Bank details"
        bodyClassName="space-y-4 p-5"
        action={
          isOwnProfile && !pendingBank && !formOpen ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFormOpen(true)}
              disabled={requests.isLoading}
            >
              Request bank update
            </Button>
          ) : null
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account name" value={employee.bank.accountName} />
          <Field label="Bank" value={employee.bank.bankName} />
          <Field label="Account number" value={employee.bank.accountNumber} />
          <Field label="IFSC" value={employee.bank.ifsc} />
        </div>
        {isOwnProfile && pendingBank ? (
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
            <p className="text-sm text-muted-foreground">
              A bank update is waiting for HR approval.
            </p>
            <StatusBadge status="pending" />
          </div>
        ) : null}
        {isOwnProfile && !pendingBank && formOpen ? (
          <form
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate();
            }}
          >
            <div>
              <Label htmlFor="bank-account-name">Account name</Label>
              <Input
                id="bank-account-name"
                value={bank.accountName}
                onChange={(event) => setBank({ ...bank, accountName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="bank-name">Bank</Label>
              <Input
                id="bank-name"
                value={bank.bankName}
                onChange={(event) => setBank({ ...bank, bankName: event.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="bank-account-number">Account number</Label>
              <Input
                id="bank-account-number"
                inputMode="numeric"
                maxLength={18}
                autoComplete="off"
                value={bank.accountNumber}
                onChange={(event) =>
                  setBank({
                    ...bank,
                    accountNumber: digitsOnly(event.target.value).slice(0, 18),
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="bank-account-confirm">Confirm account number</Label>
              <Input
                id="bank-account-confirm"
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
              <Label htmlFor="bank-ifsc">IFSC</Label>
              <Input
                id="bank-ifsc"
                className="uppercase"
                maxLength={11}
                placeholder="HDFC0001234"
                value={bank.ifsc}
                onChange={(event) =>
                  setBank({ ...bank, ifsc: formatIfscInput(event.target.value) })
                }
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button type="submit" disabled={submit.isPending}>
                Send to HR
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={submit.isPending}
                onClick={() => {
                  setFormOpen(false);
                  setBank(emptyBankForm);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </SectionCard>
    </TabsContent>
  );
}
