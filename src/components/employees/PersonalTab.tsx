import type { ReactNode } from "react";
import { SectionCard } from "@/components/common/SectionCard";
import { TabsContent } from "@/components/ui/tabs";
import { shortDate } from "@/lib/format";
import type { Employee } from "@/types";
import { Field } from "./Field";

export function PersonalTab({ employee, footer }: { employee: Employee; footer?: ReactNode }) {
  return (
    <TabsContent value="personal" className="mt-4 space-y-4">
      <SectionCard title="Personal information" bodyClassName="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Date of birth" value={shortDate(employee.dateOfBirth)} />
        <Field label="Marital status" value={employee.maritalStatus} />
        <Field label="Address" value={employee.address} />
        <Field
          label="Emergency contact"
          value={`${employee.emergencyContact.name} (${employee.emergencyContact.relation})`}
        />
        <Field label="Emergency phone" value={employee.emergencyContact.phone} />
      </SectionCard>
      {footer}
    </TabsContent>
  );
}
