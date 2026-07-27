/**
 * Password policy enforced in code, mirroring the Firebase Auth console policy:
 *   - minimum 8 characters
 *   - at least one uppercase character
 *   - at least one lowercase character
 *   - at least one numeric character
 *   - at least one special character
 *
 * Firebase's Identity Platform password policy is only reliably enforced when
 * the client validates it, so this is the single source of truth used by every
 * password-setting flow (sign up, password reset, link/set password).
 */

export const PASSWORD_MIN_LENGTH = 8;

/** Special = anything that is not a letter or a digit. */
const SPECIAL_CHAR = /[^A-Za-z0-9]/;

/**
 * Validate a password against the policy.
 * @returns a Greek error message if invalid, or `null` if the password passes.
 */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Ο κωδικός πρέπει να έχει τουλάχιστον ${PASSWORD_MIN_LENGTH} χαρακτήρες`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'Ο κωδικός πρέπει να περιέχει τουλάχιστον ένα κεφαλαίο γράμμα';
  }
  if (!/[a-z]/.test(password)) {
    return 'Ο κωδικός πρέπει να περιέχει τουλάχιστον ένα πεζό γράμμα';
  }
  if (!/[0-9]/.test(password)) {
    return 'Ο κωδικός πρέπει να περιέχει τουλάχιστον έναν αριθμό';
  }
  if (!SPECIAL_CHAR.test(password)) {
    return 'Ο κωδικός πρέπει να περιέχει τουλάχιστον έναν ειδικό χαρακτήρα';
  }
  return null;
}

/** Convenience boolean check. */
export function isPasswordValid(password: string): boolean {
  return validatePassword(password) === null;
}

/** Short human-readable summary of the requirements, for hints/placeholders. */
export const PASSWORD_REQUIREMENTS_HINT =
  'Τουλάχιστον 8 χαρακτήρες, με κεφαλαίο, πεζό, αριθμό και ειδικό χαρακτήρα';
