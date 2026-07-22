import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { applyPriceRequestDecision } from "@/lib/priceRequests";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "accountant" && current.role !== "admin") {
    return NextResponse.json({ error: "Chỉ Kế toán/Admin mới duyệt được đề xuất giá" }, { status: 403 });
  }

  try {
    const { action, note } = (await req.json()) as { action: "approve" | "reject"; note?: string };
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data: request, error: fetchError } = await supabase
      .from("price_change_requests")
      .select(
        "*, product:products(ten_hang_hoa, gia_ban, gia_thung), proposer:profiles!price_change_requests_proposed_by_fkey(display_name, username)"
      )
      .eq("id", params.id)
      .single();
    if (fetchError) throw fetchError;
    if (request.status !== "pending") {
      return NextResponse.json({ error: "Đề xuất này đã được xử lý rồi" }, { status: 400 });
    }

    const data = await applyPriceRequestDecision(supabase, request, action, current, note);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
