/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase joins are not in the generated row types. */
import { departments as fixtureDepartments, employees as fixtureEmployees } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  BLOOD_GROUPS,
  GENDERS,
  MARITAL_STATUSES,
  emailHasDomain,
  isIndianMobile,
} from "@/lib/onboarding-schema";
import { normalizeRole } from "@/lib/roles";
import type { Department, Employee } from "@/types";
import {
  fromFixture,
  logAudit,
  matchesSearch,
  requireOrganizationId,
  type QueryOptions,
} from "./api";
import { indiaDateKey } from "@/lib/format";
import { displayName, normalizeKey } from "@/lib/normalize";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Decide the exit_date column for an employment status change.
 * undefined means leave the stored date untouched.
 */
export function resolveEmploymentExitDate(input: {
  nextStatus: string;
  previousStatus: string | null;
  previousExitDate: string | null;
  exitDate?: string;
  today: string;
}): string | null | undefined {
  const next = input.nextStatus.trim();
  const previous = (input.previousStatus ?? "").trim();
  const provided = (input.exitDate ?? "").trim();
  if (provided && !ISO_DATE.test(provided)) {
    throw new Error("Enter an exit date as YYYY-MM-DD.");
  }
  const previousExit = input.previousExitDate?.trim() || null;

  if (next === "terminated" || next === "suspended") {
    const exitDate = provided || previousExit || input.today;
    if (next === "terminated" && !exitDate) {
      throw new Error("Terminated employees need an exit date.");
    }
    return exitDate;
  }
  if (next === "resigned") {
    return provided || null;
  }
  if (next === "active" && previous === "suspended") {
    return null;
  }
  return undefined;
}

const EMPLOYMENT_TYPES = new Set(["full-time", "part-time", "contract", "intern"]);

function listedOrEmpty(value: string | undefined, allowed: readonly string[], label: string) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!allowed.includes(trimmed)) throw new Error(`Select a ${label}.`);
  return trimmed;
}

function mobileOrEmpty(value: string | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isIndianMobile(trimmed)) throw new Error("Enter a 10-digit mobile number.");
  return trimmed;
}

function exactIlike(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function duplicateEmployeeMessage(error: { code?: string; message?: string }) {
  if (error.code !== "23505") return null;
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("email")) return "An employee with this work email already exists.";
  if (message.includes("employee_code")) return "That employee code is already in use.";
  return "An employee with those details already exists.";
}

function mapEmployee(row: any): Employee {
  const department = row.departments?.name ?? row.department ?? "";
  const designation = row.designations?.name ?? row.designation ?? "";
  const primaryAddress = row.employee_addresses?.[0];
  const primaryBank =
    row.employee_bank_accounts?.find((b: any) => b.is_primary) ?? row.employee_bank_accounts?.[0];
  const primaryContact = row.emergency_contacts?.[0];
  const salary = row.salary_structures?.[0];
  return {
    id: row.id,
    code: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone ?? "",
    avatarUrl: row.profiles?.avatar_url ?? undefined,
    department,
    designation,
    role: normalizeRole(row.profiles?.role) ?? "employee",
    managerName: row.manager
      ? `${row.manager.first_name ?? ""} ${row.manager.last_name ?? ""}`.trim()
      : null,
    location: row.work_location ?? "",
    joinedOn: row.joining_date ?? "",
    status: row.employment_status,
    exitDate: row.exit_date ?? "",
    employmentType: row.employment_type,
    shift: row.shifts?.name ?? "",
    gender: row.gender ?? "",
    dateOfBirth: row.date_of_birth ?? "",
    bloodGroup: row.blood_group ?? "",
    maritalStatus: row.marital_status ?? "",
    address: primaryAddress
      ? [
          primaryAddress.address_line1,
          primaryAddress.city,
          primaryAddress.state,
          primaryAddress.postal_code,
        ]
          .filter(Boolean)
          .join(", ")
      : "",
    emergencyContact: primaryContact
      ? {
          name: primaryContact.name ?? "",
          relation: primaryContact.relationship ?? "",
          phone: primaryContact.phone ?? "",
        }
      : { name: "", relation: "", phone: "" },
    bank: primaryBank
      ? {
          accountName: primaryBank.account_name ?? "",
          accountNumber: primaryBank.account_number ?? "",
          ifsc: primaryBank.ifsc ?? "",
          bankName: primaryBank.bank_name ?? "",
        }
      : { accountName: "", accountNumber: "", ifsc: "", bankName: "" },
    ctcAnnual: Number(salary?.annual_ctc ?? 0),
    // No leave-balance ledger table exists in the schema yet.
    leaveBalance: { casual: 0, sick: 0, earned: 0, unpaid: 0 },
  };
}

export const employeeService = {
  async create(input: {
    firstName: string;
    lastName: string;
    email: string;
    employeeCode: string;
    departmentId?: string;
    designationId?: string;
    employmentType: string;
    joiningDate: string;
    managerId?: string;
    bloodGroup?: string;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const email = input.email.trim().toLowerCase();
    const employeeCode = input.employeeCode.trim();
    const employmentType = input.employmentType.trim();
    if (!firstName || !lastName || !employeeCode || !input.joiningDate) {
      throw new Error(
        "First name, last name, work email, employee code, and joining date are required.",
      );
    }
    if (!emailHasDomain(email)) throw new Error("Enter a valid work email.");
    if (!input.departmentId) throw new Error("Department is required.");
    if (!EMPLOYMENT_TYPES.has(employmentType)) throw new Error("Employment type is required.");

    const duplicateEmail = await supabase
      .from("employees")
      .select("id")
      .ilike("email", exactIlike(email))
      .limit(1);
    if (duplicateEmail.error) throw duplicateEmail.error;
    if ((duplicateEmail.data ?? []).length > 0) {
      throw new Error("An employee with this work email already exists.");
    }

    const duplicateCode = await supabase
      .from("employees")
      .select("id")
      .eq("employee_code", employeeCode)
      .limit(1);
    if (duplicateCode.error) throw duplicateCode.error;
    if ((duplicateCode.data ?? []).length > 0) {
      throw new Error("That employee code is already in use.");
    }

    const bloodGroup = listedOrEmpty(input.bloodGroup ?? "", BLOOD_GROUPS, "blood group");

    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("employees")
      .insert({
        organization_id: organizationId,
        profile_id: null,
        first_name: firstName,
        last_name: lastName,
        email,
        employee_code: employeeCode,
        department_id: input.departmentId,
        designation_id: input.designationId || null,
        employment_type: employmentType,
        employment_status: "pending_approval",
        joining_date: input.joiningDate,
        manager_id: input.managerId || null,
        blood_group: bloodGroup ?? null,
      })
      .select("id")
      .single();
    if (error) throw duplicateEmployeeMessage(error) ?? error;
    if (!data) throw new Error("Employee was not created.");
    void logAudit("employee_create", "employees", data.id, null, {
      employee_code: employeeCode,
      email,
    });
    return { id: data.id, email };
  },
  async update(
    id: string,
    input: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      gender?: string;
      dateOfBirth?: string;
      bloodGroup?: string;
      maritalStatus?: string;
      workLocation?: string;
      departmentId?: string;
      designationId?: string;
      employmentType?: string;
      status?: string;
      // Exit date is stored for resigned, suspended, and terminated.
      // Suspended and terminated fill today (Asia/Kolkata) when it is empty.
      // Moving a suspended employee back to active clears a mistaken date.
      // Leaving resigned or terminated keeps the date unless this call is
      // still saving status "resigned" with an empty exit date.
      exitDate?: string;
    },
  ) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const nextStatus = input.status?.trim();
    let previousStatus: string | null = null;
    let previousExit: string | null = null;
    let exitDateDecision: string | null | undefined;
    if (nextStatus !== undefined) {
      const current = await supabase
        .from("employees")
        .select("employment_status, exit_date")
        .eq("id", id)
        .maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) throw new Error("Employee was not found.");
      previousStatus = current.data.employment_status;
      previousExit = current.data.exit_date;
      exitDateDecision = resolveEmploymentExitDate({
        nextStatus,
        previousStatus,
        previousExitDate: previousExit,
        today: indiaDateKey(),
        ...(input.exitDate !== undefined ? { exitDate: input.exitDate } : {}),
      });
    }
    const phone = mobileOrEmpty(input.phone);
    const gender = listedOrEmpty(input.gender, GENDERS, "gender");
    const bloodGroup = listedOrEmpty(input.bloodGroup, BLOOD_GROUPS, "blood group");
    const maritalStatus = listedOrEmpty(input.maritalStatus, MARITAL_STATUSES, "marital status");
    const { data, error } = await supabase
      .from("employees")
      .update({
        ...(input.firstName !== undefined ? { first_name: input.firstName.trim() } : {}),
        ...(input.lastName !== undefined ? { last_name: input.lastName.trim() } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(gender !== undefined ? { gender } : {}),
        ...(input.dateOfBirth !== undefined ? { date_of_birth: input.dateOfBirth || null } : {}),
        ...(bloodGroup !== undefined ? { blood_group: bloodGroup } : {}),
        ...(maritalStatus !== undefined ? { marital_status: maritalStatus } : {}),
        ...(input.workLocation !== undefined
          ? { work_location: input.workLocation.trim() || null }
          : {}),
        ...(input.departmentId !== undefined ? { department_id: input.departmentId || null } : {}),
        ...(input.designationId !== undefined
          ? { designation_id: input.designationId || null }
          : {}),
        ...(input.employmentType !== undefined ? { employment_type: input.employmentType } : {}),
        ...(nextStatus !== undefined ? { employment_status: nextStatus } : {}),
        ...(exitDateDecision !== undefined ? { exit_date: exitDateDecision } : {}),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("You do not have permission to update this employee.");
    void logAudit(
      "employee_update",
      "employees",
      id,
      nextStatus !== undefined
        ? { employment_status: previousStatus, exit_date: previousExit }
        : null,
      nextStatus !== undefined
        ? {
            ...input,
            status: nextStatus,
            employment_status: nextStatus,
            exit_date: exitDateDecision === undefined ? previousExit : exitDateDecision,
          }
        : (input as Record<string, unknown>),
    );
  },
  async list(options: QueryOptions = {}): Promise<Employee[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(
        fixtureEmployees.filter(
          (e) =>
            matchesSearch(
              [e.firstName, e.lastName, e.email, e.code, e.designation],
              options.search,
            ) &&
            (!options.department ||
              options.department === "all" ||
              normalizeKey(e.department) === normalizeKey(options.department)) &&
            (!options.status || options.status === "all" || e.status === options.status),
        ),
      );
    let query = supabase
      .from("employees")
      .select(
        "*, departments!employees_department_id_fkey(name), designations!employees_designation_id_fkey(name), shifts(name), manager:manager_id(first_name,last_name), profiles!employees_profile_fk(role, avatar_url)",
      )
      .order("first_name");
    // The deployed employee table stores department_id; the related name is
    // used for display, so department-name filtering is applied after mapping.
    if (options.status && options.status !== "all")
      query = query.eq("employment_status", options.status);
    if (options.search)
      query = query.or(
        `first_name.ilike.%${options.search}%,last_name.ilike.%${options.search}%,email.ilike.%${options.search}%,employee_code.ilike.%${options.search}%`,
      );
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? [])
      .map(mapEmployee)
      .filter(
        (employee) =>
          !options.department ||
          options.department === "all" ||
          normalizeKey(employee.department) === normalizeKey(options.department),
      );
  },
  async getById(id: string): Promise<Employee | null> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureEmployees.find((e) => e.id === id) ?? null);
    const { data, error } = await supabase
      .from("employees")
      .select(
        "*, departments!employees_department_id_fkey(name), designations!employees_designation_id_fkey(name), shifts(name), manager:manager_id(first_name,last_name), profiles!employees_profile_fk(role, avatar_url), employee_addresses(*), employee_bank_accounts(*), emergency_contacts(*), salary_structures(annual_ctc, effective_from)",
      )
      .eq("id", id)
      .order("effective_from", { foreignTable: "salary_structures", ascending: false })
      .maybeSingle();
    if (error) throw error;
    return data ? mapEmployee(data) : null;
  },
  async teamOf(managerId: string): Promise<Employee[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureEmployees.filter((e) => e.managerName));
    const { data, error } = await supabase
      .from("employees")
      .select(
        "*, departments!employees_department_id_fkey(name), designations!employees_designation_id_fkey(name), shifts(name), manager:manager_id(first_name,last_name), profiles!employees_profile_fk(role, avatar_url)",
      )
      .eq("manager_id", managerId);
    if (error) throw error;
    return (data ?? []).map(mapEmployee);
  },
  // Multiple department rows can share the same name (duplicate test data,
  // trailing-space or casing variants -- e.g. "QA", "QA ", "qa"). They
  // represent one logical department to the business, so they're merged
  // into a single entry here rather than left to render as separate
  // cards/dropdown options/chart segments with split headcounts.
  async departments(): Promise<Department[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureDepartments);
    const { data, error } = await supabase
      .from("departments")
      .select("*, designations(name), manager:manager_id(first_name,last_name)")
      .order("name");
    if (error) throw error;
    const employees = await supabase.from("employees").select("department_id");
    if (employees.error) throw employees.error;
    const counts = new Map<string, number>();
    (employees.data ?? []).forEach((row: any) => {
      if (row.department_id)
        counts.set(row.department_id, (counts.get(row.department_id) ?? 0) + 1);
    });
    const grouped = new Map<string, Department>();
    (data ?? []).forEach((row: any) => {
      const key = normalizeKey(row.name);
      if (!key) return;
      const rowHead = row.manager
        ? `${row.manager.first_name ?? ""} ${row.manager.last_name ?? ""}`.trim()
        : "";
      const rowDesignations: string[] = (row.designations ?? []).map((d: any) => d.name);
      const existing = grouped.get(key);
      if (existing) {
        existing.headcount += counts.get(row.id) ?? 0;
        if (!existing.head && rowHead) existing.head = rowHead;
        rowDesignations.forEach((name) => {
          if (!existing.designations.some((d) => normalizeKey(d) === normalizeKey(name))) {
            existing.designations.push(name);
          }
        });
      } else {
        grouped.set(key, {
          id: row.id,
          name: displayName(row.name),
          head: rowHead,
          headcount: counts.get(row.id) ?? 0,
          openRoles: 0,
          designations: [...rowDesignations],
          costCenter: "",
        });
      }
    });
    return [...grouped.values()]
      .map((dept) => ({ ...dept, head: dept.head || "Unassigned" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async createDepartment(input: { name: string; code?: string; description?: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("departments")
      .insert({
        organization_id: organizationId,
        name: input.name.trim(),
        code: input.code?.trim() || null,
        description: input.description?.trim() || null,
        is_active: true,
      })
      .select("id,name")
      .single();
    if (error) throw error;
    return data;
  },
  async designationOptions(): Promise<{ id: string; name: string }[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from("designations")
      .select("id,name,is_active")
      .order("name");
    if (error) throw error;
    return (data ?? [])
      .filter((row) => row.is_active !== false && row.id && row.name)
      .map((row) => ({ id: row.id, name: displayName(row.name ?? "") }));
  },
  async designations(): Promise<string[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture([...new Set(fixtureDepartments.flatMap((d) => d.designations))].sort());
    const { data, error } = await supabase.from("designations").select("name").order("name");
    if (error) throw error;
    const seen = new Map<string, string>();
    (data ?? []).forEach((row: any) => {
      const key = normalizeKey(row.name);
      if (key && !seen.has(key)) seen.set(key, displayName(row.name));
    });
    return [...seen.values()].sort();
  },
  async createDesignation(input: { name: string; departmentId?: string; code?: string }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("designations")
      .insert({
        organization_id: organizationId,
        name: input.name.trim(),
        department_id: input.departmentId || null,
        code: input.code?.trim() || null,
        is_active: true,
      })
      .select("id,name")
      .single();
    if (error) throw error;
    return data;
  },
};
