import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { resolveBrandId } from "@/lib/brands";
import { friendlyDbError } from "@/lib/dbErrors";
import { ProductInput } from "@/lib/types";
import { getCurrentUserRole } from "@/lib/authz";

export const runtime = "nodejs";

// Sales doesn't know the real Mã nội bộ yet (Kế toán assigns it later via
// complete-draft) — mint a placeholder so the unique-not-null column is
// still satisfied until then.
function randomDraftCode() {
  return "NHAP-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function POST(req: NextRequest) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "sales" && current.role !== "admin") {
    return NextResponse.json({ error: "Bạn không có quyền thêm sản phẩm" }, { status: 403 });
  }

  try {
    const { brand, ...fields } = (await req.json()) as ProductInput;
    const supabase = supabaseAdmin();

    if (current.role === "sales") {
      if (!fields.ten_hang_hoa || !fields.category_sheet) {
        return NextResponse.json({ error: "Thiếu tên hàng hóa / nhóm hàng" }, { status: 400 });
      }
      const { data, error } = await supabase
        .from("products")
        .insert({
          ma_noi_bo: randomDraftCode(),
          ten_hang_hoa: fields.ten_hang_hoa,
          category_sheet: fields.category_sheet,
          is_draft: true,
        })
        .select("*, brand:brands(name)")
        .single();
      if (error) throw new Error(friendlyDbError(error) ?? error.message);
      return NextResponse.json(data);
    }

    if (!fields.ma_noi_bo || !fields.ten_hang_hoa || !fields.category_sheet) {
      return NextResponse.json({ error: "Thiếu mã nội bộ / tên hàng hóa / nhóm hàng" }, { status: 400 });
    }
    const brand_id = await resolveBrandId(supabase, brand);
    const { data, error } = await supabase.from("products").insert({ ...fields, brand_id }).select("*, brand:brands(name)").single();
    if (error) throw new Error(friendlyDbError(error) ?? error.message);

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
