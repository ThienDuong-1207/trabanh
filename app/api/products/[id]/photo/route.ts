import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { requireRole, getCurrentUserRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";

export const runtime = "nodejs";

const BUCKET = "product-photos";
const MAX_BYTES = 5 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const ALL_ROLES = ["sales", "accountant", "admin"] as const;

// Lấy đường dẫn trong bucket từ public URL (phần sau "/product-photos/").
function storagePathFromUrl(url: string): string | null {
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireRole([...ALL_ROLES]);
  if (denied) return denied;
  const current = await getCurrentUserRole();

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Chưa chọn file ảnh" }, { status: 400 });
    const ext = EXT_BY_TYPE[file.type];
    if (!ext) return NextResponse.json({ error: "Chỉ nhận ảnh JPG, PNG, WEBP hoặc GIF" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Ảnh tối đa 5MB" }, { status: 400 });

    const supabase = supabaseAdmin();
    const path = `${params.id}/${randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const { data: existing } = await supabase.from("products").select("photo_url, ten_hang_hoa").eq("id", params.id).single();

    const { error } = await supabase.from("products").update({ photo_url: publicData.publicUrl }).eq("id", params.id);
    if (error) throw error;

    // Ảnh cũ trong bucket không còn được tham chiếu nữa — dọn đi để khỏi tốn dung lượng.
    const oldPath = existing?.photo_url ? storagePathFromUrl(existing.photo_url) : null;
    if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]);

    await logActivity({
      actorId: current!.userId,
      actorName: current!.displayName,
      action: "product.photo_update",
      targetType: "product",
      targetId: params.id,
      targetLabel: existing?.ten_hang_hoa ?? null,
    });

    return NextResponse.json({ photo_url: publicData.publicUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requireRole([...ALL_ROLES]);
  if (denied) return denied;
  const current = await getCurrentUserRole();

  try {
    const supabase = supabaseAdmin();
    const { data: existing, error: readError } = await supabase
      .from("products")
      .select("photo_url, ten_hang_hoa")
      .eq("id", params.id)
      .single();
    if (readError) throw readError;

    const path = existing?.photo_url ? storagePathFromUrl(existing.photo_url) : null;
    if (path) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
      if (removeError) throw removeError;
    }

    const { error } = await supabase.from("products").update({ photo_url: null }).eq("id", params.id);
    if (error) throw error;

    await logActivity({
      actorId: current!.userId,
      actorName: current!.displayName,
      action: "product.photo_delete",
      targetType: "product",
      targetId: params.id,
      targetLabel: existing?.ten_hang_hoa ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
