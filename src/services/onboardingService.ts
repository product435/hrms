/* New onboarding tables are not in the generated Database type yet. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  ACCOUNT_NUMBER,
  BLOOD_GROUPS,
  GENDERS,
  IFSC_CODE,
  INDIAN_MOBILE,
  MARITAL_STATUSES,
  PIN_CODE,
  aadhaarLast4,
  emailHasDomain,
  isIndianMobile,
} from "@/lib/onboarding-schema";
import type {
  AddressDraft,
  ApproveOnboardingInput,
  ExperienceDraft,
  OnboardingDraft,
  OnboardingFormValues,
  OnboardingQueueBucket,
  OnboardingQueueItem,
  OnboardingReferences,
  OnboardingStepId,
  OnboardingTaskList,
  ProfileChangeRequestItem,
} from "@/types/onboarding";
import { emptyAddress, emptyOnboardingForm } from "@/lib/onboarding-schema";

const db = supabase as unknown as {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
  storage: any;
};

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase is not configured.");
  }
  return supabase;
}

export function friendlyOnboardingError(message: string): string {
  if (
    /personal email is already registered/i.test(message) ||
    /employees_personal_email/i.test(message)
  ) {
    return "This personal email is already registered. Sign in or use forgot password if this is your account.";
  }
  if (/mobile number is already registered/i.test(message) || /employees_phone/i.test(message)) {
    return "This mobile number is already registered. Sign in or use forgot password if this is your account.";
  }
  if (/profile_change_requests_one_pending/i.test(message)) {
    return "You already have a pending request for this section.";
  }
  if (/at least 18/i.test(message)) return "You must be at least 18 years old.";
  if (/PIN code/i.test(message)) return "PIN code must be 6 digits.";
  if (/IFSC/i.test(message)) return "IFSC must look like HDFC0001234.";
  if (/PAN/i.test(message)) return "PAN must look like ABCDE1234F.";
  if (/Emergency contact/i.test(message)) {
    return "Emergency contact number must be different from your own mobile number.";
  }
  if (/Joining date is in the past/i.test(message)) {
    return "Joining date is in the past. Add a reason to override it.";
  }
  if (/employee code is already/i.test(message)) return "That employee code is already in use.";
  const stripped = message.replace(/^.*?ERROR:\s+/i, "").trim();
  return stripped.length > 0 && stripped.length < 320 ? stripped : "Could not save these details.";
}

function fail(error: { message?: string } | null): never {
  throw new Error(friendlyOnboardingError(error?.message || "Request failed."));
}

function asFlags(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const flags: Record<string, string> = {};
  for (const [key, remark] of Object.entries(value as Record<string, unknown>)) {
    flags[key] = typeof remark === "string" ? remark : "";
  }
  return flags;
}

function bucketFor(employmentStatus: string, submissionStatus: string): OnboardingQueueBucket {
  if (employmentStatus === "rejected" || submissionStatus === "rejected") return "rejected";
  if (submissionStatus === "approved") return "approved";
  if (
    submissionStatus === "changes_requested" ||
    employmentStatus === "profile_changes_requested"
  ) {
    return "changes";
  }
  if (submissionStatus === "submitted") return "pending";
  return "incomplete";
}

function staleIncomplete(createdAt: string | null, bucket: OnboardingQueueBucket): boolean {
  if (bucket !== "incomplete" || !createdAt) return false;
  return Date.now() - new Date(createdAt).getTime() > 30 * 24 * 60 * 60 * 1000;
}

function validPhone(value: string): string | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return INDIAN_MOBILE.test(trimmed) ? trimmed : undefined;
}

function storedPhone(value: string): string | null {
  const phone = validPhone(value);
  if (phone === undefined) throw new Error("Enter a 10-digit mobile number.");
  return phone;
}

function listedChoice(value: string, allowed: readonly string[], message: string): string {
  const trimmed = value.trim();
  if (!allowed.includes(trimmed)) throw new Error(message);
  return trimmed;
}

export async function employmentStatusForUser(
  client: { from: (table: string) => any },
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await client
      .from("employees")
      .select("employment_status")
      .eq("profile_id", userId)
      .limit(1);
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : null;
    return typeof row?.employment_status === "string" ? row.employment_status : null;
  } catch {
    return null;
  }
}

async function currentUserId() {
  const client = requireClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("Sign in again to continue.");
  return data.user.id;
}

async function employeeRow(employeeId?: string) {
  requireClient();
  const query = db.from("employees").select("*");
  const result = employeeId
    ? await query.eq("id", employeeId).limit(1)
    : await query.eq("profile_id", await currentUserId()).limit(1);
  if (result.error) fail(result.error);
  const row = result.data?.[0];
  if (!row) throw new Error("Employee profile was not found.");
  return row;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapAddress(row: any | undefined, sameAs = false): AddressDraft {
  if (!row) return { ...emptyAddress, sameAsCurrent: sameAs };
  return {
    addressLine1: text(row.address_line1),
    addressLine2: text(row.address_line2),
    city: text(row.city),
    state: text(row.state),
    postalCode: text(row.postal_code),
    country: text(row.country) || "India",
    yearsAtAddress: row.years_at_address == null ? "" : String(row.years_at_address),
    sameAsCurrent: Boolean(row.same_as_current),
  };
}

async function readDraft(employeeId?: string): Promise<OnboardingDraft> {
  const employee = await employeeRow(employeeId);
  const id = employee.id as string;
  const [family, emergency, addresses, identity, education, experience, bank, submission] =
    await Promise.all([
      db.from("employee_family_members").select("*").eq("employee_id", id),
      db.from("emergency_contacts").select("*").eq("employee_id", id),
      db.from("employee_addresses").select("*").eq("employee_id", id),
      db.from("employee_identity").select("*").eq("employee_id", id).limit(1),
      db.from("employee_education").select("*").eq("employee_id", id),
      db.from("employee_experience").select("*").eq("employee_id", id),
      db.from("employee_bank_accounts").select("*").eq("employee_id", id),
      db.from("onboarding_submissions").select("*").eq("employee_id", id).limit(1),
    ]);
  for (const result of [
    family,
    emergency,
    addresses,
    identity,
    education,
    experience,
    bank,
    submission,
  ]) {
    if (result.error) fail(result.error);
  }

  const familyRows = family.data ?? [];
  const byRelation = (relation: string) => familyRows.find((row: any) => row.relation === relation);
  const father = byRelation("father");
  const mother = byRelation("mother");
  const spouse = byRelation("spouse");
  const dependents = byRelation("dependents");
  const addressRows = addresses.data ?? [];
  const identityRow = identity.data?.[0];
  const educationRow =
    (education.data ?? []).find((row: any) => row.is_highest) ?? education.data?.[0];
  const bankRow = (bank.data ?? []).find((row: any) => row.is_primary) ?? (bank.data ?? [])[0];
  const submissionRow = submission.data?.[0];
  const accountNumber = text(bankRow?.account_number);
  const masked = text(identityRow?.aadhaar_masked);
  const base = emptyOnboardingForm();

  return {
    ...base,
    employeeId: id,
    employmentStatus: text(employee.employment_status),
    submissionStatus: text(submissionRow?.status) || "draft",
    remarks: text(submissionRow?.remarks),
    sectionFlags: asFlags(submissionRow?.section_flags),
    submittedAt: submissionRow?.submitted_at ?? null,
    createdAt: employee.created_at ?? null,
    profileCompletedAt: employee.profile_completed_at ?? null,
    employeeCode: text(employee.employee_code),
    workEmail: text(employee.email),
    firstName: text(employee.first_name),
    middleName: text(employee.middle_name),
    lastName: text(employee.last_name),
    dateOfBirth: text(employee.date_of_birth),
    gender: text(employee.gender),
    bloodGroup: text(employee.blood_group),
    maritalStatus: text(employee.marital_status),
    nationality: text(employee.nationality) || "Indian",
    phone: text(employee.phone),
    alternatePhone: text(employee.alternate_phone),
    personalEmail: text(employee.personal_email),
    photoPath: text(employee.photo_url),
    fatherName: text(father?.name),
    fatherPhone: text(father?.phone),
    motherName: text(mother?.name),
    motherPhone: text(mother?.phone),
    spouseName: text(spouse?.name),
    spousePhone: text(spouse?.phone),
    dependents: dependents?.dependents_count == null ? "0" : String(dependents.dependents_count),
    emergency: (emergency.data ?? []).length
      ? (emergency.data ?? []).slice(0, 3).map((row: any) => ({
          name: text(row.name),
          relationship: text(row.relationship),
          phone: text(row.phone),
        }))
      : base.emergency,
    currentAddress: mapAddress(addressRows.find((row: any) => row.address_type === "current")),
    permanentAddress: mapAddress(addressRows.find((row: any) => row.address_type === "permanent")),
    pan: text(identityRow?.pan),
    aadhaar: masked,
    aadhaarOnFile: Boolean(identityRow?.aadhaar_last4),
    passport: text(identityRow?.passport_number),
    panDocumentPath: text(identityRow?.pan_document_path),
    aadhaarDocumentPath: text(identityRow?.aadhaar_document_path),
    passportDocumentPath: text(identityRow?.passport_document_path),
    qualification: text(educationRow?.qualification),
    institute: text(educationRow?.institute),
    educationYear: educationRow?.year == null ? "" : String(educationRow.year),
    uan: text(identityRow?.uan),
    experience: (experience.data ?? []).length
      ? (experience.data ?? []).map((row: any) => ({
          company: text(row.company),
          roleTitle: text(row.role_title),
          fromDate: text(row.from_date),
          toDate: text(row.to_date),
          reasonForLeaving: text(row.reason_for_leaving),
        }))
      : base.experience,
    accountName: text(bankRow?.account_name),
    accountNumber,
    accountNumberConfirm: accountNumber,
    ifsc: text(bankRow?.ifsc),
    bankName: text(bankRow?.bank_name),
    branch: text(bankRow?.branch),
    cancelledChequePath: text(bankRow?.cancelled_cheque_path),
    declaration: Boolean(submissionRow?.declaration_accepted),
  };
}

async function replaceRows(table: string, employeeId: string, rows: Record<string, unknown>[]) {
  const existing = await db.from(table).select("id").eq("employee_id", employeeId);
  if (existing.error) fail(existing.error);
  const ids = (existing.data ?? []).map((row: { id: string }) => row.id);
  if (rows.length) {
    const inserted = await db.from(table).insert(rows);
    if (inserted.error) fail(inserted.error);
  }
  if (!ids.length) return;
  const removed = await db.from(table).delete().in("id", ids);
  if (removed.error) fail(removed.error);
}

async function upsertAddress(
  employeeId: string,
  type: "current" | "permanent",
  address: AddressDraft,
) {
  const pin = address.postalCode.trim();
  if (!PIN_CODE.test(pin)) throw new Error("PIN code must be 6 digits.");
  const payload = {
    employee_id: employeeId,
    address_type: type,
    address_line1: address.addressLine1.trim() || null,
    address_line2: address.addressLine2.trim() || null,
    city: address.city.trim() || null,
    state: address.state.trim() || null,
    postal_code: pin || null,
    country: address.country.trim() || "India",
    years_at_address:
      address.yearsAtAddress.trim() && /^\d+(\.\d+)?$/.test(address.yearsAtAddress.trim())
        ? Number(address.yearsAtAddress)
        : null,
    same_as_current: type === "permanent" ? address.sameAsCurrent : false,
  };
  const existing = await db
    .from("employee_addresses")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("address_type", type)
    .limit(1);
  if (existing.error) fail(existing.error);
  const id = existing.data?.[0]?.id as string | undefined;
  const result = id
    ? await db.from("employee_addresses").update(payload).eq("id", id)
    : await db.from("employee_addresses").insert(payload);
  if (result.error) fail(result.error);
}

async function upsertIdentity(employeeId: string, patch: Record<string, unknown>) {
  const existing = await db
    .from("employee_identity")
    .select("id")
    .eq("employee_id", employeeId)
    .limit(1);
  if (existing.error) fail(existing.error);
  const id = existing.data?.[0]?.id as string | undefined;
  const result = id
    ? await db.from("employee_identity").update(patch).eq("id", id)
    : await db.from("employee_identity").insert({ employee_id: employeeId, ...patch });
  if (result.error) fail(result.error);
}

async function upsertBank(employeeId: string, patch: Record<string, unknown>) {
  const existing = await db
    .from("employee_bank_accounts")
    .select("id, is_primary")
    .eq("employee_id", employeeId);
  if (existing.error) fail(existing.error);
  const row =
    (existing.data ?? []).find((item: any) => item.is_primary) ?? (existing.data ?? [])[0];
  const result = row
    ? await db
        .from("employee_bank_accounts")
        .update({ ...patch, is_primary: true })
        .eq("id", row.id)
    : await db
        .from("employee_bank_accounts")
        .insert({ employee_id: employeeId, is_primary: true, ...patch });
  if (result.error) fail(result.error);
}

function experienceRows(employeeId: string, rows: ExperienceDraft[]) {
  return rows
    .filter((row) => row.company.trim() || row.roleTitle.trim())
    .map((row) => ({
      employee_id: employeeId,
      company: row.company.trim() || null,
      role_title: row.roleTitle.trim() || null,
      from_date: row.fromDate || null,
      to_date: row.toDate || null,
      reason_for_leaving: row.reasonForLeaving.trim() || null,
    }));
}

export const onboardingService = {
  draft(employeeId?: string) {
    requireClient();
    return readDraft(employeeId);
  },

  async saveStep(step: OnboardingStepId, values: OnboardingFormValues, employeeId?: string) {
    requireClient();
    const employee = await employeeRow(employeeId);
    const id = employee.id as string;
    if (step === "personal") {
      const phone = validPhone(values.phone);
      if (!phone) throw new Error("Enter a 10-digit mobile number.");
      const alternate = validPhone(values.alternatePhone);
      if (values.alternatePhone.trim() && alternate === undefined) {
        throw new Error("Enter a 10-digit mobile number.");
      }
      const email = values.personalEmail.trim().toLowerCase();
      if (!emailHasDomain(email)) throw new Error("Enter a valid personal email.");
      const patch: Record<string, unknown> = {
        first_name: values.firstName.trim() || null,
        middle_name: values.middleName.trim() || null,
        last_name: values.lastName.trim() || null,
        gender: listedChoice(values.gender, GENDERS, "Select a gender."),
        blood_group: listedChoice(values.bloodGroup, BLOOD_GROUPS, "Select a blood group."),
        marital_status: listedChoice(
          values.maritalStatus,
          MARITAL_STATUSES,
          "Select a marital status.",
        ),
        nationality: values.nationality.trim() || "Indian",
      };
      if (values.dateOfBirth) patch["date_of_birth"] = values.dateOfBirth;
      patch["phone"] = phone;
      if (alternate !== undefined) patch["alternate_phone"] = alternate;
      patch["personal_email"] = email;
      if (values.photoPath) patch["photo_url"] = values.photoPath;
      const result = await db.from("employees").update(patch).eq("id", id);
      if (result.error) fail(result.error);
      return;
    }

    if (step === "family") {
      const rows: Array<{
        relation: string;
        name: string | null;
        phone: string | null;
        dependents_count: number | null;
      }> = [
        {
          relation: "father",
          name: values.fatherName.trim() || null,
          phone: storedPhone(values.fatherPhone),
          dependents_count: null,
        },
        {
          relation: "mother",
          name: values.motherName.trim() || null,
          phone: storedPhone(values.motherPhone),
          dependents_count: null,
        },
      ];
      if (
        values.maritalStatus === "Married" &&
        (values.spouseName.trim() || values.spousePhone.trim())
      ) {
        rows.push({
          relation: "spouse",
          name: values.spouseName.trim() || null,
          phone: storedPhone(values.spousePhone),
          dependents_count: null,
        });
      }
      const count = Number(values.dependents || "0");
      rows.push({
        relation: "dependents",
        name: null,
        phone: null,
        dependents_count: Number.isInteger(count) && count >= 0 ? count : 0,
      });
      const existing = await db
        .from("employee_family_members")
        .select("id, relation")
        .eq("employee_id", id);
      if (existing.error) fail(existing.error);
      const byRelation = new Map<string, string>(
        (existing.data ?? []).map((row: { id: string; relation: string }) => [
          row.relation,
          row.id,
        ]),
      );
      for (const row of rows) {
        const currentId = byRelation.get(row.relation);
        const result = currentId
          ? await db.from("employee_family_members").update(row).eq("id", currentId)
          : await db.from("employee_family_members").insert({ employee_id: id, ...row });
        if (result.error) fail(result.error);
        byRelation.delete(row.relation);
      }
      const leftover = [...byRelation.values()];
      if (leftover.length) {
        const removed = await db.from("employee_family_members").delete().in("id", leftover);
        if (removed.error) fail(removed.error);
      }
      return;
    }

    if (step === "emergency") {
      const rows = values.emergency
        .filter((contact) => contact.name.trim() || contact.phone.trim())
        .slice(0, 3)
        .map((contact) => ({
          employee_id: id,
          name: contact.name.trim() || null,
          relationship: contact.relationship.trim() || null,
          phone: storedPhone(contact.phone),
        }));
      await replaceRows("emergency_contacts", id, rows);
      return;
    }

    if (step === "addresses") {
      const permanent = values.permanentAddress.sameAsCurrent
        ? { ...values.currentAddress, sameAsCurrent: true, yearsAtAddress: "" }
        : values.permanentAddress;
      await upsertAddress(id, "current", values.currentAddress);
      await upsertAddress(id, "permanent", permanent);
      return;
    }

    if (step === "identity") {
      const patch: Record<string, unknown> = {};
      const pan = values.pan.trim().toUpperCase();
      if (!pan || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) patch["pan"] = pan || null;
      const last4 = aadhaarLast4(values.aadhaar, values.aadhaarOnFile);
      if (last4) patch["aadhaar_last4"] = last4;
      const uan = values.uan.trim();
      if (!uan || /^\d{12}$/.test(uan)) patch["uan"] = uan || null;
      if (!values.passport.trim() || /^[A-Z0-9]{6,12}$/i.test(values.passport.trim())) {
        patch["passport_number"] = values.passport.trim().toUpperCase() || null;
      }
      if (values.panDocumentPath) patch["pan_document_path"] = values.panDocumentPath;
      if (values.aadhaarDocumentPath) patch["aadhaar_document_path"] = values.aadhaarDocumentPath;
      if (values.passportDocumentPath)
        patch["passport_document_path"] = values.passportDocumentPath;
      await upsertIdentity(id, patch);
      return;
    }

    if (step === "education") {
      const uan = values.uan.trim();
      if (!uan || /^\d{12}$/.test(uan)) await upsertIdentity(id, { uan: uan || null });
      await replaceRows("employee_education", id, [
        {
          employee_id: id,
          qualification: values.qualification.trim() || null,
          institute: values.institute.trim() || null,
          year: /^\d{4}$/.test(values.educationYear) ? Number(values.educationYear) : null,
          is_highest: true,
        },
      ]);
      await replaceRows("employee_experience", id, experienceRows(id, values.experience));
      return;
    }

    if (step === "bank") {
      const account = values.accountNumber.trim();
      const confirm = values.accountNumberConfirm.trim();
      const ifsc = values.ifsc.trim().toUpperCase();
      if (account !== confirm) throw new Error("Account numbers do not match.");
      if (!ACCOUNT_NUMBER.test(account)) throw new Error("Account number must be 9 to 18 digits.");
      if (!IFSC_CODE.test(ifsc)) throw new Error("IFSC must look like HDFC0001234.");
      const patch: Record<string, unknown> = {
        account_name: values.accountName.trim() || null,
        bank_name: values.bankName.trim() || null,
        branch: values.branch.trim() || null,
        account_number: account,
        ifsc,
      };
      if (values.cancelledChequePath) patch["cancelled_cheque_path"] = values.cancelledChequePath;
      await upsertBank(id, patch);
    }
  },

  async uploadDocument(
    employeeId: string,
    file: File,
    folder: "photo" | "kyc" | "bank",
    category: string,
  ) {
    requireClient();
    const safeName = file.name.replace(/[^\w.-]+/g, "_");
    const path = `${employeeId}/${folder}/${crypto.randomUUID()}-${safeName}`;
    const uploaded = await db.storage.from("documents").upload(path, file, {
      upsert: false,
      contentType: file.type || undefined,
    });
    if (uploaded.error) fail(uploaded.error);
    const inserted = await db
      .from("documents")
      .insert({
        employee_id: employeeId,
        title: file.name,
        category,
        file_size: file.size,
        file_type: file.type || null,
        file_url: path,
        uploaded_by: await currentUserId(),
      })
      .select("id")
      .single();
    if (inserted.error) {
      await db.storage.from("documents").remove([path]);
      fail(inserted.error);
    }
    return path as string;
  },

  async documentUrl(path: string) {
    requireClient();
    if (!path) return null;
    const signed = await db.storage.from("documents").createSignedUrl(path, 120);
    if (signed.error) fail(signed.error);
    return (signed.data?.signedUrl as string | undefined) ?? null;
  },

  async submit(declaration: boolean) {
    requireClient();
    const { error } = await db.rpc("submit_employee_onboarding", { p_declaration: declaration });
    if (error) fail(error);
  },

  async queue(): Promise<OnboardingQueueItem[]> {
    requireClient();
    const { error: reminderError } = await db.rpc("remind_incomplete_onboarding");
    if (reminderError && !/remind_incomplete_onboarding/i.test(reminderError.message ?? "")) {
      // A missing migration surfaces on the list query below. A reminder failure should not hide the queue.
    }
    const { data, error } = await db
      .from("onboarding_submissions")
      .select(
        "status, submitted_at, remarks, section_flags, created_at, employees!onboarding_submissions_employee_id_fkey(id, first_name, middle_name, last_name, email, phone, employee_code, employment_status, created_at)",
      )
      .order("created_at", { ascending: false });
    if (error) fail(error);
    return (data ?? []).map((row: any) => {
      const employee = row.employees ?? {};
      const employmentStatus = text(employee.employment_status);
      const submissionStatus = text(row.status) || "draft";
      const bucket = bucketFor(employmentStatus, submissionStatus);
      const createdAt = employee.created_at ?? row.created_at ?? null;
      const name = [employee.first_name, employee.middle_name, employee.last_name]
        .filter(Boolean)
        .join(" ");
      return {
        employeeId: employee.id as string,
        name: name || "New employee",
        email: text(employee.email),
        phone: text(employee.phone),
        employeeCode: text(employee.employee_code),
        employmentStatus,
        submissionStatus,
        submittedAt: row.submitted_at ?? null,
        createdAt,
        remarks: text(row.remarks),
        sectionFlags: asFlags(row.section_flags),
        bucket,
        stale: staleIncomplete(createdAt, bucket),
      };
    });
  },

  async references(): Promise<OnboardingReferences> {
    requireClient();
    const [departments, designations, shifts, leads] = await Promise.all([
      db.from("departments").select("id,name").order("name"),
      db.from("designations").select("id,name").order("name"),
      db.from("shifts").select("id,name").order("name"),
      db
        .from("employees")
        .select("id, first_name, last_name, employee_code, employment_status")
        .in("employment_status", ["active", "probation"])
        .order("first_name"),
    ]);
    for (const result of [departments, designations, shifts, leads]) {
      if (result.error) fail(result.error);
    }
    const option = (row: any) => ({ id: row.id as string, name: text(row.name) });
    return {
      departments: (departments.data ?? []).map(option),
      designations: (designations.data ?? []).map(option),
      shifts: (shifts.data ?? []).map(option),
      leads: (leads.data ?? []).map((row: any) => ({
        id: row.id as string,
        name:
          `${text(row.first_name)} ${text(row.last_name)}`.trim() +
          (row.employee_code ? ` (${row.employee_code})` : ""),
      })),
    };
  },

  async approve(input: ApproveOnboardingInput) {
    requireClient();
    const { error } = await db.rpc("approve_employee_onboarding", {
      p_employee_id: input.employeeId,
      p_department_id: input.departmentId,
      p_designation_id: input.designationId,
      p_role: input.role,
      p_manager_id: input.managerId || null,
      p_shift_id: input.shiftId || null,
      p_joining_date: input.joiningDate,
      p_employee_code: input.employeeCode.trim() || null,
      p_override_joining_date_reason: input.overrideJoiningDateReason.trim() || null,
    });
    if (error) fail(error);
  },

  async reject(employeeId: string, remarks: string) {
    requireClient();
    const { error } = await db.rpc("reject_employee_onboarding", {
      p_employee_id: employeeId,
      p_remarks: remarks,
    });
    if (error) fail(error);
  },

  async requestChanges(employeeId: string, sectionFlags: Record<string, string>, remarks: string) {
    requireClient();
    const { error } = await db.rpc("request_onboarding_changes", {
      p_employee_id: employeeId,
      p_section_flags: sectionFlags,
      p_remarks: remarks,
    });
    if (error) fail(error);
  },

  async tasks(employeeId: string): Promise<OnboardingTaskList> {
    requireClient();
    const { data, error } = await db
      .from("onboarding_records")
      .select(
        "id, joining_date, onboarding_tasks!onboarding_tasks_onboarding_id_fkey(id, title, completed_at)",
      )
      .eq("employee_id", employeeId)
      .order("joining_date", { ascending: false });
    if (error) fail(error);
    const record = (data ?? [])[0];
    return {
      recordId: record?.id ?? null,
      tasks: (record?.onboarding_tasks ?? []).map((task: any) => ({
        id: task.id as string,
        title: text(task.title),
        done: Boolean(task.completed_at),
      })),
    };
  },

  async changeRequests(): Promise<ProfileChangeRequestItem[]> {
    requireClient();
    const { data, error } = await db
      .from("profile_change_requests")
      .select(
        "id, employee_id, section, payload, status, remarks, created_at, employees!profile_change_requests_employee_id_fkey(first_name, last_name)",
      )
      .order("created_at", { ascending: false });
    if (error) fail(error);
    return (data ?? []).map((row: any) => ({
      id: row.id as string,
      employeeId: row.employee_id as string,
      employeeName: `${text(row.employees?.first_name)} ${text(row.employees?.last_name)}`.trim(),
      section: row.section,
      payload: row.payload ?? {},
      status: row.status,
      remarks: text(row.remarks),
      createdAt: row.created_at ?? null,
    }));
  },

  async requestProfileChange(
    section: "address" | "bank" | "phone",
    payload: Record<string, unknown>,
  ) {
    if (section === "phone") {
      const phone = String(payload["phone"] ?? "");
      const alternate = String(payload["alternatePhone"] ?? "");
      if (!isIndianMobile(phone)) throw new Error("Enter a 10-digit mobile number.");
      if (alternate.trim() && !isIndianMobile(alternate)) {
        throw new Error("Enter a 10-digit mobile number.");
      }
    }
    if (section === "address") {
      const current = payload["current"];
      const postalCode =
        current && typeof current === "object" && "postalCode" in current
          ? String(current.postalCode ?? "")
          : "";
      if (!PIN_CODE.test(postalCode)) throw new Error("PIN code must be 6 digits.");
    }
    if (section === "bank") {
      const account = String(payload["accountNumber"] ?? "");
      const confirm = String(payload["accountNumberConfirm"] ?? "");
      const ifsc = String(payload["ifsc"] ?? "").toUpperCase();
      if (account !== confirm) throw new Error("Account numbers do not match.");
      if (!ACCOUNT_NUMBER.test(account)) throw new Error("Account number must be 9 to 18 digits.");
      if (!IFSC_CODE.test(ifsc)) throw new Error("IFSC must look like HDFC0001234.");
    }
    requireClient();
    const employee = await employeeRow();
    const { error } = await db.from("profile_change_requests").insert({
      employee_id: employee.id,
      organization_id: employee.organization_id,
      section,
      payload,
      status: "pending",
    });
    if (error) fail(error);
  },

  async reviewChange(requestId: string, decision: "approved" | "rejected", remarks: string) {
    requireClient();
    const { error } = await db.rpc("review_profile_change_request", {
      p_request_id: requestId,
      p_decision: decision,
      p_remarks: remarks || null,
    });
    if (error) fail(error);
  },
};
