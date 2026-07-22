import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { applyPriceRequestDecision } from "@/lib/priceRequests";

export const runtime = "nodejs";

// Kế toán/Admin duyệt toàn bộ đề xuất giá đang "pending" trong 1 lần bấm —
// áp dụng từng đề xuất bằng đúng logic của duyệt-từng-cái (lib/priceRequests.ts)
// để không lặp lại code, chỉ khác là chạy trên cả danh sách.
export async function POST() {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "accountant" && current.role !== "admin") {
    return NextResponse.json({ error: "Chỉ Kế toán/Admin mới duyệt được đề xuất giá" }, { status: 403 });
  }

  try {
    const supabase = supabaseAdmin();
    const { data: pending, error } = await supabase
      .from("price_change_requests")
      .select("*, product:products(ten_hang_hoa)")
      .eq("status", "pending");
    if (error) throw error;

    let succeeded = 0;
    const failed: { id: string; error: string }[] = [];
    for (const request of pending ?? []) {
      try {
        await applyPriceRequestDecision(supabase, request, "approve", current, null);
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
