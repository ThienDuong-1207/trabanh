"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Role } from "@/lib/authz";
import AttendanceClient from "@/app/attendance/AttendanceClient";
import StaffProductsView from "@/app/views/StaffProductsView";
import ChatView from "@/app/views/ChatView";

type StaffTab = "diemdanh" | "hanghoa" | "chat" | "thongtin";

const ROLE_LABEL: Record<Role, string> = { sales: "Sales", accountant: "Kế toán", admin: "Admin", staff: "Nhân viên" };

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41 13.42 20.6a2 2 0 0 1-2.83 0L3 13v-3a2 2 0 0 1 2-2h4l7.59 7.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7.5" cy="9.5" r="1" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 20l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  );
}
function ArrowLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

// Trang rút gọn cho role staff (route /staff) — chỉ 4 chức năng: Điểm danh,
// Hàng hóa (chỉ xem), Chat khách hàng, Thông tin cá nhân. Admin được phép
// ghé xem thử (nút "Quay lại trang Admin"), xem app/staff/page.tsx.
export default function StaffClient({
  displayName,
  username,
  chucDanh,
  role,
  userId,
}: {
  displayName: string;
  username: string | null;
  chucDanh: string | null;
  role: Role;
  userId: string;
}) {
  const [tab, setTab] = useState<StaffTab>("diemdanh");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  function go(t: StaffTab) {
    setTab(t);
    setMobileNavOpen(false);
  }

  return (
    <div className="shell">
      <nav className={`sidebar${mobileNavOpen ? " mobile-open" : ""}`}>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/templates/logo.png" alt="Trà & Bánh" />
          <div className="brand-text-under">Nhân viên</div>
          <button
            className="sidebar-mobile-toggle"
            aria-label={mobileNavOpen ? "Đóng menu" : "Mở menu"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            <MenuIcon />
          </button>
        </div>
        {mobileNavOpen && <div className="sidebar-backdrop" onClick={() => setMobileNavOpen(false)} />}
        <div className="nav">
          {role === "admin" && (
            <a className="nav-item" href="/">
              <ArrowLeftIcon />
              Quay lại trang Admin
            </a>
          )}
          <button className={`nav-item${tab === "diemdanh" ? " active" : ""}`} onClick={() => go("diemdanh")}>
            <ClockIcon />
            Điểm danh
          </button>
          <button className={`nav-item${tab === "hanghoa" ? " active" : ""}`} onClick={() => go("hanghoa")}>
            <TagIcon />
            Hàng hóa
          </button>
          <button className={`nav-item${tab === "chat" ? " active" : ""}`} onClick={() => go("chat")}>
            <ChatIcon />
            Chat khách hàng
          </button>
          <button className={`nav-item${tab === "thongtin" ? " active" : ""}`} onClick={() => go("thongtin")}>
            <UserIcon />
            Thông tin
          </button>
        </div>
        <div className="sidebar-foot sidebar-account">
          <div className="sidebar-account-name">{displayName}</div>
          <div className="sidebar-account-role">{ROLE_LABEL[role]}{chucDanh ? ` · ${chucDanh}` : ""}</div>
          <button className="btn btn-quiet sidebar-signout" onClick={signOut}>
            Đăng xuất
          </button>
        </div>
      </nav>
      <main className="main">
        <div style={{ padding: "16px 13px" }}>
          {tab === "diemdanh" && <AttendanceClient displayName={displayName} chucDanh={chucDanh} embedded />}
          {tab === "hanghoa" && <StaffProductsView />}
          {tab === "chat" && <ChatView role={role} userId={userId} />}
          {tab === "thongtin" && (
            <div className="app">
              <header className="app-header">
                <div className="app-header-title">
                  <h1>Thông tin</h1>
                </div>
              </header>
              <section className="panel" style={{ display: "grid", gap: 8 }}>
                <div>
                  <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>Họ tên</div>
                  <div>{displayName}</div>
                </div>
                <div>
                  <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>Tên đăng nhập</div>
                  <div>{username ?? "—"}</div>
                </div>
                <div>
                  <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>Vai trò</div>
                  <div>{ROLE_LABEL[role]}</div>
                </div>
                <div>
                  <div style={{ color: "var(--muted)", fontSize: "var(--text-micro)" }}>Chức danh</div>
                  <div>{chucDanh ?? "Chưa đặt"}</div>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
