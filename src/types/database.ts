export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          content: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string | null
          priority: string | null
          published_at: string | null
          published_by: string | null
          title: string | null
        }
        Insert: {
          content?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          priority?: string | null
          published_at?: string | null
          published_by?: string | null
          title?: string | null
        }
        Update: {
          content?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string | null
          priority?: string | null
          published_at?: string | null
          published_by?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_published_by_fk"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_assignments: {
        Row: {
          asset_id: string | null
          assigned_at: string | null
          assigned_by: string | null
          condition_on_assignment: string | null
          condition_on_return: string | null
          employee_id: string | null
          id: string
          remarks: string | null
          returned_at: string | null
          returned_by: string | null
        }
        Insert: {
          asset_id?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          condition_on_assignment?: string | null
          condition_on_return?: string | null
          employee_id?: string | null
          id?: string
          remarks?: string | null
          returned_at?: string | null
          returned_by?: string | null
        }
        Update: {
          asset_id?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          condition_on_assignment?: string | null
          condition_on_return?: string | null
          employee_id?: string | null
          id?: string
          remarks?: string | null
          returned_at?: string | null
          returned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_assigned_by_fk"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_assignments_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_returned_by_fk"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_repairs: {
        Row: {
          asset_id: string | null
          id: string
          issue: string | null
          remarks: string | null
          repair_cost: number | null
          repair_vendor: string | null
          returned_at: string | null
          sent_at: string | null
          status: string | null
        }
        Insert: {
          asset_id?: string | null
          id?: string
          issue?: string | null
          remarks?: string | null
          repair_cost?: number | null
          repair_vendor?: string | null
          returned_at?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Update: {
          asset_id?: string | null
          id?: string
          issue?: string | null
          remarks?: string | null
          repair_cost?: number | null
          repair_vendor?: string | null
          returned_at?: string | null
          sent_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_repairs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          asset_code: string | null
          category: string | null
          condition: string | null
          id: string
          location: string | null
          name: string | null
          organization_id: string | null
          purchase_cost: number | null
          purchase_date: string | null
          serial_number: string | null
          status: string | null
          warranty_until: string | null
        }
        Insert: {
          asset_code?: string | null
          category?: string | null
          condition?: string | null
          id?: string
          location?: string | null
          name?: string | null
          organization_id?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: string | null
          warranty_until?: string | null
        }
        Update: {
          asset_code?: string | null
          category?: string | null
          condition?: string | null
          id?: string
          location?: string | null
          name?: string | null
          organization_id?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: string | null
          warranty_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_corrections: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attendance_id: string | null
          employee_id: string | null
          id: string
          reason: string | null
          requested_check_in: string | null
          requested_check_out: string | null
          status: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attendance_id?: string | null
          employee_id?: string | null
          id?: string
          reason?: string | null
          requested_check_in?: string | null
          requested_check_out?: string | null
          status?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attendance_id?: string | null
          employee_id?: string | null
          id?: string
          reason?: string | null
          requested_check_in?: string | null
          requested_check_out?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_corrections_approved_by_fk"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          attendance_date: string | null
          check_in: string | null
          check_out: string | null
          employee_id: string | null
          id: string
          overtime_hours: number | null
          remarks: string | null
          shift_id: string | null
          source: string | null
          status: string | null
          work_mode: string | null
          worked_hours: number | null
        }
        Insert: {
          attendance_date?: string | null
          check_in?: string | null
          check_out?: string | null
          employee_id?: string | null
          id?: string
          overtime_hours?: number | null
          remarks?: string | null
          shift_id?: string | null
          source?: string | null
          status?: string | null
          work_mode?: string | null
          worked_hours?: number | null
        }
        Update: {
          attendance_date?: string | null
          check_in?: string | null
          check_out?: string | null
          employee_id?: string | null
          id?: string
          overtime_hours?: number | null
          remarks?: string | null
          shift_id?: string | null
          source?: string | null
          status?: string | null
          work_mode?: string | null
          worked_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          new_data: Json | null
          old_data: Json | null
          organization_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          current_company: string | null
          current_salary: number | null
          email: string | null
          expected_salary: number | null
          experience_years: number | null
          id: string
          name: string | null
          phone: string | null
          resume_url: string | null
          source: string | null
        }
        Insert: {
          current_company?: string | null
          current_salary?: number | null
          email?: string | null
          expected_salary?: number | null
          experience_years?: number | null
          id?: string
          name?: string | null
          phone?: string | null
          resume_url?: string | null
          source?: string | null
        }
        Update: {
          current_company?: string | null
          current_salary?: number | null
          email?: string | null
          expected_salary?: number | null
          experience_years?: number | null
          id?: string
          name?: string | null
          phone?: string | null
          resume_url?: string | null
          source?: string | null
        }
        Relationships: []
      }
      departments: {
        Row: {
          code: string | null
          description: string | null
          id: string
          is_active: boolean | null
          manager_id: string | null
          name: string | null
          organization_id: string | null
          parent_department_id: string | null
        }
        Insert: {
          code?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          manager_id?: string | null
          name?: string | null
          organization_id?: string | null
          parent_department_id?: string | null
        }
        Update: {
          code?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          manager_id?: string | null
          name?: string | null
          organization_id?: string | null
          parent_department_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_manager_fk"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_parent_fk"
            columns: ["parent_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      designations: {
        Row: {
          code: string | null
          department_id: string | null
          description: string | null
          id: string
          is_active: boolean | null
          level: string | null
          name: string | null
          organization_id: string | null
        }
        Insert: {
          code?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          level?: string | null
          name?: string | null
          organization_id?: string | null
        }
        Update: {
          code?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          level?: string | null
          name?: string | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "designations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: string | null
          employee_id: string | null
          expiry_date: string | null
          file_size: number | null
          file_type: string | null
          file_url: string | null
          id: string
          title: string | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          employee_id?: string | null
          expiry_date?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          title?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          employee_id?: string | null
          expiry_date?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          title?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fk"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_contacts: {
        Row: {
          address: string | null
          email: string | null
          employee_id: string | null
          id: string
          name: string | null
          phone: string | null
          relationship: string | null
        }
        Insert: {
          address?: string | null
          email?: string | null
          employee_id?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          relationship?: string | null
        }
        Update: {
          address?: string | null
          email?: string | null
          employee_id?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          relationship?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emergency_contacts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_addresses: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          address_type: string | null
          city: string | null
          country: string | null
          employee_id: string | null
          id: string
          postal_code: string | null
          state: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          address_type?: string | null
          city?: string | null
          country?: string | null
          employee_id?: string | null
          id?: string
          postal_code?: string | null
          state?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          address_type?: string | null
          city?: string | null
          country?: string | null
          employee_id?: string | null
          id?: string
          postal_code?: string | null
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_addresses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_bank_accounts: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string | null
          branch: string | null
          employee_id: string | null
          id: string
          ifsc: string | null
          is_primary: boolean | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          branch?: string | null
          employee_id?: string | null
          id?: string
          ifsc?: string | null
          is_primary?: boolean | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          branch?: string | null
          employee_id?: string | null
          id?: string
          ifsc?: string | null
          is_primary?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_bank_accounts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_complaints: {
        Row: {
          assigned_to: string | null
          category: string | null
          created_at: string
          description: string
          employee_id: string
          id: string
          priority: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          created_at?: string
          description: string
          employee_id: string
          id?: string
          priority?: string
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          created_at?: string
          description?: string
          employee_id?: string
          id?: string
          priority?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_complaints_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_complaints_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_shifts: {
        Row: {
          effective_from: string | null
          effective_to: string | null
          employee_id: string | null
          id: string
          shift_id: string | null
        }
        Insert: {
          effective_from?: string | null
          effective_to?: string | null
          employee_id?: string | null
          id?: string
          shift_id?: string | null
        }
        Update: {
          effective_from?: string | null
          effective_to?: string | null
          employee_id?: string | null
          id?: string
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_shifts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          blood_group: string | null
          created_at: string | null
          date_of_birth: string | null
          department_id: string | null
          designation_id: string | null
          email: string | null
          employee_code: string | null
          employment_status: string | null
          employment_type: string | null
          first_name: string | null
          gender: string | null
          id: string
          joining_date: string | null
          last_name: string | null
          manager_id: string | null
          marital_status: string | null
          organization_id: string | null
          phone: string | null
          profile_id: string | null
          shift_id: string | null
          updated_at: string | null
          work_location: string | null
        }
        Insert: {
          blood_group?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          department_id?: string | null
          designation_id?: string | null
          email?: string | null
          employee_code?: string | null
          employment_status?: string | null
          employment_type?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          joining_date?: string | null
          last_name?: string | null
          manager_id?: string | null
          marital_status?: string | null
          organization_id?: string | null
          phone?: string | null
          profile_id?: string | null
          shift_id?: string | null
          updated_at?: string | null
          work_location?: string | null
        }
        Update: {
          blood_group?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          department_id?: string | null
          designation_id?: string | null
          email?: string | null
          employee_code?: string | null
          employment_status?: string | null
          employment_type?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          joining_date?: string | null
          last_name?: string | null
          manager_id?: string | null
          marital_status?: string | null
          organization_id?: string | null
          phone?: string | null
          profile_id?: string | null
          shift_id?: string | null
          updated_at?: string | null
          work_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_manager_fk"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_fk"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_claims: {
        Row: {
          amount: number | null
          approved_at: string | null
          approved_by: string | null
          category: string | null
          description: string | null
          employee_id: string | null
          expense_date: string | null
          id: string
          receipt_url: string | null
          rejection_reason: string | null
          status: string | null
        }
        Insert: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          category?: string | null
          description?: string | null
          employee_id?: string | null
          expense_date?: string | null
          id?: string
          receipt_url?: string | null
          rejection_reason?: string | null
          status?: string | null
        }
        Update: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          category?: string | null
          description?: string | null
          employee_id?: string | null
          expense_date?: string | null
          id?: string
          receipt_url?: string | null
          rejection_reason?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_approved_by_fk"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_claims_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          category: string | null
          description: string | null
          due_date: string | null
          employee_id: string | null
          id: string
          progress: number | null
          start_date: string | null
          status: string | null
          target: string | null
          title: string | null
          weight: number | null
        }
        Insert: {
          category?: string | null
          description?: string | null
          due_date?: string | null
          employee_id?: string | null
          id?: string
          progress?: number | null
          start_date?: string | null
          status?: string | null
          target?: string | null
          title?: string | null
          weight?: number | null
        }
        Update: {
          category?: string | null
          description?: string | null
          due_date?: string | null
          employee_id?: string | null
          id?: string
          progress?: number | null
          start_date?: string | null
          status?: string | null
          target?: string | null
          title?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      helpdesk_tickets: {
        Row: {
          assigned_to: string | null
          category: string | null
          created_at: string | null
          description: string | null
          employee_id: string | null
          id: string
          priority: string | null
          resolved_at: string | null
          status: string | null
          subject: string | null
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          employee_id?: string | null
          id?: string
          priority?: string | null
          resolved_at?: string | null
          status?: string | null
          subject?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          employee_id?: string | null
          id?: string
          priority?: string | null
          resolved_at?: string | null
          status?: string | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "helpdesk_assigned_to_fk"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "helpdesk_tickets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          application_id: string | null
          feedback: string | null
          id: string
          interview_type: string | null
          interviewer_id: string | null
          rating: number | null
          scheduled_at: string | null
          status: string | null
        }
        Insert: {
          application_id?: string | null
          feedback?: string | null
          id?: string
          interview_type?: string | null
          interviewer_id?: string | null
          rating?: number | null
          scheduled_at?: string | null
          status?: string | null
        }
        Update: {
          application_id?: string | null
          feedback?: string | null
          id?: string
          interview_type?: string | null
          interviewer_id?: string | null
          rating?: number | null
          scheduled_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_interviewer_fk"
            columns: ["interviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      job_applications: {
        Row: {
          applied_at: string | null
          candidate_id: string | null
          id: string
          job_id: string | null
          recruiter_id: string | null
          stage: string | null
          status: string | null
        }
        Insert: {
          applied_at?: string | null
          candidate_id?: string | null
          id?: string
          job_id?: string | null
          recruiter_id?: string | null
          stage?: string | null
          status?: string | null
        }
        Update: {
          applied_at?: string | null
          candidate_id?: string | null
          id?: string
          job_id?: string | null
          recruiter_id?: string | null
          stage?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_applications_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_openings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_recruiter_fk"
            columns: ["recruiter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_openings: {
        Row: {
          closed_at: string | null
          department_id: string | null
          description: string | null
          designation_id: string | null
          employment_type: string | null
          id: string
          location: string | null
          opened_at: string | null
          openings: number | null
          organization_id: string | null
          requirements: string | null
          status: string | null
          title: string | null
        }
        Insert: {
          closed_at?: string | null
          department_id?: string | null
          description?: string | null
          designation_id?: string | null
          employment_type?: string | null
          id?: string
          location?: string | null
          opened_at?: string | null
          openings?: number | null
          organization_id?: string | null
          requirements?: string | null
          status?: string | null
          title?: string | null
        }
        Update: {
          closed_at?: string | null
          department_id?: string | null
          description?: string | null
          designation_id?: string | null
          employment_type?: string | null
          id?: string
          location?: string | null
          opened_at?: string | null
          openings?: number | null
          organization_id?: string | null
          requirements?: string | null
          status?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_openings_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_openings_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_openings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          current_approver: string | null
          employee_id: string | null
          end_date: string | null
          id: string
          leave_type_id: string | null
          reason: string | null
          rejection_reason: string | null
          start_date: string | null
          status: string | null
          total_days: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          current_approver?: string | null
          employee_id?: string | null
          end_date?: string | null
          id?: string
          leave_type_id?: string | null
          reason?: string | null
          rejection_reason?: string | null
          start_date?: string | null
          status?: string | null
          total_days?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          current_approver?: string | null
          employee_id?: string | null
          end_date?: string | null
          id?: string
          leave_type_id?: string | null
          reason?: string | null
          rejection_reason?: string | null
          start_date?: string | null
          status?: string | null
          total_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_approved_by_fk"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_current_approver_fk"
            columns: ["current_approver"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          annual_limit: number | null
          carry_forward: boolean | null
          code: string | null
          id: string
          is_active: boolean | null
          name: string | null
          organization_id: string | null
          requires_approval: boolean | null
        }
        Insert: {
          annual_limit?: number | null
          carry_forward?: boolean | null
          code?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          organization_id?: string | null
          requires_approval?: boolean | null
        }
        Update: {
          annual_limit?: number | null
          carry_forward?: boolean | null
          code?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          organization_id?: string | null
          requires_approval?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_types_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string | null
          reference_id: string | null
          reference_type: string | null
          title: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          reference_id?: string | null
          reference_type?: string | null
          title?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          reference_id?: string | null
          reference_type?: string | null
          title?: string | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          application_id: string | null
          id: string
          joining_date: string | null
          offer_date: string | null
          offer_document_url: string | null
          offered_salary: number | null
          status: string | null
        }
        Insert: {
          application_id?: string | null
          id?: string
          joining_date?: string | null
          offer_date?: string | null
          offer_document_url?: string | null
          offered_salary?: number | null
          status?: string | null
        }
        Update: {
          application_id?: string | null
          id?: string
          joining_date?: string | null
          offer_date?: string | null
          offer_document_url?: string | null
          offered_salary?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "job_applications"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_records: {
        Row: {
          assigned_hr: string | null
          employee_id: string | null
          id: string
          joining_date: string | null
          status: string | null
        }
        Insert: {
          assigned_hr?: string | null
          employee_id?: string | null
          id?: string
          joining_date?: string | null
          status?: string | null
        }
        Update: {
          assigned_hr?: string | null
          employee_id?: string | null
          id?: string
          joining_date?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_assigned_hr_fk"
            columns: ["assigned_hr"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          description: string | null
          due_date: string | null
          id: string
          onboarding_id: string | null
          status: string | null
          title: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          onboarding_id?: string | null
          status?: string | null
          title?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          onboarding_id?: string | null
          status?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_task_assigned_to_fk"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_onboarding_id_fkey"
            columns: ["onboarding_id"]
            isOneToOne: false
            referencedRelation: "onboarding_records"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          currency: string | null
          leave_policy: Json | null
          organization_id: string
          payroll_settings: Json | null
          timezone: string | null
          work_end_time: string | null
          work_start_time: string | null
          working_days: string[] | null
        }
        Insert: {
          currency?: string | null
          leave_policy?: Json | null
          organization_id: string
          payroll_settings?: Json | null
          timezone?: string | null
          work_end_time?: string | null
          work_start_time?: string | null
          working_days?: string[] | null
        }
        Update: {
          currency?: string | null
          leave_policy?: Json | null
          organization_id?: string
          payroll_settings?: Json | null
          timezone?: string | null
          work_end_time?: string | null
          work_start_time?: string | null
          working_days?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          created_at: string | null
          currency: string | null
          email: string | null
          id: string
          legal_name: string | null
          logo_url: string | null
          name: string | null
          phone: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          name?: string | null
          phone?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          currency?: string | null
          email?: string | null
          id?: string
          legal_name?: string | null
          logo_url?: string | null
          name?: string | null
          phone?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payroll_records: {
        Row: {
          allowances: number | null
          basic: number | null
          bonus: number | null
          employee_id: string | null
          gross_salary: number | null
          hra: number | null
          id: string
          net_salary: number | null
          paid_at: string | null
          payment_status: string | null
          payroll_run_id: string | null
          pf: number | null
          tax: number | null
          total_deductions: number | null
        }
        Insert: {
          allowances?: number | null
          basic?: number | null
          bonus?: number | null
          employee_id?: string | null
          gross_salary?: number | null
          hra?: number | null
          id?: string
          net_salary?: number | null
          paid_at?: string | null
          payment_status?: string | null
          payroll_run_id?: string | null
          pf?: number | null
          tax?: number | null
          total_deductions?: number | null
        }
        Update: {
          allowances?: number | null
          basic?: number | null
          bonus?: number | null
          employee_id?: string | null
          gross_salary?: number | null
          hra?: number | null
          id?: string
          net_salary?: number | null
          paid_at?: string | null
          payment_status?: string | null
          payroll_run_id?: string | null
          pf?: number | null
          tax?: number | null
          total_deductions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_records_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          id: string
          month: number | null
          organization_id: string | null
          processed_at: string | null
          processed_by: string | null
          status: string | null
          year: number | null
        }
        Insert: {
          id?: string
          month?: number | null
          organization_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          status?: string | null
          year?: number | null
        }
        Update: {
          id?: string
          month?: number | null
          organization_id?: string | null
          processed_at?: string | null
          processed_by?: string | null
          status?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_processed_by_fk"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          generated_at: string | null
          id: string
          payroll_record_id: string | null
          payslip_url: string | null
        }
        Insert: {
          generated_at?: string | null
          id?: string
          payroll_record_id?: string | null
          payslip_url?: string | null
        }
        Update: {
          generated_at?: string | null
          id?: string
          payroll_record_id?: string | null
          payslip_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payslips_payroll_record_id_fkey"
            columns: ["payroll_record_id"]
            isOneToOne: false
            referencedRelation: "payroll_records"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_reviews: {
        Row: {
          employee_id: string | null
          feedback: string | null
          final_rating: number | null
          id: string
          manager_rating: number | null
          review_cycle: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          self_rating: number | null
          status: string | null
        }
        Insert: {
          employee_id?: string | null
          feedback?: string | null
          final_rating?: number | null
          id?: string
          manager_rating?: number | null
          review_cycle?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          self_rating?: number | null
          status?: string | null
        }
        Update: {
          employee_id?: string | null
          feedback?: string | null
          final_rating?: number | null
          id?: string
          manager_rating?: number | null
          review_cycle?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          self_rating?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_reviewer_fk"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string | null
          id: string
          key: string
          name: string | null
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          name?: string | null
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          name?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          employee_id: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          role: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          role?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_employee_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          description: string | null
          id: string
          name: string
        }
        Insert: {
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      salary_structures: {
        Row: {
          allowances: number | null
          annual_ctc: number | null
          basic: number | null
          bonus: number | null
          deductions: number | null
          effective_from: string | null
          employee_id: string | null
          gross_salary: number | null
          hra: number | null
          id: string
        }
        Insert: {
          allowances?: number | null
          annual_ctc?: number | null
          basic?: number | null
          bonus?: number | null
          deductions?: number | null
          effective_from?: string | null
          employee_id?: string | null
          gross_salary?: number | null
          hra?: number | null
          id?: string
        }
        Update: {
          allowances?: number | null
          annual_ctc?: number | null
          basic?: number | null
          bonus?: number | null
          deductions?: number | null
          effective_from?: string | null
          employee_id?: string | null
          gross_salary?: number | null
          hra?: number | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_structures_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          break_minutes: number | null
          code: string | null
          end_time: string | null
          grace_minutes: number | null
          id: string
          is_active: boolean | null
          is_overnight: boolean | null
          name: string | null
          organization_id: string | null
          start_time: string | null
        }
        Insert: {
          break_minutes?: number | null
          code?: string | null
          end_time?: string | null
          grace_minutes?: number | null
          id?: string
          is_active?: boolean | null
          is_overnight?: boolean | null
          name?: string | null
          organization_id?: string | null
          start_time?: string | null
        }
        Update: {
          break_minutes?: number | null
          code?: string | null
          end_time?: string | null
          grace_minutes?: number | null
          id?: string
          is_active?: boolean | null
          is_overnight?: boolean | null
          name?: string | null
          organization_id?: string | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          language: string | null
          notification_preferences: Json | null
          theme: string | null
          user_id: string
        }
        Insert: {
          language?: string | null
          notification_preferences?: Json | null
          theme?: string | null
          user_id: string
        }
        Update: {
          language?: string | null
          notification_preferences?: Json | null
          theme?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_employee_complaint: {
        Args: {
          p_category: string
          p_description: string
          p_priority?: string
          p_subject: string
        }
        Returns: {
          assigned_to: string | null
          category: string | null
          created_at: string
          description: string
          employee_id: string
          id: string
          priority: string
          status: string
          subject: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "employee_complaints"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_employee_id: { Args: never; Returns: string }
      current_org_id: { Args: never; Returns: string }
      current_role: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      debug_list_policies: {
        Args: { target_tables: string[] }
        Returns: {
          check_expr: string
          cmd: string
          policy_name: string
          table_name: string
          using_expr: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_admin_or_hr: { Args: never; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      is_my_direct_report: { Args: { emp_id: string }; Returns: boolean }
      is_org_member: { Args: { target_org: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
