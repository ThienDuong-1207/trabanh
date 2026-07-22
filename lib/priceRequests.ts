import { SupabaseClient } from "@supabase/supabase-js";
import { logActivity, getAllUserIds } from "./activityLog";

type PriceRequestRow = {
  id: string;
  product_id: string;
  proposed_gia_ban: number | null;
  proposed_gia_thung: number | null;
  proposed_by: string;
  product?: { ten_hang_hoa: string; gia_ban: number | null; gia_thung: number | null } | null;
  proposer?: { display_name: string | null; username: string | null } | null;
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
  // Giá cũ/mới ghi vào Nhật ký hoạt động ngay tại đây — vì đây là chỗ duy
  // nhất còn biết được giá TRƯỚC khi ghi đè (product đã join sẵn ở route gọi
  // hàm này), phục vụ tab "Lịch sử giá" trong Nhật ký hoạt động.
  const giaBanOld = request.product?.gia_ban ?? null;
  const giaThungOld = request.product?.gia_thung ?? null;
  const giaBanNew = request.proposed_gia_ban ?? giaBanOld;
  const giaThungNew = request.proposed_gia_thung ?? giaThungOld;

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
  const proposerName = request.proposer?.display_name ?? request.proposer?.username ?? null;

  // Duyệt/từ chối đều báo cho TOÀN BỘ user (mọi role), không chỉ riêng
  // người đề xuất — để ai cũng biết vừa có giá nào được xử lý.
  const recipientIds = await getAllUserIds();

  await logActivity({
    actorId: actor.userId,
    actorName: actor.displayName,
    action: action === "approve" ? "price_request.approve" : "price_request.reject",
    targetType: "price_change_request",
    targetId: request.id,
    targetLabel: productName,
    detail:
      action === "approve"
        ? {
            note,
            proposed_by_name: proposerName,
            gia_ban_old: giaBanOld,
            gia_ban_new: giaBanNew,
            gia_thung_old: giaThungOld,
            gia_thung_new: giaThungNew,
          }
        : { note, proposed_by_name: proposerName },
    notify: {
      recipientIds,
      message: `${actor.displayName ?? "Kế toán/Admin"} đã ${
        action === "approve" ? "duyệt" : "từ chối"
      } đề xuất giá cho "${productName}".`,
      linkView: "duyetgia",
    },
  });

  return data;
}
