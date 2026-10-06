import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole } from "@/lib/authz";
import { vnDateString } from "@/lib/attendance";
import { findShiftForDate } from "@/lib/attendanceServer";

export const runtime = "nodejs";

// Trạng thái điểm danh hôm nay của người đang đăng nhập: ca được phân (nếu
// có) và bản ghi chấm công hôm nay (nếu đã vào ca).
export async function GET() {
  const current = await getCurrentUserRole();
  if (!current) return NextResponse.json({ error: "Chưa đăng nhập hoặc chưa được cấp quyền" }, { status: 401 });

  try {
    const now = new Date();
    const today = vnDateString(now);
    const found = await findShiftForDate(current.userId, today);

    const { data: attendance, error } = await supabaseAdmin()
      .from("attendance")
      .select("*")
      .eq("user_id", current.userId)
      .eq("work_date", today)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({
      today,
      serverNow: now.toISOString(),
      shift: found
        ? {
            id: found.shift.id,
            name: found.shift.name,
            loai_ca: found.shift.loai_ca,
            start_time: found.shift.start_time,
            end_time: found.shift.end_time,
            store_name: found.shift.store.name,
            radius_m: found.shift.store.radius_m,
          }
        : null,
      attendance: attendance ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Lỗi không xác định" }, { status: 500 });
  }
}
