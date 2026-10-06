import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { addDays, computeAbsent, normalizeTime, vnDateString, vnWeekdayIso } from "@/lib/attendance";
import { rulesSnapshot, toColumns } from "@/lib/attendanceServer";

export const runtime = "nodejs";

// Chạy hàng ngày lúc 00:05 giờ Việt Nam (xem vercel.json). Với NGÀY HÔM QUA:
// - nhân viên được phân ca mà không có bản ghi check-in → tạo bản ghi "vắng";
// - có check-in nhưng chưa check-out → đánh dấu "missing_checkout" để admin/kế
//   toán bổ sung giờ ra.
// Vercel Cron gửi "Authorization: Bearer $CRON_SECRET".
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const target = addDays(vnDateString(new Date()), -1);
    const weekday = vnWeekdayIso(target);
    const supabase = supabaseAdmin();

    const { data: assignments, error: aErr } = await supabase
      .from("shift_assignments")
      .select(
        "nhan_vien_id, shift:shifts(id, name, loai_ca, store_id, start_time, end_time, break_start, break_end, grace_minutes, half_day_after_minutes, absent_after_minutes, active)",
      )
      .lte("tu_ngay", target)
      .or(`den_ngay.is.null,den_ngay.gte.${target}`)
      .contains("thu_ap_dung", [weekday]);
    if (aErr) throw aErr;

    const { data: records, error: rErr } = await supabase
      .from("attendance")
      .select("id, user_id, check_in_at, check_out_at, flags")
      .eq("work_date", target);
    if (rErr) throw rErr;

    const recordByUser = new Map((records ?? []).map((r) => [r.user_id as string, r]));
    const toInsert: any[] = [];
    const toFlag: { id: string; flags: string[] }[] = [];

    for (const a of (assignments ?? []) as any[]) {
      const shift = a.shift;
      if (!shift?.active) continue;
      const userId = a.nhan_vien_id as string;
      const existing = recordByUser.get(userId);

      if (!existing) {
        const rules = {
          ...shift,
          start_time: normalizeTime(shift.start_time),
          end_time: normalizeTime(shift.end_time),
          break_start: shift.break_start ? normalizeTime(shift.break_start) : null,
          break_end: shift.break_end ? normalizeTime(shift.break_end) : null,
        };
        toInsert.push({
          user_id: userId,
          shift_id: shift.id,
          store_id: shift.store_id,
          work_date: target,
          ...toColumns(computeAbsent(rules)),
          flags: ["no_checkin"],
          shift_snapshot: rulesSnapshot(rules),
        });
        recordByUser.set(userId, { id: "", user_id: userId, check_in_at: null, check_out_at: null, flags: [] } as any);
        continue;
      }

      if (existing.check_in_at && !existing.check_out_at && !(existing.flags ?? []).includes("missing_checkout")) {
        toFlag.push({ id: existing.id as string, flags: [...(existing.flags ?? []), "missing_checkout"] });
      }
    }

    if (toInsert.length > 0) {
      const { error } = await supabase.from("attendance").insert(toInsert);
      if (error) throw error;
    }
    for (const f of toFlag) {
      const { error } = await supabase.from("attendance").update({ flags: f.flags }).eq("id", f.id);
      if (error) throw error;
    }

    return NextResponse.json({ date: target, absent_created: toInsert.length, missing_checkout_flagged: toFlag.length });
  } catch (e: any) {
    console.error("attendance-absent cron failed:", e);
    return NextResponse.json({ error: e.message ?? "Lỗi không xác định" }, { status: 500 });
  }
}
