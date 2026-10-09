import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { canAccessConversation } from "@/lib/chatAccess";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

// Đổi trạng thái/chi nhánh của 1 hội thoại — Admin/Kế toán hoặc người đã
// được gán quyền xem hội thoại này.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  const supabase = supabaseAdmin();
  if (!(await canAccessConversation(supabase, current.userId, current.role, params.id))) {
    return NextResponse.json({ error: "Bạn không có quyền với hội thoại này" }, { status: 403 });
  }

  const body = (await req.json()) as { status?: "moi" | "dang_xu_ly" | "da_dong"; branch_id?: string | null };
  const patch: Record<string, unknown> = {};
  if (body.status) patch.status = body.status;
  if (body.branch_id !== undefined) patch.branch_id = body.branch_id || null;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Không có gì để sửa" }, { status: 400 });

  const { data, error } = await supabase.from("zalo_conversations").update(patch).eq("id", params.id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    actorId: current.userId,
    actorName: current.displayName,
    action: "chat.update_conversation",
    targetType: "zalo_conversation",
    targetId: params.id,
    detail: patch,
  });
  return NextResponse.json({ conversation: data });
}
