import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";

export const runtime = "nodejs";

// Sales submits a price-change proposal for an existing product — never
// writes products.gia_ban/gia_thung directly (RLS from Giai đoạn 1 already
// blocks that for the sales role); an accountant/admin has to approve it via
// PATCH /api/price-requests/[id] before it takes effect.
export async function POST(req: NextRequest) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "sales") return NextResponse.json({ error: "Chỉ Sales mới đề xuất giá" }, { status: 403 });

  try {
    const { product_id, proposed_gia_ban, proposed_gia_thung } = (await req.json()) as {
      product_id: string;
      proposed_gia_ban: number | null;
      proposed_gia_thung: number | null;
    };
    if (!product_id || (proposed_gia_ban == null && proposed_gia_thung == null)) {
      return NextResponse.json({ error: "Thiếu sản phẩm hoặc giá đề xuất" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from("price_change_requests")
      .insert({ product_id, proposed_gia_ban, proposed_gia_thung, proposed_by: current.userId })
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
