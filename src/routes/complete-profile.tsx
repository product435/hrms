import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { AppLayout } from "@/components/layout/AppLayout";
import { MobileInput } from "@/components/common/MobileInput";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { ErrorState } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAuthForPath } from "@/lib/auth-guard";
import {
  BLOOD_GROUPS,
  GENDERS,
  INDIAN_STATES,
  MARITAL_STATUSES,
  digitsOnly,
  emptyOnboardingForm,
  formatIfscInput,
  latestAdultDob,
  validateOnboardingStep,
} from "@/lib/onboarding-schema";
import { onboardingService } from "@/services/onboardingService";
import { useSession } from "@/hooks/useSession";
import {
  ONBOARDING_STEPS,
  type OnboardingFormValues,
  type OnboardingStepId,
} from "@/types/onboarding";

export const Route = createFileRoute("/complete-profile")({
  beforeLoad: () => requireAuthForPath("/complete-profile"),
  head: () => ({
    meta: [
      { title: "Complete profile · JeeVijay HRMS" },
      {
        name: "description",
        content: "Finish your employee profile. HR reviews it before your account is activated.",
      },
    ],
  }),
  component: CompleteProfilePage,
});

const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";

function stepOpen(
  status: string,
  submissionStatus: string,
  flags: Record<string, string>,
  stepId: OnboardingStepId,
) {
  if (status === "pending_approval" && (submissionStatus === "draft" || submissionStatus === ""))
    return true;
  if (status === "profile_changes_requested" || submissionStatus === "changes_requested") {
    if (stepId === "review") return true;
    if (stepId === "education") return "education" in flags || "experience" in flags;
    return stepId in flags;
  }
  return false;
}

function CompleteProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { signOut } = useSession();
  const draft = useQuery({
    queryKey: ["onboarding-draft"],
    queryFn: () => onboardingService.draft(),
  });
  const form = useForm<OnboardingFormValues>({ defaultValues: emptyOnboardingForm() });
  const [stepIndex, setStepIndex] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [savedLabel, setSavedLabel] = useState("");
  const step = ONBOARDING_STEPS[stepIndex] ?? ONBOARDING_STEPS[0]!;
  const values = form.watch();

  useEffect(() => {
    if (!draft.data || hydrated) return;
    form.reset(draft.data);
    setHydrated(true);
    const active = ["active", "probation", "notice", "on-leave", "resigned"].includes(
      draft.data.employmentStatus,
    );
    if (active) {
      void navigate({ to: "/profile-status" });
      return;
    }
    if (draft.data.submissionStatus === "changes_requested") {
      const first = ONBOARDING_STEPS.findIndex(
        (item) =>
          item.id !== "review" &&
          stepOpen(
            draft.data.employmentStatus,
            draft.data.submissionStatus,
            draft.data.sectionFlags,
            item.id,
          ),
      );
      if (first >= 0) setStepIndex(first);
    }
  }, [draft.data, form, hydrated, navigate]);

  const editable = draft.data
    ? stepOpen(
        draft.data.employmentStatus,
        draft.data.submissionStatus,
        draft.data.sectionFlags,
        step.id,
      )
    : false;

  const snapshot = JSON.stringify(values);

  useEffect(() => {
    if (!hydrated || !editable || step.id === "review") return;
    const handle = window.setTimeout(() => {
      const current = form.getValues();
      if (!validateOnboardingStep(step.id, current).success) return;
      void onboardingService
        .saveStep(step.id, withPermanentCopy(current))
        .then(() => setSavedLabel("Draft saved"))
        .catch(() => setSavedLabel(""));
    }, 900);
    return () => window.clearTimeout(handle);
  }, [editable, form, hydrated, snapshot, step.id]);

  const upload = useMutation({
    mutationFn: async (input: {
      file: File;
      folder: "photo" | "kyc" | "bank";
      category: string;
    }) => {
      if (!draft.data) throw new Error("Profile is still loading.");
      return onboardingService.uploadDocument(
        draft.data.employeeId,
        input.file,
        input.folder,
        input.category,
      );
    },
    onError: (error) =>
      toast.error("Upload failed", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  async function saveCurrent() {
    const current = withPermanentCopy(form.getValues());
    form.setValue("permanentAddress", current.permanentAddress);
    const result = validateOnboardingStep(step.id, current);
    if (!result.success) {
      setFieldErrors(result.fieldErrors);
      toast.error("Check the highlighted fields");
      return false;
    }
    try {
      await onboardingService.saveStep(step.id, current);
      setSavedLabel("Draft saved");
      setFieldErrors({});
      return true;
    } catch (error) {
      toast.error("Could not save this step", {
        description: error instanceof Error ? error.message : "Try again.",
      });
      return false;
    }
  }

  async function goNext() {
    if (editable && !(await saveCurrent())) return;
    setFieldErrors({});
    setStepIndex((index) => Math.min(index + 1, ONBOARDING_STEPS.length - 1));
  }

  const submit = useMutation({
    mutationFn: async () => {
      const current = form.getValues();
      const result = validateOnboardingStep("review", current);
      if (!result.success) {
        setFieldErrors(result.fieldErrors);
        throw new Error(result.fieldErrors["declaration"] ?? "Accept the declaration to submit.");
      }
      await onboardingService.submit(true);
    },
    onSuccess: async () => {
      toast.success("Profile submitted", {
        description: "HR will review it before you get full access.",
      });
      await queryClient.invalidateQueries({ queryKey: ["onboarding-draft"] });
      void navigate({ to: "/profile-status" });
    },
    onError: (error) =>
      toast.error("Could not submit", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  return (
    <AppLayout>
      <PageHeader
        eyebrow="Onboarding"
        title="Complete your profile"
        description="Your details are saved as you go. HR approves the profile before the rest of JeeVijay HRMS opens."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link to="/profile-status">Profile status</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void signOut().then(() => navigate({ to: "/sign-in" }));
              }}
            >
              Sign out
            </Button>
          </div>
        }
      />

      {draft.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading your draft…</p>
      ) : draft.isError ? (
        <ErrorState
          message={draft.error instanceof Error ? draft.error.message : undefined}
          onRetry={() => void draft.refetch()}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <ol className="surface-card h-fit space-y-1 p-3">
            {ONBOARDING_STEPS.map((item, index) => {
              const open = draft.data
                ? stepOpen(
                    draft.data.employmentStatus,
                    draft.data.submissionStatus,
                    draft.data.sectionFlags,
                    item.id,
                  )
                : false;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                      index === stepIndex ? "bg-muted font-medium" : "text-muted-foreground"
                    }`}
                    onClick={() => {
                      void (async () => {
                        if (editable && step.id !== "review") {
                          const current = withPermanentCopy(form.getValues());
                          if (validateOnboardingStep(step.id, current).success) {
                            await onboardingService
                              .saveStep(step.id, current)
                              .catch(() => undefined);
                            setSavedLabel("Draft saved");
                          }
                        }
                        setFieldErrors({});
                        setStepIndex(index);
                      })();
                    }}
                  >
                    <span className="grid size-6 place-items-center rounded-full border text-xs">
                      {index + 1}
                    </span>
                    <span className="truncate">{item.label}</span>
                    {draft.data?.submissionStatus === "changes_requested" &&
                    !open &&
                    item.id !== "review" ? (
                      <span className="ml-auto text-[10px] uppercase">Locked</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>

          <SectionCard
            title={step.label}
            description={
              editable
                ? savedLabel || "This step is saved on this device as soon as it is valid."
                : "This step is locked. Update only the sections HR sent back."
            }
            bodyClassName="space-y-4"
          >
            {draft.data?.remarks ? (
              <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                HR remarks: {draft.data.remarks}
                {draft.data.sectionFlags[step.id] ? ` ${draft.data.sectionFlags[step.id]}` : ""}
              </p>
            ) : null}
            {draft.data?.createdAt &&
            draft.data.submissionStatus === "draft" &&
            isStale(draft.data.createdAt) ? (
              <p className="text-sm text-muted-foreground">
                This profile has been incomplete for more than 30 days. Finish it so HR can review
                it.
              </p>
            ) : null}

            <fieldset
              disabled={!editable || upload.isPending}
              className="grid gap-4 disabled:opacity-70"
            >
              {step.id === "personal" ? (
                <PersonalFields
                  form={form}
                  errors={fieldErrors}
                  onPhoto={(file) => {
                    upload.mutate(
                      { file, folder: "photo", category: "Other" },
                      {
                        onSuccess: (path) => {
                          form.setValue("photoPath", path);
                          toast.success("Photo uploaded");
                        },
                      },
                    );
                  }}
                />
              ) : null}
              {step.id === "family" ? <FamilyFields form={form} errors={fieldErrors} /> : null}
              {step.id === "emergency" ? (
                <EmergencyFields form={form} errors={fieldErrors} />
              ) : null}
              {step.id === "addresses" ? <AddressFields form={form} errors={fieldErrors} /> : null}
              {step.id === "identity" ? (
                <IdentityFields
                  form={form}
                  errors={fieldErrors}
                  onFile={(kind, file) => {
                    upload.mutate(
                      { file, folder: "kyc", category: "Identity" },
                      {
                        onSuccess: (path) => {
                          const field =
                            kind === "pan"
                              ? "panDocumentPath"
                              : kind === "aadhaar"
                                ? "aadhaarDocumentPath"
                                : "passportDocumentPath";
                          form.setValue(field, path);
                          toast.success("Document uploaded");
                        },
                      },
                    );
                  }}
                />
              ) : null}
              {step.id === "education" ? (
                <EducationFields form={form} errors={fieldErrors} />
              ) : null}
              {step.id === "bank" ? (
                <BankFields
                  form={form}
                  errors={fieldErrors}
                  onCheque={(file) => {
                    upload.mutate(
                      { file, folder: "bank", category: "Bank" },
                      {
                        onSuccess: (path) => {
                          form.setValue("cancelledChequePath", path);
                          toast.success("Cancelled cheque uploaded");
                        },
                      },
                    );
                  }}
                />
              ) : null}
              {step.id === "review" ? (
                <Review
                  values={form.getValues()}
                  form={form}
                  errors={fieldErrors}
                  editable={editable}
                />
              ) : null}
            </fieldset>

            <div className="flex flex-wrap justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((index) => Math.max(index - 1, 0))}
              >
                Back
              </Button>
              {step.id === "review" ? (
                <Button
                  type="button"
                  disabled={!editable || submit.isPending}
                  onClick={() => submit.mutate()}
                >
                  {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Submit for HR review
                </Button>
              ) : (
                <Button type="button" onClick={() => void goNext()}>
                  Save and continue
                </Button>
              )}
            </div>
          </SectionCard>
        </div>
      )}
      <ChangePasswordForm />
    </AppLayout>
  );
}

function isStale(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() > 30 * 24 * 60 * 60 * 1000;
}

function withPermanentCopy(values: OnboardingFormValues): OnboardingFormValues {
  if (!values.permanentAddress.sameAsCurrent) return values;
  return {
    ...values,
    permanentAddress: {
      ...values.currentAddress,
      yearsAtAddress: "",
      sameAsCurrent: true,
    },
  };
}

function Hint({ message }: { message?: string | undefined }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

function PersonalFields({
  form,
  errors,
  onPhoto,
}: {
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
  errors: Record<string, string>;
  onPhoto: (file: File) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="firstName">First name</Label>
        <Input id="firstName" {...form.register("firstName")} />
        <Hint message={errors["firstName"]} />
      </div>
      <div>
        <Label htmlFor="middleName">Middle name</Label>
        <Input id="middleName" {...form.register("middleName")} />
      </div>
      <div>
        <Label htmlFor="lastName">Last name</Label>
        <Input id="lastName" {...form.register("lastName")} />
        <Hint message={errors["lastName"]} />
      </div>
      <div>
        <Label htmlFor="dateOfBirth">Date of birth</Label>
        <Input
          id="dateOfBirth"
          type="date"
          max={latestAdultDob()}
          {...form.register("dateOfBirth")}
        />
        <Hint message={errors["dateOfBirth"]} />
      </div>
      <div>
        <Label htmlFor="gender">Gender</Label>
        <select id="gender" className={selectClass} {...form.register("gender")}>
          <option value="">Select</option>
          {GENDERS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <Hint message={errors["gender"]} />
      </div>
      <div>
        <Label htmlFor="bloodGroup">Blood group</Label>
        <select id="bloodGroup" className={selectClass} {...form.register("bloodGroup")}>
          <option value="">Select</option>
          {BLOOD_GROUPS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <Hint message={errors["bloodGroup"]} />
      </div>
      <div>
        <Label htmlFor="maritalStatus">Marital status</Label>
        <select id="maritalStatus" className={selectClass} {...form.register("maritalStatus")}>
          <option value="">Select</option>
          {MARITAL_STATUSES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <Hint message={errors["maritalStatus"]} />
      </div>
      <div>
        <Label htmlFor="nationality">Nationality</Label>
        <Input id="nationality" {...form.register("nationality")} />
        <Hint message={errors["nationality"]} />
      </div>
      <div>
        <Label htmlFor="phone">Mobile (+91)</Label>
        <MobileInput id="phone" placeholder="10-digit mobile" {...form.register("phone")} />
        <Hint message={errors["phone"]} />
      </div>
      <div>
        <Label htmlFor="alternatePhone">Alternate mobile</Label>
        <MobileInput id="alternatePhone" {...form.register("alternatePhone")} />
        <Hint message={errors["alternatePhone"]} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="personalEmail">Personal email</Label>
        <Input id="personalEmail" type="email" {...form.register("personalEmail")} />
        <Hint message={errors["personalEmail"]} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="photo">Photo</Label>
        <Input
          id="photo"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPhoto(file);
          }}
        />
        {form.watch("photoPath") ? (
          <p className="mt-1 text-xs text-muted-foreground">Photo uploaded.</p>
        ) : null}
      </div>
    </div>
  );
}

function FamilyFields({
  form,
  errors,
}: {
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
  errors: Record<string, string>;
}) {
  const married = form.watch("maritalStatus") === "Married";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="fatherName">Father&apos;s name</Label>
        <Input id="fatherName" {...form.register("fatherName")} />
        <Hint message={errors["fatherName"]} />
      </div>
      <div>
        <Label htmlFor="fatherPhone">Father&apos;s mobile</Label>
        <MobileInput id="fatherPhone" {...form.register("fatherPhone")} />
        <Hint message={errors["fatherPhone"]} />
      </div>
      <div>
        <Label htmlFor="motherName">Mother&apos;s name</Label>
        <Input id="motherName" {...form.register("motherName")} />
        <Hint message={errors["motherName"]} />
      </div>
      <div>
        <Label htmlFor="motherPhone">Mother&apos;s mobile</Label>
        <MobileInput id="motherPhone" {...form.register("motherPhone")} />
        <Hint message={errors["motherPhone"]} />
      </div>
      {married ? (
        <>
          <div>
            <Label htmlFor="spouseName">Spouse name</Label>
            <Input id="spouseName" {...form.register("spouseName")} />
            <Hint message={errors["spouseName"]} />
          </div>
          <div>
            <Label htmlFor="spousePhone">Spouse mobile</Label>
            <MobileInput id="spousePhone" {...form.register("spousePhone")} />
            <Hint message={errors["spousePhone"]} />
          </div>
        </>
      ) : null}
      <div>
        <Label htmlFor="dependents">Number of dependents</Label>
        <Input id="dependents" inputMode="numeric" {...form.register("dependents")} />
        <Hint message={errors["dependents"]} />
      </div>
    </div>
  );
}

function EmergencyFields({
  form,
  errors,
}: {
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
  errors: Record<string, string>;
}) {
  const contacts = form.watch("emergency");
  return (
    <div className="space-y-4">
      {contacts.map((_, index) => (
        <div key={index} className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>Name</Label>
            <Input {...form.register(`emergency.${index}.name`)} />
            <Hint message={errors[`emergency.${index}.name`]} />
          </div>
          <div>
            <Label>Relation</Label>
            <Input {...form.register(`emergency.${index}.relationship`)} />
            <Hint message={errors[`emergency.${index}.relationship`]} />
          </div>
          <div>
            <Label>Mobile</Label>
            <MobileInput {...form.register(`emergency.${index}.phone`)} />
            <Hint message={errors[`emergency.${index}.phone`]} />
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={contacts.length >= 3}
          onClick={() =>
            form.setValue("emergency", [...contacts, { name: "", relationship: "", phone: "" }])
          }
        >
          Add contact
        </Button>
        {contacts.length > 1 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => form.setValue("emergency", contacts.slice(0, -1))}
          >
            Remove last
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function AddressFields({
  form,
  errors,
}: {
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
  errors: Record<string, string>;
}) {
  const same = form.watch("permanentAddress.sameAsCurrent");
  return (
    <div className="space-y-6">
      <AddressBlock
        title="Current address"
        prefix="currentAddress"
        form={form}
        errors={errors}
        showYears
      />
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={same}
          onCheckedChange={(checked) => {
            const on = checked === true;
            form.setValue("permanentAddress.sameAsCurrent", on);
            if (on)
              form.setValue("permanentAddress", {
                ...form.getValues("currentAddress"),
                sameAsCurrent: true,
                yearsAtAddress: "",
              });
          }}
        />
        Permanent address is the same as current
      </label>
      {same ? null : (
        <AddressBlock
          title="Permanent address"
          prefix="permanentAddress"
          form={form}
          errors={errors}
        />
      )}
    </div>
  );
}

function AddressBlock({
  title,
  prefix,
  form,
  errors,
  showYears,
}: {
  title: string;
  prefix: "currentAddress" | "permanentAddress";
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
  errors: Record<string, string>;
  showYears?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <h3 className="sm:col-span-2 text-sm font-medium">{title}</h3>
      <div className="sm:col-span-2">
        <Label>Address line 1</Label>
        <Input {...form.register(`${prefix}.addressLine1`)} />
        <Hint message={errors[`${prefix}.addressLine1`]} />
      </div>
      <div className="sm:col-span-2">
        <Label>Address line 2</Label>
        <Input {...form.register(`${prefix}.addressLine2`)} />
      </div>
      <div>
        <Label>City</Label>
        <Input {...form.register(`${prefix}.city`)} />
        <Hint message={errors[`${prefix}.city`]} />
      </div>
      <div>
        <Label>State</Label>
        <select className={selectClass} {...form.register(`${prefix}.state`)}>
          <option value="">Select state</option>
          {INDIAN_STATES.map((state) => (
            <option key={state}>{state}</option>
          ))}
        </select>
        <Hint message={errors[`${prefix}.state`]} />
      </div>
      <div>
        <Label>PIN code</Label>
        <Input
          inputMode="numeric"
          maxLength={6}
          value={form.watch(`${prefix}.postalCode`)}
          onChange={(event) =>
            form.setValue(`${prefix}.postalCode`, digitsOnly(event.target.value).slice(0, 6))
          }
        />
        <Hint message={errors[`${prefix}.postalCode`]} />
      </div>
      <div>
        <Label>Country</Label>
        <Input {...form.register(`${prefix}.country`)} />
      </div>
      {showYears ? (
        <div>
          <Label>Years at this address</Label>
          <Input inputMode="decimal" {...form.register(`${prefix}.yearsAtAddress`)} />
          <Hint message={errors[`${prefix}.yearsAtAddress`]} />
        </div>
      ) : null}
    </div>
  );
}

function IdentityFields({
  form,
  errors,
  onFile,
}: {
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
  errors: Record<string, string>;
  onFile: (kind: "pan" | "aadhaar" | "passport", file: File) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="pan">PAN</Label>
        <Input id="pan" className="uppercase" placeholder="ABCDE1234F" {...form.register("pan")} />
        <Hint message={errors["pan"]} />
      </div>
      <div>
        <Label htmlFor="panFile">PAN upload</Label>
        <Input
          id="panFile"
          type="file"
          accept="image/*,.pdf"
          onChange={(event) => event.target.files?.[0] && onFile("pan", event.target.files[0])}
        />
        <Hint message={errors["panDocumentPath"]} />
      </div>
      <div>
        <Label htmlFor="aadhaar">Aadhaar</Label>
        <Input
          id="aadhaar"
          inputMode="numeric"
          placeholder="12 digits, only last 4 are stored"
          {...form.register("aadhaar")}
        />
        <Hint message={errors["aadhaar"]} />
      </div>
      <div>
        <Label htmlFor="aadhaarFile">Aadhaar upload</Label>
        <Input
          id="aadhaarFile"
          type="file"
          accept="image/*,.pdf"
          onChange={(event) => event.target.files?.[0] && onFile("aadhaar", event.target.files[0])}
        />
        <Hint message={errors["aadhaarDocumentPath"]} />
      </div>
      <div>
        <Label htmlFor="passport">Passport (optional)</Label>
        <Input id="passport" {...form.register("passport")} />
        <Hint message={errors["passport"]} />
      </div>
      <div>
        <Label htmlFor="passportFile">Passport upload</Label>
        <Input
          id="passportFile"
          type="file"
          accept="image/*,.pdf"
          onChange={(event) => event.target.files?.[0] && onFile("passport", event.target.files[0])}
        />
      </div>
    </div>
  );
}

function EducationFields({
  form,
  errors,
}: {
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
  errors: Record<string, string>;
}) {
  const experience = form.watch("experience");
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Highest qualification</Label>
          <Input {...form.register("qualification")} />
          <Hint message={errors["qualification"]} />
        </div>
        <div>
          <Label>Institute</Label>
          <Input {...form.register("institute")} />
          <Hint message={errors["institute"]} />
        </div>
        <div>
          <Label>Year</Label>
          <Input inputMode="numeric" maxLength={4} {...form.register("educationYear")} />
          <Hint message={errors["educationYear"]} />
        </div>
      </div>
      <div>
        <Label htmlFor="uan">UAN (optional)</Label>
        <Input id="uan" inputMode="numeric" maxLength={12} {...form.register("uan")} />
        <Hint message={errors["uan"]} />
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Previous employment</h3>
        {experience.map((_, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Company</Label>
              <Input {...form.register(`experience.${index}.company`)} />
              <Hint message={errors[`experience.${index}.company`]} />
            </div>
            <div>
              <Label>Role</Label>
              <Input {...form.register(`experience.${index}.roleTitle`)} />
              <Hint message={errors[`experience.${index}.roleTitle`]} />
            </div>
            <div>
              <Label>From</Label>
              <Input type="date" {...form.register(`experience.${index}.fromDate`)} />
              <Hint message={errors[`experience.${index}.fromDate`]} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" {...form.register(`experience.${index}.toDate`)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Reason for leaving</Label>
              <Input {...form.register(`experience.${index}.reasonForLeaving`)} />
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            form.setValue("experience", [
              ...experience,
              { company: "", roleTitle: "", fromDate: "", toDate: "", reasonForLeaving: "" },
            ])
          }
        >
          Add employer
        </Button>
      </div>
    </div>
  );
}

function BankFields({
  form,
  errors,
  onCheque,
}: {
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
  errors: Record<string, string>;
  onCheque: (file: File) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label>Account holder</Label>
        <Input {...form.register("accountName")} />
        <Hint message={errors["accountName"]} />
      </div>
      <div>
        <Label>Bank</Label>
        <Input {...form.register("bankName")} />
        <Hint message={errors["bankName"]} />
      </div>
      <div>
        <Label>Account number</Label>
        <Input
          inputMode="numeric"
          autoComplete="off"
          maxLength={18}
          value={form.watch("accountNumber")}
          onChange={(event) =>
            form.setValue("accountNumber", digitsOnly(event.target.value).slice(0, 18))
          }
        />
        <Hint message={errors["accountNumber"]} />
      </div>
      <div>
        <Label>Confirm account number</Label>
        <Input
          inputMode="numeric"
          autoComplete="off"
          maxLength={18}
          value={form.watch("accountNumberConfirm")}
          onChange={(event) =>
            form.setValue("accountNumberConfirm", digitsOnly(event.target.value).slice(0, 18))
          }
        />
        <Hint message={errors["accountNumberConfirm"]} />
      </div>
      <div>
        <Label>IFSC</Label>
        <Input
          className="uppercase"
          placeholder="HDFC0001234"
          maxLength={11}
          value={form.watch("ifsc")}
          onChange={(event) => form.setValue("ifsc", formatIfscInput(event.target.value))}
        />
        <Hint message={errors["ifsc"]} />
      </div>
      <div>
        <Label>Branch</Label>
        <Input {...form.register("branch")} />
        <Hint message={errors["branch"]} />
      </div>
      <div className="sm:col-span-2">
        <Label>Cancelled cheque</Label>
        <Input
          type="file"
          accept="image/*,.pdf"
          onChange={(event) => event.target.files?.[0] && onCheque(event.target.files[0])}
        />
        <Hint message={errors["cancelledChequePath"]} />
        {form.watch("cancelledChequePath") ? (
          <p className="mt-1 text-xs text-muted-foreground">Cheque uploaded.</p>
        ) : null}
      </div>
    </div>
  );
}

function Review({
  values,
  form,
  errors,
  editable,
}: {
  values: OnboardingFormValues;
  form: ReturnType<typeof useForm<OnboardingFormValues>>;
  errors: Record<string, string>;
  editable: boolean;
}) {
  const rows = [
    ["Name", [values.firstName, values.middleName, values.lastName].filter(Boolean).join(" ")],
    ["Date of birth", values.dateOfBirth],
    ["Mobile", values.phone],
    ["Personal email", values.personalEmail],
    ["PAN", values.pan.toUpperCase()],
    [
      "Aadhaar",
      values.aadhaarOnFile && !values.aadhaar.replace(/\D/g, "").length
        ? "Last 4 on file"
        : "Last 4 will be stored",
    ],
    ["Bank", values.bankName],
    ["IFSC", values.ifsc.toUpperCase()],
  ];
  return (
    <div className="space-y-4">
      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm">{value || "—"}</dd>
          </div>
        ))}
      </dl>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={form.watch("declaration")}
          disabled={!editable}
          onCheckedChange={(checked) => form.setValue("declaration", checked === true)}
        />
        <span>
          I confirm that the details and documents I submitted are true, and I understand that HR
          must approve this profile before I can use the rest of JeeVijay HRMS.
        </span>
      </label>
      <Hint message={errors["declaration"]} />
    </div>
  );
}
