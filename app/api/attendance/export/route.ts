import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getCurrentUserRole, requireRole } from "@/lib/authz";
import { buildAttendanceExcel, AttendanceExportRow } from "@/lib/attendanceExportBuilder";

export const runtime = "nodejs";

// Xuất Excel chấm công để Kế toán tính lương — lọc theo nhân viên và/hoặc
// khoảng ngày, xem app/views/AttendanceManagementView.tsx.
export async function POST(req: NextRequest) {
  const denied = await requireRole(["accountant"]);
  if (denied) return denied;

  try {
    const { employeeId, from, to } = (await req.json().catch(() => ({}))) as {
      employeeId?: string;
      from?: string;
      to?: string;
    };

    const supabase = supabaseAdmin();
    let query = supabase
      .from("attendance")
      .select(
        "work_date, check_in_at, check_out_at, status, late_minutes, early_minutes, work_minutes, work_units, ot_minutes, ot_status, flags, employee:profiles(display_name, username, chuc_danh), shift:shifts(name)",
      )
      .order("work_date", { ascending: true });
    if (employeeId) query = query.eq("user_id", employeeId);
    if (from) query = query.gte("work_date", from);
    if (to) query = query.lte("work_date", to);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as AttendanceExportRow[];
    const buf = await buildAttendanceExcel(rows);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Row-Count": String(rows.length),
      },
    });
  } catch (e: any) {
    const current = await getCurrentUserRole();
    console.error("attendance export failed:", current?.userId, e);
    return NextResponse.json({ error: e.message ?? "Lỗi không xác định" }, { status: 500 });
  }
}
