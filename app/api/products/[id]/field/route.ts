import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { resolveBrandId } from "@/lib/brands";
import { friendlyDbError } from "@/lib/dbErrors";
import { getCurrentUserRole, Role } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

// Sửa nhanh 1 trường ngay trong bảng "Quản lý hàng hóa" — ghi thẳng vào DB
// ngay (không qua đề xuất/duyệt như giá), chỉ ghi lại vào Nhật ký hoạt động
// để tra cứu. Mỗi trường có 1 danh sách vai trò được sửa riêng — khác hẳn
// PATCH /api/products/[id] (form "Sửa sản phẩm" đầy đủ, giờ chỉ Admin dùng).
const FIELD_ROLES: Record<string, Role[]> = {
  ten_hang_hoa: ["admin"],
  category_sheet: ["admin"],
  ma_noi_bo: ["admin"],
  dvt: ["admin"],
  quy_cach: ["admin"],
  ty_le: ["admin"],
  brand: ["admin"],
  ma_vach: ["admin"],
  ma_thung: ["admin"],
  ten_hoa_don: ["admin", "accountant"],
};

const NUMERIC_FIELDS = new Set(["ty_le"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  try {
    const { field, value } = (await req.json()) as { field: string; value: string | number | null };

    const allowedRoles = FIELD_ROLES[field];
    if (!allowedRoles) return NextResponse.json({ error: "Trường không hợp lệ" }, { status: 400 });
    if (!allowedRoles.includes(current.role)) {
      return NextResponse.json({ error: "Bạn không có quyền sửa trường này" }, { status: 403 });
    }

    const supabase = supabaseAdmin();
    const { data: existing } = await supabase.from("products").select("*").eq("id", params.id).single();
    if (!existing) return NextResponse.json({ error: "Không tìm thấy sản phẩm" }, { status: 404 });

    let updatePayload: Record<string, unknown>;
    let oldValue: unknown;
    let newValue: unknown = value;

    if (field === "brand") {
      oldValue = existing.brand_id;
      const brand_id = await resolveBrandId(supabase, value as string | null);
      updatePayload = { brand_id };
      newValue = brand_id;
    } else {
      oldValue = existing[field];
      const cleaned = NUMERIC_FIELDS.has(field)
        ? value === null || value === ""
          ? null
          : Number(value)
        : typeof value === "string"
        ? value.trim() || null
        : value;
      updatePayload = { [field]: cleaned };
      newValue = cleaned;
    }

    const { data, error } = await supabase
      .from("products")
      .update(updatePayload)
      .eq("id", params.id)
      .select("*, brand:brands(name)")
      .single();
    if (error) throw new Error(friendlyDbError(error) ?? error.message);

    await logActivity({
      actorId: current.userId,
      actorName: current.displayName,
      action: "product.update_field",
      targetType: "product",
      targetId: params.id,
      targetLabel: data.ten_hang_hoa,
      detail: { field, old_value: oldValue, new_value: newValue },
    });

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
