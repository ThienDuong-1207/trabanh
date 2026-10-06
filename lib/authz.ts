import { NextResponse } from "next/server";
import { createServerSupabase } from "./supabaseServerClient";

// `role` = quyền truy cập. `staff` là nhân viên thường (shipper, kho...);
// chức vụ cụ thể lưu ở profiles.chuc_danh, không nằm trong role.
export type Role = "sales" | "accountant" | "admin" | "staff";

// Returns the signed-in user's id + assigned role, or null if not signed in
// / not yet assigned a role. Kept as a single nullable return (rather than a
// discriminated union) because this project's tsconfig has strict: false,
// under which TS doesn't reliably narrow a union on a boolean literal
// discriminant.
export async function getCurrentUserRole(): Promise<{
  userId: string;
  role: Role;
  displayName: string | null;
  chucDanh: string | null;
} | null> {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, chuc_danh")
    .eq("id", user.id)
    .single();
  const role = profile?.role as Role | null | undefined;
  if (!role) return null;

  return {
    userId: user.id,
    role,
    displayName: profile?.display_name ?? null,
    chucDanh: profile?.chuc_danh ?? null,
  };
}

// API routes here use supabaseAdmin() (service-role key) to actually perform
// their writes, which bypasses RLS entirely — so the RLS role policies on
// `products` never see these requests. This checks who's calling and what
// their role is *before* the route is allowed to reach for the admin client.
//
// Returns null when authorized (caller proceeds); otherwise the NextResponse
// to return immediately.
export async function requireRole(allowedRoles: Role[]): Promise<NextResponse | null> {
  const current = await getCurrentUserRole();
  if (!current) {
    return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  }
  // Admin là vai trò cao nhất: luôn qua mọi kiểm tra, không cần liệt kê riêng
  // ở từng route.
  if (current.role !== "admin" && !allowedRoles.includes(current.role)) {
    return NextResponse.json({ error: "Bạn không có quyền thực hiện thao tác này" }, { status: 403 });
  }
  return null;
}
