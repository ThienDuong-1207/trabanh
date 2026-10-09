import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { canAccessConversation } from "@/lib/chatAccess";

export const runtime = "nodejs";

// Tin nhắn của 1 hội thoại, theo thứ tự thời gian tăng dần (cũ -> mới, đúng
// thứ tự đọc 1 đoạn chat).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  const supabase = supabaseAdmin();
  if (!(await canAccessConversation(supabase, current.userId, current.role, params.id))) {
    return NextResponse.json({ error: "Bạn không có quyền với hội thoại này" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("zalo_messages")
    .select("*, sent_by_profile:profiles(display_name)")
    .eq("conversation_id", params.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data ?? [] });
}

// Thêm 1 tin nhắn. direction "vao" (khách gửi) dùng để GHI TAY lại tin đã
// nhận qua Zalo trong lúc chưa nối webhook; "ra" (trả lời khách) ghi người
// gửi là chính nhân viên đang đăng nhập.
//
// TODO (sau khi Zalo OA được duyệt): direction "vao" sẽ do webhook tự tạo
// (không qua route này); direction "ra" sẽ gọi thêm Zalo Send API ngay sau
// khi insert thành công — xem comment ở đầu "Giai đoạn 11" trong schema.sql.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  const supabase = supabaseAdmin();
  if (!(await canAccessConversation(supabase, current.userId, current.role, params.id))) {
    return NextResponse.json({ error: "Bạn không có quyền với hội thoại này" }, { status: 403 });
  }

  const body = (await req.json()) as { direction: "vao" | "ra"; content?: string | null; image_url?: string | null };
  if (body.direction !== "vao" && body.direction !== "ra") {
    return NextResponse.json({ error: "Chiều tin nhắn không hợp lệ" }, { status: 400 });
  }
  const content = (body.content ?? "").trim() || null;
  const imageUrl = body.image_url || null;
  if (!content && !imageUrl) return NextResponse.json({ error: "Tin nhắn trống" }, { status: 400 });

  const { data, error } = await supabase
    .from("zalo_messages")
    .insert({
      conversation_id: params.id,
      direction: body.direction,
      content,
      image_url: imageUrl,
      sent_by: body.direction === "ra" ? current.userId : null,
    })
    .select("*, sent_by_profile:profiles(display_name)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("zalo_conversations").update({ last_message_at: data.created_at }).eq("id", params.id);

  return NextResponse.json({ message: data });
}
