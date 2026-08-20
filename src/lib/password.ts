export const PASSWORD_REQUIREMENTS = [
  { key: "length", label: "8+ characters", test: (value: string) => value.length >= 8 },
  { key: "upper", label: "Uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { key: "lower", label: "Lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { key: "number", label: "Number", test: (value: string) => /\d/.test(value) },
  { key: "special", label: "Special character", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
] as const;

export function passwordChecks(value: string) {
  return PASSWORD_REQUIREMENTS.map((requirement) => ({
    ...requirement,
    met: requirement.test(value),
  }));
}

export function isStrongPassword(value: string) {
  return passwordChecks(value).every((requirement) => requirement.met);
}
