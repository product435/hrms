export const HOW_LEAVE_WORKS =
  "At most 2 leave days are allowed in a calendar month, no matter the type. Casual, Earned, and Sick yearly allocations still apply on top of that monthly cap. The balance resets each calendar year.";

export function leaveTypeHint(name: string) {
  const key = name.trim().toLowerCase();
  if (key.includes("casual")) {
    return "Casual leave is for planned personal time. Its yearly allocation still applies, and the balance resets each calendar year.";
  }
  if (key.includes("earned")) {
    return "Earned leave is the yearly earned allocation. That yearly limit still applies, and the balance resets each calendar year.";
  }
  if (key.includes("sick")) {
    return "Sick leave is for illness. Its yearly allocation still applies, and the balance resets each calendar year.";
  }
  return "This type keeps its own yearly allocation, and the balance resets each calendar year. At most 2 leave days are allowed in a calendar month across every type.";
}
