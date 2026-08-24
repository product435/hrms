/**
 * Defensive email normalization for anything that gets sent to Supabase Auth
 * (sign in, sign up, password reset). Strips accidental markdown-link
 * formatting or a leading "mailto:" -- the shape you'd get if a value was
 * pasted from a source that rendered the address as a link, e.g.
 * "[user@x.com](mailto:user@x.com)" -- and surrounding quotes, so only the
 * raw address ever reaches Supabase.
 */
export function sanitizeEmail(raw: string): string {
  let value = raw.trim();
  const markdownLink = /^\[(.+?)\]\(\s*mailto:(.+?)\s*\)$/i.exec(value);
  if (markdownLink) value = markdownLink[1] || markdownLink[2] || value;
  value = value.replace(/^mailto:/i, "");
  value = value.replace(/^["'<]+|["'>]+$/g, "");
  return value.trim();
}

const EMAIL_PATTERN = /^[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}
