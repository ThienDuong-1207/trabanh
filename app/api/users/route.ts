import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { friendlyDbError } from "@/lib/dbErrors";
import { getCurrentUserRole, Role } from "@/lib/authz";
import { usernameToEmail, isValidUsername } from "@/lib/username";
import { validatePassword } from "@/lib/passwordPolicy";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

const VALID_ROLES: Role[] = ["sales", "accountant", "admin"];

// Admin tạo tài khoản đăng nhập bằng mật khẩu cho nhân sự không dùng Google —
// mật khẩu này chỉ là mật khẩu tạm, must_change_password=true bắt buộc người
// dùng tự đặt lại ngay sau khi đăng nhập lần đầu (xem app/page.tsx).
export async function POST(req: NextRequest) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });
  if (current.role !== "admin") {
    return NextResponse.json({ error: "Bạn không có quyền thực hiện thao tác này" }, { status: 403 });
  }

  try {
    const { username, display_name, role, temp_password } = (await req.json()) as {
      username: string;
      display_name: string;
      role: Role;
      temp_password: string;
    };

    if (!username?.trim() || !isValidUsername(username)) {
      return NextResponse.json(
        { error: "Tên đăng nhập phải bắt đầu bằng chữ, chỉ gồm chữ thường/số/dấu gạch dưới, dài 3-20 ký tự." },
        { status: 400 }
      );
    }
    if (!display_name?.trim()) {
      return NextResponse.json({ error: "Thiếu tên hiển thị" }, { status: 400 });
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Vai trò không hợp lệ" }, { status: 400 });
    }
    const passwordError = validatePassword(temp_password ?? "");
    if (passwordError) {
      return NextResponse.json({ error: `Mật khẩu tạm chưa đạt yêu cầu: ${passwordError}` }, { status: 400 });
    }

    const supabase = supabaseAdmin();
    const email = usernameToEmail(username);

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: temp_password,
      email_confirm: true,
      user_metadata: { full_name: display_name },
    });
    if (createError) {
      if (createError.message?.toLowerCase().includes("already been registered")) {
        throw new Error(`Tên đăng nhập "${username}" đã được sử dụng — vui lòng chọn tên khác.`);
      }
      throw new Error(createError.message);
    }

    const { data: profile, error: updateError } = await supabase
      .from("profiles")
      .update({ username: username.trim().toLowerCase(), role, must_change_password: true })
      .eq("id", created.user.id)
      .select()
      .single();
    if (updateError) throw new Error(friendlyDbError(updateError) ?? updateError.message);

    await logActivity({
      actorId: current.userId,
      actorName: current.displayName,
      action: "user.create",
      targetType: "profile",
      targetId: profile.id,
      targetLabel: profile.username,
      detail: { role },
    });

    return NextResponse.json(profile);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
