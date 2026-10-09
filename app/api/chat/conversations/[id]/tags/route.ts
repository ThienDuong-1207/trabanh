import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { canAccessConversation } from "@/lib/chatAccess";

export const runtime = "nodejs";

// Thay toàn bộ tag gắn cho hội thoại — ai xem được hội thoại thì gắn tag
// được (tag chỉ để phân loại/ghi chú nội bộ, không ảnh hưởng quyền xem).
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  const supabase = supabaseAdmin();
  if (!(await canAccessConversation(supabase, current.userId, current.role, params.id))) {
    return NextResponse.json({ error: "Bạn không có quyền với hội thoại này" }, { status: 403 });
  }

  const body = (await req.json()) as { tag_ids: string[] };
  if (!Array.isArray(body.tag_ids)) return NextResponse.json({ error: "Thiếu danh sách tag" }, { status: 400 });

  const { error: delError } = await supabase.from("conversation_tag_links").delete().eq("conversation_id", params.id);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });

  if (body.tag_ids.length > 0) {
    const rows = body.tag_ids.map((tagId) => ({ conversation_id: params.id, tag_id: tagId }));
    const { error: insError } = await supabase.from("conversation_tag_links").insert(rows);
    if (insError) return NextResponse.json({ error: insError.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
