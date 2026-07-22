import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { logActivity, getRecipientIds } from "@/lib/activityLog";

export const runtime = "nodejs";

// Sales sửa thẳng vào ô "Giá bán lẻ"/"Giá thùng" (giống hệt thao tác của Kế
// toán) — nhưng thay vì ghi thẳng vào products, mỗi lần gõ 1 ô sẽ tạo/cập
// nhật 1 đề xuất giá (product_id + field). Nếu đã có đề xuất đang "pending"
// của chính người này cho đúng sản phẩm này, cập nhật đè lên đúng trường vừa
// sửa (giữ nguyên trường còn lại) thay vì tạo thêm 1 dòng mới — tránh Kế
// toán thấy nhiều đề xuất trùng nhau cho cùng 1 sản phẩm.
export async function POST(req: NextRequest) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "sales") return NextResponse.json({ error: "Chỉ Sales mới đề xuất giá" }, { status: 403 });

  try {
    const { product_id, field, value } = (await req.json()) as {
      product_id: string;
      field: "gia_ban" | "gia_thung";
      value: number | null;
    };
    if (!product_id || (field !== "gia_ban" && field !== "gia_thung")) {
      return NextResponse.json({ error: "Thiếu sản phẩm hoặc trường giá không hợp lệ" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const proposedColumn = field === "gia_ban" ? "proposed_gia_ban" : "proposed_gia_thung";

    const { data: existing } = await supabase
      .from("price_change_requests")
      .select("id")
      .eq("product_id", product_id)
      .eq("proposed_by", current.userId)
      .eq("status", "pending")
      .maybeSingle();

    let data;
    if (existing) {
      const { data: updated, error } = await supabase
        .from("price_change_requests")
        .update({ [proposedColumn]: value, created_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("*, product:products(ten_hang_hoa, ma_noi_bo, gia_ban, gia_thung)")
        .single();
      if (error) throw error;
      data = updated;
    } else {
      const { data: inserted, error } = await supabase
        .from("price_change_requests")
        .insert({ product_id, [proposedColumn]: value, proposed_by: current.userId })
        .select("*, product:products(ten_hang_hoa, ma_noi_bo, gia_ban, gia_thung)")
        .single();
      if (error) throw error;
      data = inserted;
    }

    const productName = data.product?.ten_hang_hoa ?? "sản phẩm";
    await logActivity({
      actorId: current.userId,
      actorName: current.displayName,
      action: existing ? "price_request.update" : "price_request.create",
      targetType: "price_change_request",
      targetId: data.id,
      targetLabel: productName,
      detail: { field, value },
      // Chỉ báo cho Kế toán/Admin khi đề xuất mới xuất hiện lần đầu — sửa lại
      // nhiều lần trong lúc còn "pending" không cần báo lại mỗi lần gõ.
      notify: existing
        ? undefined
        : {
            recipientIds: await getRecipientIds(["accountant", "admin"]),
            message: `${current.displayName ?? "Sales"} đã đề xuất giá cho "${productName}".`,
            linkView: "duyetgia",
          },
    });

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
