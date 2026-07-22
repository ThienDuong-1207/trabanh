import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "accountant" && current.role !== "admin") {
    return NextResponse.json({ error: "Chỉ Kế toán/Admin mới duyệt được đề xuất giá" }, { status: 403 });
  }

  try {
    const { action, note } = (await req.json()) as { action: "approve" | "reject"; note?: string };
    const supabase = supabaseAdmin();

    const { data: request, error: fetchError } = await supabase
      .from("price_change_requests")
      .select("*")
      .eq("id", params.id)
      .single();
    if (fetchError) throw fetchError;
    if (request.status !== "pending") {
      return NextResponse.json({ error: "Đề xuất này đã được xử lý rồi" }, { status: 400 });
    }

    if (action === "approve") {
      const update: Record<string, number> = {};
      if (request.proposed_gia_ban != null) update.gia_ban = request.proposed_gia_ban;
      if (request.proposed_gia_thung != null) update.gia_thung = request.proposed_gia_thung;
      const { error: applyError } = await supabase.from("products").update(update).eq("id", request.product_id);
      if (applyError) throw applyError;
    } else if (action !== "reject") {
      return NextResponse.json({ error: "Hành động không hợp lệ" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("price_change_requests")
      .update({
        status: action === "approve" ? "approved" : "rejected",
        reviewed_by: current.userId,
        reviewed_at: new Date().toISOString(),
        note: note ?? null,
      })
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
