import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { resolveBrandId } from "@/lib/brands";
import { friendlyDbError } from "@/lib/dbErrors";
import { requireRole } from "@/lib/authz";

export const runtime = "nodejs";

// Kế toán/Admin hoàn thiện 1 sản phẩm "nháp" (Sales chỉ tạo được Tên hàng
// hóa + Nhóm hàng, xem app/api/products/route.ts) — điền Mã nội bộ thật/Tên
// hóa đơn/Quy cách/ĐVT rồi tắt is_draft.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authError = await requireRole(["accountant", "admin"]);
  if (authError) return authError;

  try {
    const { brand, ma_noi_bo, ten_hoa_don, quy_cach, dvt, ty_le } = (await req.json()) as {
      brand?: string | null;
      ma_noi_bo: string;
      ten_hoa_don?: string | null;
      quy_cach?: string | null;
      dvt?: string | null;
      ty_le?: number | null;
    };
    if (!ma_noi_bo?.trim()) {
      return NextResponse.json({ error: "Thiếu Mã nội bộ" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const brand_id = await resolveBrandId(supabase, brand ?? null);

    const { data, error } = await supabase
      .from("products")
      .update({ ma_noi_bo: ma_noi_bo.trim(), ten_hoa_don, quy_cach, dvt, ty_le, brand_id, is_draft: false })
      .eq("id", params.id)
      .select("*, brand:brands(name)")
      .single();
    if (error) throw new Error(friendlyDbError(error) ?? error.message);

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
