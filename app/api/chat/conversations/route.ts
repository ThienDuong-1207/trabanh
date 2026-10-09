import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { isOfficeRole } from "@/lib/chatAccess";
import { logActivity } from "@/lib/activityLog";
import type { ChatConversation } from "@/lib/types";

export const runtime = "nodejs";

function reshape(row: any): ChatConversation {
  return {
    ...row,
    branch: row.branch ?? null,
    tags: (row.tags ?? []).map((t: any) => t.chat_tags).filter(Boolean),
    assignees: (row.assignees ?? []).map((a: any) => ({ user_id: a.user_id, display_name: a.profiles?.display_name ?? null })),
  };
}

// Danh sách hội thoại — Admin/Kế toán thấy toàn bộ; Sales/Staff chỉ thấy
// hội thoại đã được gán cho mình.
export async function GET() {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  const supabase = supabaseAdmin();
  const select = `*, branch:stores(id, name), tags:conversation_tag_links(chat_tags(id, name, color)), assignees:conversation_assignments(user_id, profiles(display_name))`;

  let query = supabase.from("zalo_conversations").select(select).order("last_message_at", { ascending: false });

  if (!isOfficeRole(current.role)) {
    const { data: assigned } = await supabase.from("conversation_assignments").select("conversation_id").eq("user_id", current.userId);
    const ids = (assigned ?? []).map((a) => a.conversation_id);
    if (ids.length === 0) return NextResponse.json({ conversations: [] });
    query = query.in("id", ids);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: (data ?? []).map(reshape) });
}

// Tạo hội thoại mới (ghi tay — dùng trong lúc chưa nối Zalo OA thật). Người
// tạo tự động được gán quyền xem luôn, để không tạo xong rồi tự mình không
// thấy lại (Sales/Staff không phải văn phòng).
export async function POST(req: NextRequest) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  const body = (await req.json()) as { customer_name: string; customer_phone?: string | null; branch_id?: string | null };
  const customerName = (body.customer_name ?? "").trim();
  if (!customerName) return NextResponse.json({ error: "Thiếu tên khách hàng" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data: conv, error } = await supabase
    .from("zalo_conversations")
    .insert({
      customer_name: customerName,
      customer_phone: body.customer_phone?.trim() || null,
      branch_id: body.branch_id || null,
      created_by: current.userId,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!isOfficeRole(current.role)) {
    await supabase.from("conversation_assignments").insert({ conversation_id: conv.id, user_id: current.userId, assigned_by: current.userId });
  }

  await logActivity({
    actorId: current.userId,
    actorName: current.displayName,
    action: "chat.create_conversation",
    targetType: "zalo_conversation",
    targetId: conv.id,
    targetLabel: customerName,
  });
  return NextResponse.json({ conversation: conv });
}
