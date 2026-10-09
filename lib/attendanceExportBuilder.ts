import ExcelJS from "exceljs";

// File Excel chấm công 1 nhân viên (hoặc nhiều, khi không lọc theo tên) để
// kế toán tính lương — xem app/views/AttendanceManagementView.tsx.
export type AttendanceExportRow = {
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: string | null;
  late_minutes: number | null;
  early_minutes: number | null;
  work_minutes: number | null;
  work_units: number | null;
  ot_minutes: number | null;
  ot_status: string | null;
  flags: string[] | null;
  employee: { display_name: string | null; username: string | null; chuc_danh: string | null } | null;
  shift: { name: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  on_time: "Đúng giờ",
  late: "Đi trễ",
  half_day: "Nửa ca",
  absent: "Vắng",
};

const HEADER = [
  "Nhân viên",
  "Chức danh",
  "Ca",
  "Ngày",
  "Giờ vào",
  "Giờ ra",
  "Trạng thái",
  "Phút trễ",
  "Phút về sớm",
  "Phút công",
  "Công (ngày)",
  "Phút tăng ca",
  "Duyệt tăng ca",
  "Cờ cảnh báo",
];

function timeOf(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

export async function buildAttendanceExcel(rows: AttendanceExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Chấm công");
  sheet.addRow(HEADER).font = { bold: true };
  sheet.columns = [
    { width: 20 }, { width: 14 }, { width: 16 }, { width: 11 }, { width: 9 }, { width: 9 },
    { width: 11 }, { width: 9 }, { width: 11 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 24 },
  ];
  for (const r of rows) {
    sheet.addRow([
      r.employee?.display_name || r.employee?.username || "—",
      r.employee?.chuc_danh ?? "",
      r.shift?.name ?? "",
      r.work_date,
      timeOf(r.check_in_at),
      timeOf(r.check_out_at),
      r.status ? STATUS_LABEL[r.status] ?? r.status : "",
      r.late_minutes ?? "",
      r.early_minutes ?? "",
      r.work_minutes ?? "",
      r.work_units ?? "",
      r.ot_minutes ?? "",
      r.ot_status === "pending" ? "Chờ duyệt" : r.ot_status === "approved" ? "Đã duyệt" : r.ot_status === "rejected" ? "Từ chối" : "",
      (r.flags ?? []).join(", "),
    ]);
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
