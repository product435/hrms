import { SectionCard } from "@/components/common/SectionCard";
import { TabsContent } from "@/components/ui/tabs";
import { ROLE_LABELS } from "@/hooks/useSession";
import { inr } from "@/lib/format";
import type { Employee } from "@/types";
import { Field } from "./Field";

export function EmploymentTab({ employee }: { employee: Employee }) {
  return (
    <TabsContent value="employment" className="mt-4 space-y-4">
      <SectionCard title="Employment" bodyClassName="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Department" value={employee.department} />
        <Field label="Designation" value={employee.designation} />
        <Field label="Employment type" value={employee.employmentType} />
        <Field label="Manager" value={employee.managerName ?? "—"} />
        <Field label="Annual CTC" value={inr(employee.ctcAnnual)} />
        <Field label="Access role" value={ROLE_LABELS[employee.role]} />
      </SectionCard>
      <SectionCard title="Bank details" bodyClassName="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Account name" value={employee.bank.accountName} />
        <Field label="Bank" value={employee.bank.bankName} />
        <Field label="Account number" value={employee.bank.accountNumber} />
        <Field label="IFSC" value={employee.bank.ifsc} />
      </SectionCard>
    </TabsContent>
  );
}
