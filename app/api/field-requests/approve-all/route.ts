import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { applyFieldRequestDecision } from "@/lib/productFieldRequests";

export const runtime = "nodejs";

// Kế toán/Admin duyệt toàn bộ đề xuất Mã vạch/Mã thùng đang "pending" trong 1
// lần bấm — mirror app/api/price-requests/approve-all/route.ts. Mỗi đề xuất
// được kiểm tra lại xung đột ngay trước khi ghi (applyFieldRequestDecision),
// nên 1 đề xuất vẫn còn trùng tại thời điểm duyệt sẽ rơi vào "failed" thay vì
// làm hỏng cả lượt duyệt hàng loạt.
export async function POST() {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "accountant" && current.role !== "admin") {
    return NextResponse.json({ error: "Chỉ Kế toán/Admin mới duyệt được đề xuất Mã vạch/Mã thùng" }, { status: 403 });
  }

  try {
    const supabase = supabaseAdmin();
    const { data: pending, error } = await supabase
      .from("product_field_requests")
      .select("*, product:products(ten_hang_hoa, ma_noi_bo), proposer:profiles!product_field_requests_proposed_by_fkey(display_name, username)")
      .eq("status", "pending");
    if (error) throw error;

    let succeeded = 0;
    const failed: { id: string; error: string }[] = [];
    for (const request of pending ?? []) {
      try {
        await applyFieldRequestDecision(supabase, request, "approve", current, null);
        succeeded++;
      } catch (e: any) {
        failed.push({ id: request.id, error: e.message });
      }
    }

    return NextResponse.json({ succeeded, failed });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
