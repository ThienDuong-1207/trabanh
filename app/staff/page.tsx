import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabaseServerClient";
import StaffClient from "./StaffClient";

// Trang rút gọn cho role "staff" — tách khỏi "/" (khung đầy đủ dành cho
// sales/accountant/admin), giống đúng mô hình /admin/sale của tra-banh-shop.
// Admin được phép ghé xem thử (nút "Quay lại trang Admin" trong StaffClient).
export default async function StaffPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, display_name, username, chuc_danh, must_change_password")
    .eq("id", user.id)
    .single();

  if (profile?.must_change_password) redirect("/set-password");
  if (profile?.role !== "staff" && profile?.role !== "admin") redirect("/");

  return (
    <StaffClient
      displayName={profile.display_name || user.email || ""}
      username={profile.username}
      chucDanh={profile.chuc_danh}
      role={profile.role}
      userId={user.id}
    />
  );
}
