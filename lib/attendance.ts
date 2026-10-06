// Logic chấm công thuần (không gọi DB) — dùng chung cho API check-in/out,
// cron đánh dấu vắng, và sau này là bảng công/xuất Excel.
//
// Quy ước thời gian: giờ ca (vd "08:00") luôn là giờ Việt Nam (UTC+7, không
// có DST). Mọi mốc thời gian lưu DB là timestamptz, còn ngày công (work_date)
// là ngày theo giờ Việt Nam.

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Độ chính xác GPS tối đa chấp nhận khi điểm danh (mét). Trên mức này vị trí
// không đủ tin cậy để so với bán kính cửa hàng.
export const GPS_MAX_ACCURACY_M = 100;

// Mặc định khi tạo ca (có thể ghi đè riêng từng ca trong bảng shifts).
export const DEFAULT_GRACE_MINUTES = 5;
export const DEFAULT_HALF_DAY_AFTER_MINUTES = 30;
export const DEFAULT_ABSENT_AFTER_MINUTES = 120;

export type LoaiCa = "gio" | "ngay";
export type AttendanceStatus = "on_time" | "late" | "half_day" | "absent";

// Phần quy định của ca cần để tính công. Được snapshot vào attendance
// (shift_snapshot) lúc tính để đổi quy định sau này không làm đổi bảng công cũ.
export type ShiftRules = {
  loai_ca: LoaiCa;
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
  break_start: string | null;
  break_end: string | null;
  grace_minutes: number;
  half_day_after_minutes: number;
  absent_after_minutes: number;
};

export type AttendanceComputed = {
  status: AttendanceStatus;
  late_minutes: number; // phút vào muộn so với giờ ca (thô, chưa trừ ân hạn)
  early_minutes: number | null; // phút ra sớm so với giờ ca (null nếu chưa check-out)
  work_minutes: number | null; // phút công thực (trừ giờ nghỉ), null nếu chưa check-out
  work_units: number | null; // công ngày: 1 / 0.5 / 0; chỉ dùng cho ca theo ngày
  ot_minutes: number | null; // phút làm sau giờ ca (thô); null nếu chưa check-out
  ot_status: "pending" | null; // có tăng ca thì chờ duyệt
};

// Số ngày kế tiếp/trước của một chuỗi "YYYY-MM-DD" (theo lịch, không theo giờ).
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Ngày hôm nay theo giờ Việt Nam, dạng "YYYY-MM-DD".
export function vnDateString(now: Date): string {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

// Thứ trong tuần theo chuẩn ISO: 1 = Thứ 2 … 7 = Chủ nhật.
export function vnWeekdayIso(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = CN
  return js === 0 ? 7 : js;
}

// Đổi "HH:MM" của một ngày (theo giờ Việt Nam) thành mốc thời gian tuyệt đối.
export function vnTimeOn(dateStr: string, hhmm: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.slice(0, 5).split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - VN_OFFSET_MS);
}

// Khoảng cách đường chim bay giữa 2 tọa độ, đơn vị mét.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Làm tròn 2 chữ số thập phân để lưu phút (vd 7.33). Đây không phải làm tròn
// nghiệp vụ — quy tắc làm tròn giờ công áp dụng lúc tính lương, không lúc lưu.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60000;
}

// Tính toàn bộ số liệu chấm công của một ngày từ giờ vào/ra thực tế.
// checkOutAt = null khi nhân viên mới chỉ vào ca (hoặc quên ra ca).
export function computeAttendance(
  rules: ShiftRules,
  workDate: string,
  checkInAt: Date,
  checkOutAt: Date | null,
): AttendanceComputed {
  const start = vnTimeOn(workDate, rules.start_time);
  const end = vnTimeOn(workDate, rules.end_time);

  // Vào muộn: chỉ tính khi vào sau giờ ca. Vào sớm không tạo phút muộn.
  const lateMinutes = round2(Math.max(0, minutesBetween(start, checkInAt)));

  let status: AttendanceStatus;
  if (lateMinutes <= rules.grace_minutes) status = "on_time";
  else if (lateMinutes > rules.absent_after_minutes) status = "absent";
  else if (lateMinutes > rules.half_day_after_minutes) status = "half_day";
  else status = "late";

  if (!checkOutAt) {
    return {
      status,
      late_minutes: lateMinutes,
      early_minutes: null,
      work_minutes: null,
      work_units: null,
      ot_minutes: null,
      ot_status: null,
    };
  }

  // Công tính từ giờ ca (vào sớm không được tính sớm hơn giờ ca), đến giờ ra
  // thực tế, trừ phần trùng với giờ nghỉ.
  const countFrom = checkInAt > start ? checkInAt : start;
  let workMinutes = Math.max(0, minutesBetween(countFrom, checkOutAt));
  if (rules.break_start && rules.break_end) {
    const breakStart = vnTimeOn(workDate, rules.break_start);
    const breakEnd = vnTimeOn(workDate, rules.break_end);
    const overlapStart = countFrom > breakStart ? countFrom : breakStart;
    const overlapEnd = checkOutAt < breakEnd ? checkOutAt : breakEnd;
    workMinutes -= Math.max(0, minutesBetween(overlapStart, overlapEnd));
  }
  workMinutes = round2(Math.max(0, workMinutes));

  const earlyMinutes = round2(Math.max(0, minutesBetween(checkOutAt, end)));
  const otMinutes = round2(Math.max(0, minutesBetween(end, checkOutAt)));

  let workUnits: number | null = null;
  if (rules.loai_ca === "ngay") {
    workUnits = status === "absent" ? 0 : status === "half_day" ? 0.5 : 1;
  }

  return {
    status,
    late_minutes: lateMinutes,
    early_minutes: earlyMinutes,
    work_minutes: workMinutes,
    work_units: workUnits,
    ot_minutes: otMinutes,
    ot_status: otMinutes > 0 ? "pending" : null,
  };
}

// Bản ghi "vắng" cho ngày được phân ca nhưng không có check-in — do cron tạo
// sau khi ngày kết thúc.
export function computeAbsent(rules: ShiftRules): AttendanceComputed {
  return {
    status: "absent",
    late_minutes: 0,
    early_minutes: null,
    work_minutes: 0,
    work_units: rules.loai_ca === "ngay" ? 0 : null,
    ot_minutes: null,
    ot_status: null,
  };
}

// "08:00:00" (kiểu time của Postgres) → "08:00".
export function normalizeTime(t: string): string {
  return t.slice(0, 5);
}

// Kiểm tra định dạng "HH:MM" và các mốc hợp lệ của ca. Ca không qua nửa đêm.
export function validateShiftTimes(input: {
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
}): string | null {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!re.test(input.start_time) || !re.test(input.end_time)) return "Giờ vào/ra phải có dạng HH:MM";
  if (input.end_time <= input.start_time) return "Giờ ra phải sau giờ vào (ca không qua nửa đêm)";
  const hasBreakStart = !!input.break_start;
  const hasBreakEnd = !!input.break_end;
  if (hasBreakStart !== hasBreakEnd) return "Khoảng nghỉ cần đủ cả giờ bắt đầu và giờ kết thúc";
  if (hasBreakStart) {
    if (!re.test(input.break_start!) || !re.test(input.break_end!)) return "Giờ nghỉ phải có dạng HH:MM";
    if (input.break_end! <= input.break_start!) return "Giờ kết thúc nghỉ phải sau giờ bắt đầu nghỉ";
    if (input.break_start! < input.start_time || input.break_end! > input.end_time) {
      return "Khoảng nghỉ phải nằm trong giờ ca";
    }
  }
  return null;
}
