"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { usernameToEmail } from "@/lib/username";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function signInGoogle() {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) return;
    setSigningIn(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    if (error) {
      setError("Sai tên đăng nhập hoặc mật khẩu.");
      setSigningIn(false);
      return;
    }
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
        gap: 24,
        background: "var(--bg)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/templates/logo.png" alt="Trà & Bánh" style={{ width: 208, borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-1)" }} />
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Quản lý giá sản phẩm</h1>
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 6 }}>Đăng nhập để tiếp tục.</p>
      </div>

      <button className="btn btn-primary" disabled={loading} onClick={signInGoogle}>
        {loading ? "Đang chuyển hướng..." : "Đăng nhập bằng Google"}
      </button>

      <div className="login-divider">hoặc</div>

      <form className="login-password-form" onSubmit={signInPassword}>
        <input
          placeholder="Tên đăng nhập"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Mật khẩu"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="login-error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={signingIn}>
          {signingIn ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
