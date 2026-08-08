/**
 * Small, dependency-free validation helpers. Business-rule validation
 * (e.g. link slug rules) belongs in feature modules, not here — this
 * file is limited to generic, reusable primitives.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value);
}

export function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Basic password strength check: 8+ chars, upper, lower, number. */
export function isStrongPassword(value: string): boolean {
  return (
    value.length >= 8 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value)
  );
}
