import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole, requireRole } from "@/lib/authz";
import type { ChatTagColor } from "@/lib/types";

export const runtime = "nodejs";

// Danh sách tag — ai cũng xem được để lọc/gắn vào hội thoại mình thấy.
export async function GET() {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  const { data, error } = await supabaseAdmin().from("chat_tags").select("*").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tags: data ?? [] });
}

// Tạo tag mới — chỉ Admin/Kế toán, để tránh mỗi người tự đặt tag trùng ý
// nhau theo cách khác nhau.
export async function POST(req: NextRequest) {
  const denied = await requireRole(["accountant"]);
  if (denied) return denied;

  const body = (await req.json()) as { name: string; color?: ChatTagColor };
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên tag" }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from("chat_tags")
    .insert({ name, color: body.color ?? "warm" })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tag: data });
}
