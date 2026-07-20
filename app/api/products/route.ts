import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { resolveBrandId } from "@/lib/brands";
import { friendlyDbError } from "@/lib/dbErrors";
import { ProductInput } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { brand, ...fields } = (await req.json()) as ProductInput;
    if (!fields.ma_noi_bo || !fields.ten_hang_hoa || !fields.category_sheet) {
      return NextResponse.json({ error: "Thiếu mã nội bộ / tên hàng hóa / nhóm hàng" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const brand_id = await resolveBrandId(supabase, brand);

    const { data, error } = await supabase.from("products").insert({ ...fields, brand_id }).select("*, brand:brands(name)").single();
    if (error) throw new Error(friendlyDbError(error) ?? error.message);

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
