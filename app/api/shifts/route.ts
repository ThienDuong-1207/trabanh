import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole, requireRole } from "@/lib/authz";
import { logActivity } from "@/lib/activityLog";
import {
  DEFAULT_ABSENT_AFTER_MINUTES,
  DEFAULT_GRACE_MINUTES,
  DEFAULT_HALF_DAY_AFTER_MINUTES,
  LoaiCa,
  validateShiftTimes,
} from "@/lib/attendance";

export const runtime = "nodejs";

// Danh sách ca kèm cửa hàng và nhân viên được phân. Kế toán xem để đối chiếu
// công; Admin quản lý.
export async function GET() {
  const denied = await requireRole(["accountant"]);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin()
    .from("shifts")
    .select(
      "*, store:stores(id, name), assignments:shift_assignments(id, tu_ngay, den_ngay, thu_ap_dung, employee:profiles!nhan_vien_id(id, display_name, username, chuc_danh))",
    )
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shifts: data ?? [] });
}

// Tạo ca làm việc. Giờ rule để trống sẽ dùng mặc định toàn hệ thống.
export async function POST(req: NextRequest) {
  const denied = await requireRole([]);
  if (denied) return denied;
  const current = await getCurrentUserRole();

  const body = (await req.json()) as {
    name: string;
    loai_ca: LoaiCa;
    store_id: string;
    start_time: string;
    end_time: string;
    break_start?: string | null;
    break_end?: string | null;
    grace_minutes?: number | null;
    half_day_after_minutes?: number | null;
    absent_after_minutes?: number | null;
  };

  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Thiếu tên ca" }, { status: 400 });
  if (body.loai_ca !== "gio" && body.loai_ca !== "ngay") {
    return NextResponse.json({ error: "Loại ca phải là 'gio' hoặc 'ngay'" }, { status: 400 });
  }
  if (!body.store_id) return NextResponse.json({ error: "Thiếu cửa hàng" }, { status: 400 });

  const breakStart = body.break_start || null;
  const breakEnd = body.break_end || null;
  const timeError = validateShiftTimes({
    start_time: body.start_time,
    end_time: body.end_time,
    break_start: breakStart,
    break_end: breakEnd,
  });
  if (timeError) return NextResponse.json({ error: timeError }, { status: 400 });

  const grace = body.grace_minutes ?? DEFAULT_GRACE_MINUTES;
  const half = body.half_day_after_minutes ?? DEFAULT_HALF_DAY_AFTER_MINUTES;
  const absent = body.absent_after_minutes ?? DEFAULT_ABSENT_AFTER_MINUTES;
  if (grace < 0 || half < grace || absent < half) {
    return NextResponse.json(
      { error: "Ngưỡng phải theo thứ tự: ân hạn ≤ nửa ca ≤ vắng cả ca" },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin()
    .from("shifts")
    .insert({
      name,
      loai_ca: body.loai_ca,
      store_id: body.store_id,
      start_time: body.start_time,
      end_time: body.end_time,
      break_start: breakStart,
      break_end: breakEnd,
      grace_minutes: grace,
      half_day_after_minutes: half,
      absent_after_minutes: absent,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    actorId: current!.userId,
    actorName: current!.displayName,
    action: "shift.create",
    targetType: "shift",
    targetId: data.id,
    targetLabel: name,
  });
  return NextResponse.json({ shift: data });
}
