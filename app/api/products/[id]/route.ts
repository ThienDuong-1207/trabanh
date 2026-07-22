import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { resolveBrandId } from "@/lib/brands";
import { friendlyDbError } from "@/lib/dbErrors";
import { ProductInput } from "@/lib/types";
import { getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "accountant" && current.role !== "admin") {
    return NextResponse.json({ error: "Bạn không có quyền thực hiện thao tác này" }, { status: 403 });
  }

  try {
    const { brand, ...fields } = (await req.json()) as ProductInput;

    const supabase = supabaseAdmin();

    if (current.role !== "admin") {
      const { data: existing } = await supabase.from("products").select("ten_hang_hoa").eq("id", params.id).single();
      if (existing && fields.ten_hang_hoa !== existing.ten_hang_hoa) {
        return NextResponse.json({ error: "Chỉ Admin mới đổi được tên hàng hóa" }, { status: 403 });
      }
    }

    const brand_id = await resolveBrandId(supabase, brand);

    const { data, error } = await supabase
      .from("products")
      .update({ ...fields, brand_id })
      .eq("id", params.id)
      .select("*, brand:brands(name)")
      .single();
    if (error) throw new Error(friendlyDbError(error) ?? error.message);

    await logActivity({
      actorId: current.userId,
      actorName: current.displayName,
      action: "product.update",
      targetType: "product",
      targetId: params.id,
      targetLabel: data.ten_hang_hoa,
      detail: fields,
    });

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "admin") {
    return NextResponse.json({ error: "Bạn không có quyền thực hiện thao tác này" }, { status: 403 });
  }

  try {
    const supabase = supabaseAdmin();
    const { data: existing } = await supabase.from("products").select("ten_hang_hoa").eq("id", params.id).single();
    const { error } = await supabase.from("products").delete().eq("id", params.id);
    if (error) throw error;

    await logActivity({
      actorId: current.userId,
      actorName: current.displayName,
      action: "product.delete",
      targetType: "product",
      targetId: params.id,
      targetLabel: existing?.ten_hang_hoa ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
