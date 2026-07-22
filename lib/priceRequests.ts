import { SupabaseClient } from "@supabase/supabase-js";
import { logActivity } from "./activityLog";

type PriceRequestRow = {
  id: string;
  product_id: string;
  proposed_gia_ban: number | null;
  proposed_gia_thung: number | null;
  proposed_by: string;
  product?: { ten_hang_hoa: string } | null;
};

// Dùng chung cho duyệt/từ chối 1 đề xuất (PATCH /api/price-requests/[id])
// và duyệt hàng loạt (POST /api/price-requests/approve-all) — tránh lặp lại
// đúng logic áp dụng giá + ghi log ở 2 nơi.
export async function applyPriceRequestDecision(
  supabase: SupabaseClient,
  request: PriceRequestRow,
  action: "approve" | "reject",
  actor: { userId: string; displayName: string | null },
  note?: string | null
) {
  if (action === "approve") {
    const update: Record<string, number> = {};
    if (request.proposed_gia_ban != null) update.gia_ban = request.proposed_gia_ban;
    if (request.proposed_gia_thung != null) update.gia_thung = request.proposed_gia_thung;
    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from("products").update(update).eq("id", request.product_id);
      if (error) throw error;
    }
  }

  const { data, error } = await supabase
    .from("price_change_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      reviewed_by: actor.userId,
      reviewed_at: new Date().toISOString(),
      note: note ?? null,
    })
    .eq("id", request.id)
    .select()
    .single();
  if (error) throw error;

  const productName = request.product?.ten_hang_hoa ?? "sản phẩm";
  await logActivity({
    actorId: actor.userId,
    actorName: actor.displayName,
    action: action === "approve" ? "price_request.approve" : "price_request.reject",
    targetType: "price_change_request",
    targetId: request.id,
    targetLabel: productName,
    detail: { note },
    notify: {
      recipientIds: [request.proposed_by],
      message: `Đề xuất giá cho "${productName}" đã được ${action === "approve" ? "duyệt" : "từ chối"}.`,
      linkView: "duyetgia",
    },
  });

  return data;
}
