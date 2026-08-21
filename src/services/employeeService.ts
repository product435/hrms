import { departments as fixtureDepartments, employees as fixtureEmployees } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Department, Employee, Role } from "@/types";
import { fromFixture, matchesSearch, requireOrganizationId, type QueryOptions } from "./api";

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
    employmentType: row.employment_type,
    shift: row.shifts?.name ?? "",
    gender: row.gender ?? "",
    dateOfBirth: row.date_of_birth ?? "",
    bloodGroup: "",
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
      })
      .select("id")
      .single();
    if (error) throw error;
    return data;
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
              e.department === options.department) &&
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
      .filter((employee) => !options.department || options.department === "all" || employee.department === options.department);
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
    return (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      head: row.manager ? `${row.manager.first_name ?? ""} ${row.manager.last_name ?? ""}`.trim() : "Unassigned",
      headcount: counts.get(row.id) ?? 0,
      openRoles: 0,
      designations: (row.designations ?? []).map((d: any) => d.name),
      costCenter: "",
    }));
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
    return [...new Set((data ?? []).map((row: any) => row.name))].sort();
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
