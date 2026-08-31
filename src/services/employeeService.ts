import { departments as fixtureDepartments, employees as fixtureEmployees } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Department, Employee, Role } from "@/types";
import { fromFixture, logAudit, matchesSearch, requireOrganizationId, type QueryOptions } from "./api";
import { displayName, normalizeKey } from "@/lib/normalize";

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
    role: (row.profiles?.role ?? "employee") as Role,
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
      ? [primaryAddress.address_line1, primaryAddress.city, primaryAddress.state, primaryAddress.postal_code]
          .filter(Boolean)
          .join(", ")
      : "",
    emergencyContact: primaryContact
      ? { name: primaryContact.name ?? "", relation: primaryContact.relationship ?? "", phone: primaryContact.phone ?? "" }
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
    const organizationId = await requireOrganizationId();
    const { data, error } = await supabase
      .from("employees")
      .insert({
        organization_id: organizationId,
        first_name: input.firstName.trim(),
        last_name: input.lastName.trim(),
        email: input.email.trim().toLowerCase(),
        employee_code: input.employeeCode.trim(),
        department_id: input.departmentId || null,
        designation_id: input.designationId || null,
        employment_type: input.employmentType,
        employment_status: "active",
        joining_date: input.joiningDate,
        manager_id: input.managerId || null,
        blood_group: input.bloodGroup?.trim() || null,
      })
      .select("id")
      .single();
    if (error) throw error;
    void logAudit("employee_create", "employees", data.id, null, { employee_code: input.employeeCode, email: input.email });
    return data;
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
      // Real exit/termination date -- only meaningful (and only ever sent
      // by the UI) when status is being set to "resigned". Superscedes the
      // old updated_at-based approximation the Dashboard used to fall back
      // to for the "Joiners vs exits" chart and attrition rate.
      exitDate?: string;
    },
  ) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("employees")
      .update({
        ...(input.firstName !== undefined ? { first_name: input.firstName.trim() } : {}),
        ...(input.lastName !== undefined ? { last_name: input.lastName.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone.trim() || null } : {}),
        ...(input.gender !== undefined ? { gender: input.gender || null } : {}),
        ...(input.dateOfBirth !== undefined ? { date_of_birth: input.dateOfBirth || null } : {}),
        ...(input.bloodGroup !== undefined ? { blood_group: input.bloodGroup.trim() || null } : {}),
        ...(input.maritalStatus !== undefined ? { marital_status: input.maritalStatus || null } : {}),
        ...(input.workLocation !== undefined ? { work_location: input.workLocation.trim() || null } : {}),
        ...(input.departmentId !== undefined ? { department_id: input.departmentId || null } : {}),
        ...(input.designationId !== undefined ? { designation_id: input.designationId || null } : {}),
        ...(input.employmentType !== undefined ? { employment_type: input.employmentType } : {}),
        ...(input.status !== undefined ? { employment_status: input.status } : {}),
        ...(input.status !== undefined ? { exit_date: input.status === "resigned" ? input.exitDate || null : null } : {}),
      })
      .eq("id", id);
    if (error) throw error;
    void logAudit("employee_update", "employees", id, null, input as Record<string, unknown>);
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
      query = query.or(`first_name.ilike.%${options.search}%,last_name.ilike.%${options.search}%,email.ilike.%${options.search}%,employee_code.ilike.%${options.search}%`);
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
      if (row.department_id) counts.set(row.department_id, (counts.get(row.department_id) ?? 0) + 1);
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
