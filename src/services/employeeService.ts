import { departments as fixtureDepartments, employees as fixtureEmployees } from "@/lib/mock-data";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Department, Employee, Role } from "@/types";
import { fromFixture, matchesSearch, type QueryOptions } from "./api";

function mapEmployee(row: any): Employee {
    const department = row.departments?.name ?? row.department ?? "";
  const designation = row.designations?.name ?? row.designation ?? "";
  return {
    id: row.id,
    code: row.employee_code,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone ?? "",
    avatarUrl: row.avatar_url ?? undefined,
    department,
    designation,
    role: (row.role ?? "employee") as Role,
    managerName: row.manager?.full_name ??
      (row.manager ? `${row.manager.first_name ?? ""} ${row.manager.last_name ?? ""}`.trim() : null),
    location: row.location ?? "",
    joinedOn: row.joined_on ?? "",
    status: row.status,
    employmentType: row.employment_type,
    shift: row.shifts?.name ?? "",
    gender: row.gender ?? "",
    dateOfBirth: row.date_of_birth ?? "",
    bloodGroup: row.blood_group ?? "",
    maritalStatus: row.marital_status ?? "",
    address: row.address ?? "",
    emergencyContact: row.emergency_contact ?? { name: "", relation: "", phone: "" },
    bank: row.bank_details ?? { accountName: "", accountNumber: "", ifsc: "", bankName: "" },
    ctcAnnual: Number(row.ctc_annual ?? 0),
    leaveBalance: row.leave_balance ?? { casual: 0, sick: 0, earned: 0, unpaid: 0 },
  };
}

export const employeeService = {
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
      .select("*, departments(name), designations(name), shifts(name)")
      .order("first_name");
    // The deployed employee table stores department_id; the related name is
    // used for display, so department-name filtering is applied after mapping.
    if (options.status && options.status !== "all") query = query.eq("status", options.status);
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
        "*, departments(name), designations(name), shifts(name)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapEmployee(data) : null;
  },
  async teamOf(managerName: string): Promise<Employee[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture(fixtureEmployees.filter((e) => e.managerName === managerName));
    const { data, error } = await supabase
      .from("employees")
      .select(
        "*, departments(name), designations(name), shifts(name)",
      )
      .eq("manager.full_name", managerName);
    if (error) throw error;
    return (data ?? []).map(mapEmployee);
  },
  async departments(): Promise<Department[]> {
    if (!isSupabaseConfigured || !supabase) return fromFixture(fixtureDepartments);
    const { data, error } = await supabase
      .from("departments")
      .select("*, designations(name)")
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
      head: row.head?.full_name ?? "Unassigned",
      headcount: counts.get(row.id) ?? 0,
      openRoles: 0,
      designations: (row.designations ?? []).map((d: any) => d.name),
      costCenter: row.cost_center ?? "",
    }));
  },
  async designations(): Promise<string[]> {
    if (!isSupabaseConfigured || !supabase)
      return fromFixture([...new Set(fixtureDepartments.flatMap((d) => d.designations))].sort());
    const { data, error } = await supabase.from("designations").select("name").order("name");
    if (error) throw error;
    return [...new Set((data ?? []).map((row: any) => row.name))].sort();
  },
};
