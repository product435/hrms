/**
 * Shared name normalization for grouping records that represent the same
 * real-world entity (a department, a designation, ...) despite differing in
 * whitespace or letter case across duplicate database rows. Used identically
 * everywhere aggregation matters -- dashboard, departments, reports,
 * dropdown filters -- so the same "QA " / "qa" / "QA" never gets counted as
 * three different departments in one place and one in another.
 */
export function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Canonical on-screen form of a name: trimmed, casing preserved as entered. */
export function displayName(value: string | null | undefined): string {
  return (value ?? "").trim();
}
