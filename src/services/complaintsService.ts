/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase joins are not in the generated row types. */
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Complaint, ComplaintPriority, ComplaintStatus } from "@/types";
import { requireEmployeeId } from "./api";

function mapComplaint(r: any): Complaint {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : "",
    subject: r.subject,
    category: r.category ?? "",
    description: r.description,
    priority: r.priority,
    status: r.status,
    assignedTo: r.assigned_to ?? null,
    assignedToName: r.assignee ? `${r.assignee.first_name} ${r.assignee.last_name}` : "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const complaintsService = {
  // Used both for an employee's own list and for HR/Admin viewing a single
  // employee's complaints from that employee's profile page -- RLS decides
  // what actually comes back in either case.
  async listForEmployee(employeeId: string): Promise<Complaint[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    const { data, error } = await supabase
      .from("employee_complaints")
      .select(
        "*, employees!employee_complaints_employee_id_fkey(first_name,last_name), assignee:assigned_to(first_name,last_name)",
      )
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapComplaint);
  },
  // Raising a complaint fans out a notification to every HR/Admin user in
  // the organization; that cross-user step can't happen from the employee's
  // own RLS-scoped session, so it's done server-side via a SECURITY DEFINER
  // RPC that inserts the complaint and the notifications atomically.
  async create(input: {
    subject: string;
    category: string;
    description: string;
    priority: ComplaintPriority;
  }) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    await requireEmployeeId();
    const { data, error } = await supabase.rpc("create_employee_complaint", {
      p_subject: input.subject.trim(),
      p_category: input.category.trim(),
      p_description: input.description.trim(),
      p_priority: input.priority,
    });
    if (error) throw error;
    return data;
  },
  async updateStatus(id: string, status: ComplaintStatus) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase.from("employee_complaints").update({ status }).eq("id", id);
    if (error) throw error;
  },
  async updateAssignee(id: string, assignedTo: string | null) {
    if (!isSupabaseConfigured || !supabase) throw new Error("Supabase is not configured.");
    const { error } = await supabase
      .from("employee_complaints")
      .update({ assigned_to: assignedTo })
      .eq("id", id);
    if (error) throw error;
  },
};
