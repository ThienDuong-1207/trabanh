import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

// Chỉ xóa khi Admin đã tự tải file lưu trữ xong ở bước trước (POST
// /api/export-price-history) và xác nhận lần cuối phía client — route này
// không tự xuất file, chỉ thực hiện đúng thao tác xóa sau khi đã xác nhận.
export async function POST(req: NextRequest) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "admin") {
    return NextResponse.json({ error: "Chỉ Admin được dọn lịch sử giá" }, { status: 403 });
  }

  try {
    const { to } = (await req.json()) as { to: string };
    if (!to) return NextResponse.json({ error: "Thiếu mốc thời gian cần dọn" }, { status: 400 });

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("price_history").delete().lt("changed_at", to).select("id");
    if (error) throw error;

    const deletedCount = data?.length ?? 0;
    await logActivity({
      actorId: current.userId,
      actorName: current.displayName,
      action: "price_history.cleanup",
      detail: { deletedCount, olderThan: to },
    });

    return NextResponse.json({ deletedCount });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
