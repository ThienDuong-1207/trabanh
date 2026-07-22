import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { validatePassword } from "@/lib/passwordPolicy";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

// Admin cấp lại mật khẩu tạm cho tài khoản username/password đã tồn tại (vd
// người dùng quên mật khẩu tạm ban đầu) — bắt phải đổi mật khẩu lại từ đầu.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "admin") {
    return NextResponse.json({ error: "Bạn không có quyền thực hiện thao tác này" }, { status: 403 });
  }

  try {
    const { temp_password } = (await req.json()) as { temp_password: string };
    const passwordError = validatePassword(temp_password ?? "");
    if (passwordError) {
      return NextResponse.json({ error: `Mật khẩu tạm chưa đạt yêu cầu: ${passwordError}` }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const { error: updateAuthError } = await supabase.auth.admin.updateUserById(params.id, { password: temp_password });
    if (updateAuthError) throw updateAuthError;

    const { data, error } = await supabase
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", params.id)
      .select()
      .single();
    if (error) throw error;

    await logActivity({
      actorId: current.userId,
      actorName: current.displayName,
      action: "user.reset_password",
      targetType: "profile",
      targetId: params.id,
      targetLabel: data.username,
    });

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
