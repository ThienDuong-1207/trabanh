import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole, Role } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

const VALID_ROLES: Role[] = ["sales", "accountant", "admin"];

// Admin đổi vai trò cho 1 tài khoản đã tồn tại (Google hoặc username/mật
// khẩu) — role trước đây chỉ gán được lúc tạo tài khoản.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "admin") {
    return NextResponse.json({ error: "Bạn không có quyền thực hiện thao tác này" }, { status: 403 });
  }

  try {
    const { role } = (await req.json()) as { role: Role };
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Vai trò không hợp lệ" }, { status: 400 });
    }
    // Chặn tự hạ quyền của chính mình — tránh tự khóa mất quyền Admin và phải
    // sửa lại bằng tay qua Supabase SQL Editor.
    if (params.id === current.userId && role !== "admin") {
      return NextResponse.json({ error: "Không thể tự đổi vai trò của chính mình" }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { data, error } = await supabase.from("profiles").update({ role }).eq("id", params.id).select().single();
    if (error) throw error;

    await logActivity({
      actorId: current.userId,
      actorName: current.displayName,
      action: "user.update_role",
      targetType: "profile",
      targetId: params.id,
      targetLabel: data.username ?? data.display_name,
      detail: { role },
    });

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Admin xóa hẳn 1 tài khoản — xóa auth.users sẽ cascade xóa luôn dòng profiles
// tương ứng (profiles.id references auth.users(id) on delete cascade).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "admin") {
    return NextResponse.json({ error: "Bạn không có quyền thực hiện thao tác này" }, { status: 403 });
  }
  if (params.id === current.userId) {
    return NextResponse.json({ error: "Không thể tự xóa tài khoản của chính mình" }, { status: 400 });
  }

  try {
    const supabase = supabaseAdmin();
    const { data: existing } = await supabase.from("profiles").select("username, display_name").eq("id", params.id).single();

    const { error } = await supabase.auth.admin.deleteUser(params.id);
    if (error) throw error;

    await logActivity({
      actorId: current.userId,
      actorName: current.displayName,
      action: "user.delete",
      targetType: "profile",
      targetId: params.id,
      targetLabel: existing?.username ?? existing?.display_name ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
