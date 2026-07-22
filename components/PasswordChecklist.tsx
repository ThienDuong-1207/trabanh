"use client";

import { PASSWORD_RULES } from "@/lib/passwordPolicy";

export default function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="password-checklist">
      {PASSWORD_RULES.map((rule) => {
        const ok = rule.test(password);
        return (
          <li key={rule.label} className={ok ? "ok" : ""}>
            <span className="mark">{ok ? "✓" : "○"}</span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
