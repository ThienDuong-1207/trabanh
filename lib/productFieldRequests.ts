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

// Ném riêng loại lỗi này (thay vì Error thường) khi bị chặn vì còn trùng —
// mang theo đúng thông tin bên đang giữ giá trị để route trả về JSON có cấu
// trúc, cho phép giao diện hỏi lại người dùng cách xử lý rồi gọi lại kèm
// conflictOverride, thay vì phải parse ngược nội dung message.
export class FieldConflictError extends Error {
  conflict: { ma_noi_bo: string; ten_hang_hoa: string };
  constructor(message: string, conflict: { ma_noi_bo: string; ten_hang_hoa: string }) {
    super(message);
    this.name = "FieldConflictError";
    this.conflict = conflict;
  }
}

// Dùng chung cho duyệt/từ chối 1 yêu cầu (PATCH /api/field-requests/[id]) và
// duyệt hàng loạt (POST /api/field-requests/approve-all) — mirror đúng
// lib/priceRequests.ts.
//
// conflictOverride: chỉ có khi người dùng chủ động xử lý trường hợp 2 sản
// phẩm bị lộn mã (hoặc cần giải phóng mã của bên kia) ngay lúc duyệt 1 dòng
// cụ thể (không dùng ở duyệt hàng loạt) — nếu còn đang trùng thật sự tại thời
// điểm duyệt, ghi giá trị này vào sản phẩm đang giữ mã trước, rồi mới gán mã
// cho sản phẩm đang duyệt. undefined = không xử lý gì thêm (giữ hành vi cũ:
// còn trùng thì chặn lại); null = xoá mã cũ của bên kia; chuỗi = gán mã đó
// cho bên kia (vd giá trị cũ của chính dòng đang duyệt — hoán đổi qua lại).
export async function applyFieldRequestDecision(
  supabase: SupabaseClient,
  request: FieldRequestRow,
  action: "approve" | "reject",
  actor: { userId: string; displayName: string | null },
  note?: string | null,
  conflictOverride?: string | null
) {
  if (action === "approve") {
    // Giá trị đề xuất có thể đã bị 1 sản phẩm khác chiếm mất kể từ lúc tạo
    // yêu cầu (vd nhập thêm 1 file khác ở giữa) — kiểm tra lại ngay trước khi
    // ghi, báo lỗi rõ ràng thay vì để lỗi Postgres thô văng ra.
    const { data: conflict } = await supabase
      .from("products")
      .select("id, ma_noi_bo, ten_hang_hoa")
      .eq(request.field, request.proposed_value)
      .neq("id", request.product_id)
      .maybeSingle();
    if (conflict) {
      if (conflictOverride === undefined) {
        throw new FieldConflictError(
          `${FIELD_LABEL[request.field]} "${request.proposed_value}" hiện đang thuộc sản phẩm "${conflict.ten_hang_hoa}" (${conflict.ma_noi_bo}) — không thể duyệt`,
          { ma_noi_bo: conflict.ma_noi_bo as string, ten_hang_hoa: conflict.ten_hang_hoa as string }
        );
      }
      // Hoán đổi qua lại thật sự (conflictOverride chính là giá trị sản phẩm
      // đang duyệt hiện đang giữ) sẽ đụng chính nó nếu ghi thẳng — ví dụ A
      // muốn lấy giá trị của B, đồng thời B nhận lại giá trị cũ của A, nhưng A
      // vẫn còn đang giữ giá trị đó nên B không ghi được. Tạm để trống sản
      // phẩm đang duyệt trước để giải phóng, ghi cho bên kia xong mới gán giá
      // trị mới cho sản phẩm đang duyệt (bước update bên dưới).
      if (conflictOverride !== null) {
        const { data: selfHolder } = await supabase
          .from("products")
          .select("id")
          .eq(request.field, conflictOverride)
          .eq("id", request.product_id)
          .maybeSingle();
        if (selfHolder) {
          const { error: clearError } = await supabase.from("products").update({ [request.field]: null }).eq("id", request.product_id);
          if (clearError) throw clearError;
        }
      }
      const { error: freeError } = await supabase
        .from("products")
        .update({ [request.field]: conflictOverride })
        .eq("id", conflict.id);
      if (freeError) throw freeError;
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
