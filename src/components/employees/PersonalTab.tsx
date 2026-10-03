import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SectionCard } from "@/components/common/SectionCard";
import { TabsContent } from "@/components/ui/tabs";
import { shortDate } from "@/lib/format";
import type { Employee } from "@/types";
import { Field } from "./Field";

function emergencyContactLabel(contact: Employee["emergencyContact"]) {
  const name = contact.name.trim();
  const relation = contact.relation.trim();
  if (!name) return "—";
  if (!relation) return name;
  return `${name} (${relation})`;
}

export function PersonalTab({ employee, footer }: { employee: Employee; footer?: ReactNode }) {
  const profileIncomplete = employee.dateOfBirth.trim() === "";

  return (
    <TabsContent value="personal" className="mt-4 space-y-4">
      <SectionCard title="Personal information" bodyClassName="grid gap-4 p-5 sm:grid-cols-2">
        {profileIncomplete ? (
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Profile incomplete.{" "}
            <Link to="/complete-profile" className="font-medium text-foreground underline">
              Finish your profile
            </Link>
          </p>
        ) : null}
        <Field label="Date of birth" value={shortDate(employee.dateOfBirth)} />
        <Field label="Marital status" value={employee.maritalStatus} />
        <Field label="Address" value={employee.address} />
        <Field label="Emergency contact" value={emergencyContactLabel(employee.emergencyContact)} />
        <Field label="Emergency phone" value={employee.emergencyContact.phone} />
      </SectionCard>
      {footer}
    </TabsContent>
  );
}
