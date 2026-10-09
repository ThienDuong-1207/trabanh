import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole, requireRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

// Thay toàn bộ danh sách người được gán quyền xem hội thoại này — chỉ
// Admin/Kế toán ("văn phòng") được gán, đúng yêu cầu "admin quản lý toàn bộ
// và gán quyền cho staff/sales thấy".
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireRole(["accountant"]);
  if (denied) return denied;
  const current = await getCurrentUserRole();

  const body = (await req.json()) as { user_ids: string[] };
  if (!Array.isArray(body.user_ids)) return NextResponse.json({ error: "Thiếu danh sách nhân viên" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { error: delError } = await supabase.from("conversation_assignments").delete().eq("conversation_id", params.id);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  if (body.user_ids.length > 0) {
    const rows = body.user_ids.map((userId) => ({ conversation_id: params.id, user_id: userId, assigned_by: current!.userId }));
    const { error: insError } = await supabase.from("conversation_assignments").insert(rows);
    if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });
  }

  await logActivity({
    actorId: current!.userId,
    actorName: current!.displayName,
    action: "chat.assign",
    targetType: "zalo_conversation",
    targetId: params.id,
    detail: { user_ids: body.user_ids },
  });
  return NextResponse.json({ ok: true });
}
