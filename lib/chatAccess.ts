import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "./authz";

// Admin/Kế toán ("văn phòng") thấy toàn bộ hội thoại; Sales/Staff chỉ thấy
// hội thoại đã được admin gán cho mình (bảng conversation_assignments) —
// đúng mô hình RLS đã viết trong supabase/schema.sql "Giai đoạn 11", lặp lại
// ở đây vì các route dùng supabaseAdmin() (service role, bỏ qua RLS) để còn
// join được tag/người được gán trong 1 lần gọi.
export function isOfficeRole(role: Role): boolean {
  return role === "admin" || role === "accountant";
}

export async function canAccessConversation(
  supabase: SupabaseClient,
  userId: string,
  role: Role,
  conversationId: string,
): Promise<boolean> {
  if (isOfficeRole(role)) return true;
  const { data } = await supabase
    .from("conversation_assignments")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
