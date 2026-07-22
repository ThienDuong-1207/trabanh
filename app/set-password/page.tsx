"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { validatePassword } from "@/lib/passwordPolicy";
import PasswordChecklist from "@/components/PasswordChecklist";

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const ruleError = validatePassword(password);
    if (ruleError) {
      setError(`Mật khẩu chưa đạt yêu cầu: ${ruleError}`);
      return;
    }
    if (password !== confirm) {
      setError("Hai mật khẩu nhập lại không khớp.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    await fetch("/api/users/complete-password-setup", { method: "POST" });
    window.location.assign("/");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Đặt mật khẩu mới</h1>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 6, maxWidth: 320 }}>
          Đây là lần đăng nhập đầu tiên bằng mật khẩu tạm — hãy đặt một mật khẩu mới trước khi tiếp tục.
        </p>
      </div>

      <form className="login-password-form" onSubmit={submit} style={{ width: 280 }}>
        <input
          type="password"
          placeholder="Mật khẩu mới"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="Nhập lại mật khẩu mới"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <PasswordChecklist password={password} />
        {error && <p className="login-error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? "Đang lưu..." : "Đặt mật khẩu"}
        </button>
      </form>
    </div>
  );
}
