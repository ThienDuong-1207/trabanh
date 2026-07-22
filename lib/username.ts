// Supabase Auth requires an email for email/password sign-in. Usernames here
// never correspond to a real mailbox — this domain is never sent to and
// exists only so auth.users.email stays a syntactically valid, unique value.
const INTERNAL_EMAIL_DOMAIN = "tiembanh.local";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
}

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username.trim().toLowerCase());
}
