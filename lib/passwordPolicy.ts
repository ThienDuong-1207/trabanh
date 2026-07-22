export type PasswordRule = {
  label: string;
  test: (pw: string) => boolean;
};

export const PASSWORD_RULES: PasswordRule[] = [
  { label: "Ít nhất 8 ký tự", test: (pw) => pw.length >= 8 },
  { label: "Ký tự đầu tiên viết hoa", test: (pw) => /^[A-Z]/.test(pw) },
  { label: "Có cả chữ và số", test: (pw) => /[a-zA-Z]/.test(pw) && /\d/.test(pw) },
  { label: "Có ít nhất 1 ký tự đặc biệt", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

// Returns the first failing rule's message, or null if the password satisfies
// every rule.
export function validatePassword(pw: string): string | null {
  const failed = PASSWORD_RULES.find((rule) => !rule.test(pw));
  return failed ? failed.label : null;
}
