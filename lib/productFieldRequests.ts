import { SupabaseClient } from "@supabase/supabase-js";
import { logActivity, getAllUserIds } from "./activityLog";

type FieldRequestRow = {
  id: string;
  product_id: string;
  field: "ma_vach" | "ma_thung";
  proposed_value: string;
  product?: { ten_hang_hoa: string; ma_noi_bo: string } | null;
  proposer?: { display_name: string | null; username: string | null } | null;
};

const FIELD_LABEL: Record<string, string> = { ma_vach: "Mã vạch", ma_thung: "Mã thùng" };

// Dùng chung cho duyệt/từ chối 1 yêu cầu (PATCH /api/field-requests/[id]) và
// duyệt hàng loạt (POST /api/field-requests/approve-all) — mirror đúng
// lib/priceRequests.ts.
export async function applyFieldRequestDecision(
  supabase: SupabaseClient,
  request: FieldRequestRow,
  action: "approve" | "reject",
  actor: { userId: string; displayName: string | null },
  note?: string | null
) {
  if (action === "approve") {
    // Giá trị đề xuất có thể đã bị 1 sản phẩm khác chiếm mất kể từ lúc tạo
    // yêu cầu (vd nhập thêm 1 file khác ở giữa) — kiểm tra lại ngay trước khi
    // ghi, báo lỗi rõ ràng thay vì để lỗi Postgres thô văng ra.
    const { data: conflict } = await supabase
      .from("products")
      .select("ma_noi_bo, ten_hang_hoa")
      .eq(request.field, request.proposed_value)
      .neq("id", request.product_id)
      .maybeSingle();
    if (conflict) {
      throw new Error(
        `${FIELD_LABEL[request.field]} "${request.proposed_value}" hiện đang thuộc sản phẩm "${conflict.ten_hang_hoa}" (${conflict.ma_noi_bo}) — không thể duyệt`
      );
    }
    const { error } = await supabase
      .from("products")
      .update({ [request.field]: request.proposed_value })
      .eq("id", request.product_id);
    if (error) throw error;
  }

  const { data, error } = await supabase
    .from("product_field_requests")
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
  const recipientIds = await getAllUserIds();

  await logActivity({
    actorId: actor.userId,
    actorName: actor.displayName,
    action: action === "approve" ? "field_request.approve" : "field_request.reject",
    targetType: "product_field_request",
    targetId: request.id,
    targetLabel: productName,
    detail: { note, proposed_by_name: proposerName, field: request.field, proposed_value: request.proposed_value },
    notify: {
      recipientIds,
      message: `${actor.displayName ?? "Kế toán/Admin"} đã ${action === "approve" ? "duyệt" : "từ chối"} đề xuất ${FIELD_LABEL[request.field]} cho "${productName}".`,
      linkView: "duyetgia",
    },
  });

  return data;
}
