// Client-side checks mirroring the LOCKED contract (A-14 adopted). The server stays the authority;
// these only save a round trip. Each validator returns { field: message } (empty object = valid).

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const USERNAME_RE = /^[a-z0-9_.]+$/;

/**
 * CONTRACT QUESTION (Q1): the contract says usernames are "stored lowercase" and matched
 * case-insensitively, but not whether signup should *reject* uppercase input or *accept and
 * lowercase* it. Until the contract says, the web client lowercases (and trims) before validating and
 * sending, so "Alice" is sent as "alice". Change only this function if the answer is "reject".
 */
export function normalizeSignupUsername(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

/** Contract: emails are trimmed and lowercased. */
export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export function validateUsername(username) {
  if (!username) return 'Username is required.';
  if (username.includes('@')) return 'Username cannot contain "@".';
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX)
    return `Username must be ${USERNAME_MIN}–${USERNAME_MAX} characters.`;
  if (!USERNAME_RE.test(username)) return 'Username may only use a–z, 0–9, "_" and ".".';
  return null;
}

/**
 * CONTRACT QUESTION (Q2): the contract does not define an email format rule beyond trim +
 * lowercase + unique. The client only checks for a minimal "something@something" shape and
 * leaves stricter checks to the server's VALIDATION_ERROR.
 */
export function validateEmail(email) {
  if (!email) return 'Email is required.';
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  return null;
}

/** Contract: 8–128 chars. Measured on the raw string (passwords are never trimmed). */
export function validatePassword(password) {
  if (!password) return 'Password is required.';
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)
    return `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters.`;
  return null;
}

export function validateSignup({ email, username, password }) {
  const errors = {};
  const e = validateEmail(email);
  const u = validateUsername(username);
  const p = validatePassword(password);
  if (e) errors.email = e;
  if (u) errors.username = u;
  if (p) errors.password = p;
  return errors;
}

/**
 * Login: identifier containing "@" is an email, anything else a username (A-14).
 * Only presence is checked here; a malformed identifier just gets INVALID_CREDENTIALS from the
 * server, which avoids telling the user which rule an existing account would have failed.
 */
export function validateLogin({ identifier, password }) {
  const errors = {};
  if (!identifier) errors.identifier = 'Enter your email or username.';
  if (!password) errors.password = 'Password is required.';
  return errors;
}

/** The login identifier is trimmed; an email-looking one is lowercased (emails are stored lowercase). */
export function normalizeIdentifier(raw) {
  const v = String(raw ?? '').trim();
  return v.includes('@') ? v.toLowerCase() : v;
}

/**
 * Map a server ApiError to form errors. Uses error.field when the server sends it; for 409 codes
 * without a field, infers it from the code. Anything else becomes a form-level error (`_form`).
 */
const CODE_TO_FIELD = { EMAIL_TAKEN: 'email', USERNAME_TAKEN: 'username' };
export function serverErrorToFormErrors(err, knownFields) {
  const field = err?.field || CODE_TO_FIELD[err?.code];
  const message = err?.message || 'Something went wrong.';
  if (field && knownFields.includes(field)) return { [field]: message };
  return { _form: message };
}
