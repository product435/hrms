import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileInput } from "@/components/common/MobileInput";
import { BLOOD_GROUPS, GENDERS, MARITAL_STATUSES } from "@/lib/onboarding-schema";
import { indiaDateKey } from "@/lib/format";
import type { Department } from "@/types";

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

export type EmployeeFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  joiningDate: string;
  dateOfBirth: string;
  employeeCode: string;
  gender: string;
  departmentId: string;
  designationId: string;
  employmentType: string;
  status: string;
  bloodGroup: string;
  maritalStatus: string;
  location: string;
  exitDate: string;
};

export const EMPTY_EMPLOYEE_FORM: EmployeeFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  joiningDate: "",
  dateOfBirth: "",
  employeeCode: "",
  gender: "",
  departmentId: "",
  designationId: "",
  employmentType: "full-time",
  status: "active",
  bloodGroup: "",
  maritalStatus: "",
  location: "",
  exitDate: "",
};

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "probation", label: "Probation" },
  { value: "notice", label: "Notice period" },
  { value: "on-leave", label: "On leave" },
  { value: "resigned", label: "Resigned" },
  { value: "suspended", label: "Suspended" },
  { value: "terminated", label: "Terminated" },
];

const NEEDS_EXIT_DATE = new Set(["resigned", "suspended", "terminated"]);

/**
 * The exact same field set, order and two-column layout for "Add employee"
 * and "Edit profile" (admin or self). `editableFields`, when given, locks
 * every field NOT in that list to read-only -- used for a plain employee,
 * whose self-update is reverted server-side for every field outside that
 * list (see employees_guard_self_assignment()), so the UI must match what
 * the database will actually accept.
 */
export function EmployeeFormFields({
  idPrefix,
  mode,
  values,
  onChange,
  errors,
  departments,
  designations,
  designationsError,
  editableFields,
}: {
  idPrefix: string;
  mode: "add" | "edit";
  values: EmployeeFormValues;
  onChange: (next: EmployeeFormValues) => void;
  errors: Record<string, string>;
  departments: Department[];
  designations: { id: string; name: string }[];
  designationsError: boolean;
  editableFields?: readonly (keyof EmployeeFormValues)[];
}) {
  const fieldId = (key: string) => `${idPrefix}-${key}`;
  const set = <K extends keyof EmployeeFormValues>(key: K, value: EmployeeFormValues[K]) =>
    onChange({ ...values, [key]: value });
  const locked = (key: keyof EmployeeFormValues) =>
    editableFields !== undefined && !editableFields.includes(key);
  const lockedNote = "Managed by HR/Admin.";

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={fieldId("firstName")}>First name *</Label>
        <Input
          id={fieldId("firstName")}
          value={values.firstName}
          disabled={locked("firstName")}
          readOnly={locked("firstName")}
          aria-invalid={Boolean(errors["firstName"])}
          className={errors["firstName"] ? "border-destructive" : undefined}
          onChange={(event) => set("firstName", event.target.value)}
        />
        {errors["firstName"] ? (
          <p className="text-xs text-destructive">{errors["firstName"]}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("lastName")}>Last name *</Label>
        <Input
          id={fieldId("lastName")}
          value={values.lastName}
          disabled={locked("lastName")}
          readOnly={locked("lastName")}
          aria-invalid={Boolean(errors["lastName"])}
          className={errors["lastName"] ? "border-destructive" : undefined}
          onChange={(event) => set("lastName", event.target.value)}
        />
        {errors["lastName"] ? (
          <p className="text-xs text-destructive">{errors["lastName"]}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("email")}>Work email *</Label>
        {mode === "edit" && locked("email") ? (
          <>
            <Input id={fieldId("email")} value={values.email} disabled readOnly />
            <p className="text-xs text-muted-foreground">
              Login is linked to this address, so it cannot be changed here.
            </p>
          </>
        ) : (
          <>
            <Input
              id={fieldId("email")}
              type="email"
              value={values.email}
              disabled={locked("email")}
              readOnly={locked("email")}
              aria-invalid={Boolean(errors["email"])}
              className={errors["email"] ? "border-destructive" : undefined}
              onChange={(event) => set("email", event.target.value)}
            />
            {errors["email"] ? <p className="text-xs text-destructive">{errors["email"]}</p> : null}
          </>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("phone")}>Phone</Label>
        <MobileInput
          id={fieldId("phone")}
          value={values.phone}
          disabled={locked("phone")}
          readOnly={locked("phone")}
          onChange={(event) => set("phone", event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("joiningDate")}>Joining date *</Label>
        <Input
          id={fieldId("joiningDate")}
          type="date"
          value={values.joiningDate}
          disabled={locked("joiningDate")}
          readOnly={locked("joiningDate")}
          aria-invalid={Boolean(errors["joiningDate"])}
          className={errors["joiningDate"] ? "border-destructive" : undefined}
          onChange={(event) => set("joiningDate", event.target.value)}
        />
        {errors["joiningDate"] ? (
          <p className="text-xs text-destructive">{errors["joiningDate"]}</p>
        ) : locked("joiningDate") ? (
          <p className="text-xs text-muted-foreground">{lockedNote}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("dateOfBirth")}>Date of birth</Label>
        <Input
          id={fieldId("dateOfBirth")}
          type="date"
          value={values.dateOfBirth}
          disabled={locked("dateOfBirth")}
          readOnly={locked("dateOfBirth")}
          onChange={(event) => set("dateOfBirth", event.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("employeeCode")}>Employee code *</Label>
        <Input
          id={fieldId("employeeCode")}
          value={values.employeeCode}
          disabled={locked("employeeCode")}
          readOnly={locked("employeeCode")}
          aria-invalid={Boolean(errors["employeeCode"])}
          className={errors["employeeCode"] ? "border-destructive" : undefined}
          onChange={(event) => set("employeeCode", event.target.value)}
        />
        {errors["employeeCode"] ? (
          <p className="text-xs text-destructive">{errors["employeeCode"]}</p>
        ) : locked("employeeCode") ? (
          <p className="text-xs text-muted-foreground">{lockedNote}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("gender")}>Gender</Label>
        <select
          id={fieldId("gender")}
          className={selectClass}
          value={values.gender}
          disabled={locked("gender")}
          onChange={(event) => set("gender", event.target.value)}
        >
          <option value="">Select</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("departmentId")}>Department *</Label>
        <select
          id={fieldId("departmentId")}
          className={`${selectClass} ${errors["departmentId"] ? "border-destructive" : ""}`}
          value={values.departmentId}
          disabled={locked("departmentId")}
          aria-invalid={Boolean(errors["departmentId"])}
          onChange={(event) => set("departmentId", event.target.value)}
        >
          <option value="">Select department</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
        {errors["departmentId"] ? (
          <p className="text-xs text-destructive">{errors["departmentId"]}</p>
        ) : locked("departmentId") ? (
          <p className="text-xs text-muted-foreground">{lockedNote}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("designationId")}>Designation *</Label>
        {designationsError ? (
          <p className="text-sm text-destructive">
            Could not load designations. Try again before saving.
          </p>
        ) : (
          <>
            <select
              id={fieldId("designationId")}
              className={`${selectClass} ${errors["designationId"] ? "border-destructive" : ""}`}
              value={values.designationId}
              disabled={locked("designationId")}
              aria-invalid={Boolean(errors["designationId"])}
              onChange={(event) => set("designationId", event.target.value)}
            >
              <option value="">Select designation</option>
              {designations.map((designation) => (
                <option key={designation.id} value={designation.id}>
                  {designation.name}
                </option>
              ))}
            </select>
            {errors["designationId"] ? (
              <p className="text-xs text-destructive">{errors["designationId"]}</p>
            ) : locked("designationId") ? (
              <p className="text-xs text-muted-foreground">{lockedNote}</p>
            ) : null}
          </>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("employmentType")}>Employment type</Label>
        <select
          id={fieldId("employmentType")}
          className={selectClass}
          value={values.employmentType}
          disabled={locked("employmentType")}
          onChange={(event) => set("employmentType", event.target.value)}
        >
          <option value="full-time">Full-time</option>
          <option value="part-time">Part-time</option>
          <option value="contract">Contract</option>
          <option value="intern">Intern</option>
        </select>
        {locked("employmentType") ? (
          <p className="text-xs text-muted-foreground">{lockedNote}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("status")}>Status</Label>
        <select
          id={fieldId("status")}
          className={selectClass}
          value={values.status}
          disabled={mode === "add" || locked("status")}
          onChange={(event) => {
            const status = event.target.value;
            const next = { ...values, status };
            if (NEEDS_EXIT_DATE.has(status) && !values.exitDate) next.exitDate = indiaDateKey();
            onChange(next);
          }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {mode === "add" ? (
          <p className="text-xs text-muted-foreground">New employees start active.</p>
        ) : locked("status") ? (
          <p className="text-xs text-muted-foreground">{lockedNote}</p>
        ) : null}
        {NEEDS_EXIT_DATE.has(values.status) ? (
          <div className="space-y-1 pt-1">
            <Label htmlFor={fieldId("exitDate")}>Exit date</Label>
            <Input
              id={fieldId("exitDate")}
              type="date"
              required={values.status === "terminated"}
              value={values.exitDate}
              disabled={locked("status")}
              readOnly={locked("status")}
              onChange={(event) => set("exitDate", event.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("bloodGroup")}>Blood group</Label>
        <select
          id={fieldId("bloodGroup")}
          className={selectClass}
          value={values.bloodGroup}
          disabled={locked("bloodGroup")}
          onChange={(event) => set("bloodGroup", event.target.value)}
        >
          <option value="">Select</option>
          {BLOOD_GROUPS.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("maritalStatus")}>Marital status</Label>
        <select
          id={fieldId("maritalStatus")}
          className={selectClass}
          value={values.maritalStatus}
          disabled={locked("maritalStatus")}
          onChange={(event) => set("maritalStatus", event.target.value)}
        >
          <option value="">Select</option>
          {MARITAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor={fieldId("location")}>Location</Label>
        <Input
          id={fieldId("location")}
          value={values.location}
          disabled={locked("location")}
          readOnly={locked("location")}
          onChange={(event) => set("location", event.target.value)}
        />
      </div>
    </div>
  );
}
