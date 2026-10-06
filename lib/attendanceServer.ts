import { NextRequest } from "next/server";
import { supabaseAdmin } from "./supabaseServer";
import { vnWeekdayIso, ShiftRules, normalizeTime, computeAttendance } from "./attendance";

export type StoreRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  office_ips: string[];
};

export type ShiftRow = ShiftRules & {
  id: string;
  name: string;
  store_id: string;
  active: boolean;
  store: StoreRow;
};

// Ca mà nhân viên được phân cho một ngày cụ thể (null nếu không có ca nào).
// Nếu dữ liệu lỗi (nhiều hơn một ca cùng ngày) thì trả về lỗi để không tự
// chọn bừa.
export async function findShiftForDate(
  userId: string,
  dateStr: string,
): Promise<{ shift: ShiftRow; assignmentId: string } | null> {
  const weekday = vnWeekdayIso(dateStr);
  const { data, error } = await supabaseAdmin()
    .from("shift_assignments")
    .select(
      "id, shift:shifts(id, name, loai_ca, store_id, start_time, end_time, break_start, break_end, grace_minutes, half_day_after_minutes, absent_after_minutes, active, store:stores(id, name, latitude, longitude, radius_m, office_ips))",
    )
    .eq("nhan_vien_id", userId)
    .lte("tu_ngay", dateStr)
    .or(`den_ngay.is.null,den_ngay.gte.${dateStr}`)
    .contains("thu_ap_dung", [weekday]);
  if (error) throw error;

  const active = (data ?? []).filter((r: any) => r.shift?.active);
  if (active.length > 1) throw new Error("Nhân viên đang có nhiều hơn một ca trong cùng ngày — cần sửa phân ca");
  if (active.length === 0) return null;

  const row: any = active[0];
  const shift: ShiftRow = {
    ...row.shift,
    start_time: normalizeTime(row.shift.start_time),
    end_time: normalizeTime(row.shift.end_time),
    break_start: row.shift.break_start ? normalizeTime(row.shift.break_start) : null,
    break_end: row.shift.break_end ? normalizeTime(row.shift.break_end) : null,
  };
  return { shift, assignmentId: row.id };
}

// IP người gọi. Vercel đặt IP thật ở x-forwarded-for (phần tử đầu tiên).
export function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

// Tên hiển thị của nhân viên, dùng trong thông báo lỗi và bảng quản lý.
export function displayNameOf(profile: { display_name?: string | null; username?: string | null } | null): string {
  return profile?.display_name || profile?.username || "Nhân viên";
}
// Các cột tính công — dùng chung cho check-in, check-out và cron.
export function toColumns(c: ReturnType<typeof computeAttendance>) {
  return {
    status: c.status,
    late_minutes: c.late_minutes,
    early_minutes: c.early_minutes,
    work_minutes: c.work_minutes,
    work_units: c.work_units,
    ot_minutes: c.ot_minutes,
    ot_status: c.ot_status,
  };
}

// Quy định của ca tại thời điểm tính, lưu kèm để bảng công cũ không đổi khi
// sửa ca về sau.
export function rulesSnapshot(shift: {
  id: string;
  name: string;
  loai_ca: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  grace_minutes: number;
  half_day_after_minutes: number;
  absent_after_minutes: number;
}) {
  return {
    shift_id: shift.id,
    shift_name: shift.name,
    loai_ca: shift.loai_ca,
    start_time: shift.start_time,
    end_time: shift.end_time,
    break_start: shift.break_start,
    break_end: shift.break_end,
    grace_minutes: shift.grace_minutes,
    half_day_after_minutes: shift.half_day_after_minutes,
    absent_after_minutes: shift.absent_after_minutes,
  };
}
