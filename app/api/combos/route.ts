import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireRole, getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

const ALL_ROLES = ["sales", "accountant", "admin"] as const;

// Combo là 1 dòng trong `products` (is_combo = true) — quản lý chung với sản
// phẩm thường ở "Quản lý hàng hóa" nên tái dùng được nguyên các hàm xuất báo
// giá/bảng giá đã có cho Product, không cần code riêng. category_sheet
// "Combo" cố định, KHÔNG nằm trong CATEGORY_ORDER — không lẫn vào dropdown
// nhóm hàng của sản phẩm thật, và các route xuất MISA tự lọc bỏ is_combo.
async function nextComboCode(supabase: ReturnType<typeof supabaseAdmin>): Promise<string> {
  const { count } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("is_combo", true);
  return `COMBO-${String((count ?? 0) + 1).padStart(3, "0")}`;
}

export async function POST(req: NextRequest) {
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
    const ma_noi_bo = await nextComboCode(supabase);
    const { data: combo, error } = await supabase
      .from("products")
      .insert({
        ma_noi_bo,
        ten_hang_hoa: ten_combo.trim(),
        dvt: "Combo",
        gia_ban,
        ma_vach: ma_vach || null,
        category_sheet: "Combo",
        is_combo: true,
        is_draft: false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    const { error: itemsError } = await supabase
      .from("combo_items")
      .insert(items.map((it) => ({ combo_id: combo.id, product_id: it.product_id, quantity: it.quantity })));
    if (itemsError) throw itemsError;

    await logActivity({
      actorId: current!.userId,
      actorName: current!.displayName,
      action: "combo.create",
      targetType: "product",
      targetId: combo.id,
      targetLabel: combo.ten_hang_hoa,
    });

    return NextResponse.json(combo);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
