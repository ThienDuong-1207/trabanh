import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireRole, getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

const ALL_ROLES = ["sales", "accountant", "admin"] as const;

// Danh sách sản phẩm trong 1 combo (để nạp sẵn vào form Sửa combo) — combo
// không tự mang theo items như 1 field, phải tra riêng bảng combo_items.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireRole([...ALL_ROLES]);
  if (denied) return denied;

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("combo_items")
    .select("*, product:products(ten_hang_hoa, ma_noi_bo, gia_ban)")
    .eq("combo_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

// Sửa combo: thay toàn bộ danh sách sản phẩm bằng danh sách mới gửi lên
// (xóa hết combo_items cũ rồi chèn lại) — đơn giản hơn hẳn so với so khớp
// từng dòng thêm/bớt/đổi số lượng, và combo chỉ có vài sản phẩm nên không
// đáng lo hiệu năng.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireRole([...ALL_ROLES]);
  if (denied) return denied;
  const current = await getCurrentUserRole();

  try {
    const { ten_combo, gia_ban, ma_vach, items } = (await req.json()) as {
      ten_combo: string;
      gia_ban: number | null;
      ma_vach: string | null;
      items: { product_id: string; quantity: number }[];
    };
    if (!ten_combo?.trim()) return NextResponse.json({ error: "Cần nhập tên combo" }, { status: 400 });
    if (!items || items.length === 0) return NextResponse.json({ error: "Combo cần ít nhất 1 sản phẩm" }, { status: 400 });

    const supabase = supabaseAdmin();
    const { data: combo, error } = await supabase
      .from("products")
      .update({ ten_hang_hoa: ten_combo.trim(), gia_ban, ma_vach: ma_vach || null })
      .eq("id", params.id)
      .eq("is_combo", true)
      .select()
      .single();
    if (error) throw error;

    const { error: deleteError } = await supabase.from("combo_items").delete().eq("combo_id", params.id);
    if (deleteError) throw deleteError;

    const { error: itemsError } = await supabase
      .from("combo_items")
      .insert(items.map((it) => ({ combo_id: params.id, product_id: it.product_id, quantity: it.quantity })));
    if (itemsError) throw itemsError;

    await logActivity({
      actorId: current!.userId,
      actorName: current!.displayName,
      action: "combo.update",
      targetType: "product",
      targetId: params.id,
      targetLabel: combo.ten_hang_hoa,
    });

    return NextResponse.json(combo);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
