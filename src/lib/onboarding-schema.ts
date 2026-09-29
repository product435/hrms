import { z } from "zod";
import type { OnboardingFormValues, OnboardingStepId } from "@/types/onboarding";

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
] as const;

export const GENDERS = ["Female", "Male", "Other"] as const;
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"] as const;

export const INDIAN_MOBILE = /^[6-9]\d{9}$/;
export const PIN_CODE = /^\d{6}$/;
export const ACCOUNT_NUMBER = /^\d{9,18}$/;
export const IFSC_CODE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const EMAIL_WITH_DOMAIN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function isIndianMobile(value: string): boolean {
  return INDIAN_MOBILE.test(value.trim());
}

export function emailHasDomain(value: string): boolean {
  return EMAIL_WITH_DOMAIN.test(value.trim());
}

export function formatIfscInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 11);
}

function choice(values: readonly [string, ...string[]], message: string) {
  return z.enum(values, { errorMap: () => ({ message }) });
}

export function istToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function latestAdultDob(today = istToday()): string {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(year ?? 2000, (month ?? 1) - 1, day ?? 1);
  date.setFullYear(date.getFullYear() - 18);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const phone = z.string().trim().regex(INDIAN_MOBILE, "Enter a 10-digit mobile number.");

const optionalPhone = z
  .string()
  .trim()
  .refine((value) => value === "" || INDIAN_MOBILE.test(value), "Enter a 10-digit mobile number.");

const pin = z.string().trim().regex(PIN_CODE, "PIN code must be 6 digits.");

export const emptyAddress = {
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "India",
  yearsAtAddress: "",
  sameAsCurrent: false,
};

export const emptyOnboardingForm = (): OnboardingFormValues => ({
  firstName: "",
  middleName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  bloodGroup: "",
  maritalStatus: "",
  nationality: "Indian",
  phone: "",
  alternatePhone: "",
  personalEmail: "",
  photoPath: "",
  fatherName: "",
  fatherPhone: "",
  motherName: "",
  motherPhone: "",
  spouseName: "",
  spousePhone: "",
  dependents: "0",
  emergency: [{ name: "", relationship: "", phone: "" }],
  currentAddress: { ...emptyAddress },
  permanentAddress: { ...emptyAddress },
  pan: "",
  aadhaar: "",
  aadhaarOnFile: false,
  passport: "",
  panDocumentPath: "",
  aadhaarDocumentPath: "",
  passportDocumentPath: "",
  qualification: "",
  institute: "",
  educationYear: "",
  uan: "",
  experience: [{ company: "", roleTitle: "", fromDate: "", toDate: "", reasonForLeaving: "" }],
  accountName: "",
  accountNumber: "",
  accountNumberConfirm: "",
  ifsc: "",
  bankName: "",
  branch: "",
  cancelledChequePath: "",
  declaration: false,
});

const addressSchema = z.object({
  addressLine1: z.string().trim().min(1, "Address line 1 is required."),
  addressLine2: z.string().trim(),
  city: z.string().trim().min(1, "City is required."),
  state: z.string().trim().min(1, "State is required."),
  postalCode: pin,
  country: z.string().trim().min(1, "Country is required."),
  yearsAtAddress: z.string().trim(),
  sameAsCurrent: z.boolean(),
});

export const personalSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  middleName: z.string().trim(),
  lastName: z.string().trim().min(1, "Last name is required."),
  dateOfBirth: z
    .string()
    .min(1, "Date of birth is required.")
    .refine((value) => value <= latestAdultDob(), "You must be at least 18 years old."),
  gender: choice(GENDERS, "Select a gender."),
  bloodGroup: choice(BLOOD_GROUPS, "Select a blood group."),
  maritalStatus: choice(MARITAL_STATUSES, "Select a marital status."),
  nationality: z.string().trim().min(1, "Nationality is required."),
  phone: phone,
  alternatePhone: optionalPhone,
  personalEmail: z.string().trim().regex(EMAIL_WITH_DOMAIN, "Enter a valid personal email."),
  photoPath: z.string(),
});

export const familySchema = z
  .object({
    fatherName: z.string().trim().min(1, "Father's name is required."),
    fatherPhone: phone,
    motherName: z.string().trim().min(1, "Mother's name is required."),
    motherPhone: phone,
    spouseName: z.string().trim(),
    spousePhone: z.string().trim(),
    dependents: z.string().trim(),
    maritalStatus: z.string(),
  })
  .superRefine((value, ctx) => {
    const count = Number(value.dependents || "0");
    if (!Number.isInteger(count) || count < 0) {
      ctx.addIssue({
        code: "custom",
        path: ["dependents"],
        message: "Dependents must be 0 or more.",
      });
    }
    if (value.maritalStatus === "Married") {
      if (!value.spouseName) {
        ctx.addIssue({ code: "custom", path: ["spouseName"], message: "Spouse name is required." });
      }
      if (!INDIAN_MOBILE.test(value.spousePhone)) {
        ctx.addIssue({
          code: "custom",
          path: ["spousePhone"],
          message: "Enter a 10-digit mobile number.",
        });
      }
    }
  });

export const emergencySchema = z
  .object({
    phone: z.string(),
    alternatePhone: z.string(),
    emergency: z
      .array(
        z.object({
          name: z.string().trim().min(1, "Name is required."),
          relationship: z.string().trim().min(1, "Relation is required."),
          phone: phone,
        }),
      )
      .min(1, "Add at least one emergency contact.")
      .max(3, "You can add up to 3 emergency contacts."),
  })
  .superRefine((value, ctx) => {
    const own = new Set([value.phone, value.alternatePhone].filter(Boolean));
    value.emergency.forEach((contact, index) => {
      if (own.has(contact.phone)) {
        ctx.addIssue({
          code: "custom",
          path: ["emergency", index, "phone"],
          message: "Emergency number must be different from your own mobile.",
        });
      }
    });
  });

export const addressesSchema = z
  .object({
    currentAddress: addressSchema,
    permanentAddress: addressSchema,
  })
  .superRefine((value, ctx) => {
    const years = value.currentAddress.yearsAtAddress.trim();
    if (years && (!/^\d+(\.\d+)?$/.test(years) || Number(years) < 0 || Number(years) > 80)) {
      ctx.addIssue({
        code: "custom",
        path: ["currentAddress", "yearsAtAddress"],
        message: "Enter years at the current address.",
      });
    }
  });

export const identitySchema = z
  .object({
    pan: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value), "PAN must look like ABCDE1234F."),
    aadhaar: z.string().trim(),
    aadhaarOnFile: z.boolean(),
    passport: z.string().trim(),
    panDocumentPath: z.string().min(1, "Upload the PAN card."),
    aadhaarDocumentPath: z.string().min(1, "Upload the Aadhaar card."),
    passportDocumentPath: z.string(),
    uan: z.string().trim(),
  })
  .superRefine((value, ctx) => {
    const digits = value.aadhaar.replace(/\D/g, "");
    const ok =
      digits.length === 12 || (value.aadhaarOnFile && (digits.length === 0 || digits.length === 4));
    if (!ok) {
      ctx.addIssue({
        code: "custom",
        path: ["aadhaar"],
        message: "Enter the 12-digit Aadhaar number. Only the last 4 digits are stored.",
      });
    }
    if (value.uan && !/^\d{12}$/.test(value.uan)) {
      ctx.addIssue({ code: "custom", path: ["uan"], message: "UAN must be 12 digits." });
    }
    if (value.passport && !/^[A-Z0-9]{6,12}$/i.test(value.passport)) {
      ctx.addIssue({
        code: "custom",
        path: ["passport"],
        message: "Passport number looks invalid.",
      });
    }
  });

export const educationSchema = z.object({
  qualification: z.string().trim().min(1, "Highest qualification is required."),
  institute: z.string().trim().min(1, "Institute is required."),
  educationYear: z
    .string()
    .trim()
    .regex(/^(19|20)\d{2}$/, "Enter a four-digit year."),
  uan: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{12}$/.test(value), "UAN must be 12 digits."),
  experience: z.array(
    z
      .object({
        company: z.string().trim(),
        roleTitle: z.string().trim(),
        fromDate: z.string().trim(),
        toDate: z.string().trim(),
        reasonForLeaving: z.string().trim(),
      })
      .superRefine((row, ctx) => {
        const started = [
          row.company,
          row.roleTitle,
          row.fromDate,
          row.toDate,
          row.reasonForLeaving,
        ].some(Boolean);
        if (!started) return;
        if (!row.company)
          ctx.addIssue({ code: "custom", path: ["company"], message: "Company is required." });
        if (!row.roleTitle)
          ctx.addIssue({ code: "custom", path: ["roleTitle"], message: "Role is required." });
        if (!row.fromDate)
          ctx.addIssue({ code: "custom", path: ["fromDate"], message: "From date is required." });
      }),
  ),
});

export const bankSchema = z
  .object({
    accountName: z.string().trim().min(1, "Account holder name is required."),
    accountNumber: z
      .string()
      .trim()
      .regex(ACCOUNT_NUMBER, "Account number must be 9 to 18 digits."),
    accountNumberConfirm: z.string().trim(),
    ifsc: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .refine((value) => IFSC_CODE.test(value), "IFSC must look like HDFC0001234."),
    bankName: z.string().trim().min(1, "Bank name is required."),
    branch: z.string().trim().min(1, "Branch is required."),
    cancelledChequePath: z.string().min(1, "Upload a cancelled cheque."),
  })
  .superRefine((value, ctx) => {
    if (value.accountNumber !== value.accountNumberConfirm) {
      ctx.addIssue({
        code: "custom",
        path: ["accountNumberConfirm"],
        message: "Account numbers do not match.",
      });
    }
  });

export const reviewSchema = z.object({
  declaration: z.boolean().refine((value) => value, "Accept the declaration to submit."),
});

export function validateOnboardingStep(
  step: OnboardingStepId,
  values: OnboardingFormValues,
): { success: true } | { success: false; fieldErrors: Record<string, string> } {
  const parsed =
    step === "personal"
      ? personalSchema.safeParse(values)
      : step === "family"
        ? familySchema.safeParse(values)
        : step === "emergency"
          ? emergencySchema.safeParse(values)
          : step === "addresses"
            ? addressesSchema.safeParse(values)
            : step === "identity"
              ? identitySchema.safeParse({ ...values, pan: values.pan.toUpperCase() })
              : step === "education"
                ? educationSchema.safeParse(values)
                : step === "bank"
                  ? bankSchema.safeParse({ ...values, ifsc: values.ifsc.toUpperCase() })
                  : reviewSchema.safeParse(values);

  if (parsed.success) return { success: true };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { success: false, fieldErrors };
}

export function aadhaarLast4(value: string, onFile: boolean): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  if (onFile) return null;
  return null;
}
