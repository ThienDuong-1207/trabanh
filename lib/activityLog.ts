import { supabaseAdmin } from "./supabaseServer";
import { Role } from "./authz";

export async function getRecipientIds(roles: Role[]): Promise<string[]> {
  const { data } = await supabaseAdmin().from("profiles").select("id").in("role", roles);
  return (data ?? []).map((p) => p.id as string);
}

// Mọi người dùng đã được cấp quyền (bất kể role) — dùng khi 1 hành động cần
// thông báo cho toàn bộ team, không riêng vai trò nào (vd duyệt/từ chối giá).
export async function getAllUserIds(): Promise<string[]> {
  const { data } = await supabaseAdmin().from("profiles").select("id").not("role", "is", null);
  return (data ?? []).map((p) => p.id as string);
}

type LogActivityEntry = {
  actorId: string;
  actorName: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string | null;
  detail?: Record<string, unknown> | null;
  notify?: { recipientIds: string[]; message: string; linkView?: string };
};

// Ghi 1 dòng activity_log, kèm tùy chọn tạo notifications cho người liên
// quan — bọc try/catch nội bộ vì ghi log không bao giờ được phép làm hỏng
// thao tác chính đã thành công trước đó.
export async function logActivity(entry: LogActivityEntry): Promise<void> {
  try {
    const supabase = supabaseAdmin();
    const { data: activity, error } = await supabase
      .from("activity_log")
      .insert({
        actor_id: entry.actorId,
        actor_name: entry.actorName,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        target_label: entry.targetLabel ?? null,
        detail: entry.detail ?? null,
      })
      .select()
      .single();
    if (error) throw error;

    if (entry.notify && activity) {
      const rows = entry.notify.recipientIds
        .filter((id) => id !== entry.actorId)
        .map((id) => ({
          recipient_id: id,
          activity_id: activity.id,
          message: entry.notify!.message,
          link_view: entry.notify!.linkView ?? null,
        }));
      if (rows.length > 0) {
        const { error: notifyError } = await supabase.from("notifications").insert(rows);
        if (notifyError) throw notifyError;
      }
    }
  } catch (e) {
    console.error("logActivity failed:", e);
  }
}
