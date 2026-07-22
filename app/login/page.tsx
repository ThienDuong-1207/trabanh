"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
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
        <p style={{ color: "var(--muted)", fontSize: 13.5, marginTop: 6 }}>Đăng nhập bằng tài khoản Google được cấp quyền để tiếp tục.</p>
      </div>
      <button className="btn btn-primary solid-primary" disabled={loading} onClick={signIn}>
        {loading ? "Đang chuyển hướng..." : "Đăng nhập bằng Google"}
      </button>
    </div>
  );
}
