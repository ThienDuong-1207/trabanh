import ExcelJS from "exceljs";

// Dữ liệu thô (không dùng công thức Excel) — đây là file xuất/lưu trữ 1 lần,
// không phải model cần tính lại khi sửa số, nên ghi thẳng giá trị đã tính sẵn
// cho Tháng/Quý/Năm/% thay đổi là đủ và đơn giản hơn.
export type PriceHistoryExportRow = {
  changed_at: string;
  gia_ban_old: number | null;
  gia_ban_new: number | null;
  gia_thung_old: number | null;
  gia_thung_new: number | null;
  product: { ma_noi_bo: string; ten_hang_hoa: string; category_sheet: string } | null;
};

const HEADER = [
  "Mã nội bộ",
  "Tên hàng hóa",
  "Nhóm hàng",
  "Giá lẻ cũ",
  "Giá lẻ mới",
  "% thay đổi giá lẻ",
  "Giá thùng cũ",
  "Giá thùng mới",
  "% thay đổi giá thùng",
  "Ngày đổi giá",
  "Tháng",
  "Quý",
  "Năm",
];

// null khi không đủ dữ liệu để tính (giá cũ = 0 hoặc chưa từng có giá) —
// tránh chia cho 0 / % thay đổi vô nghĩa.
function percentChange(oldV: number | null, newV: number | null): number | null {
  if (oldV === null || newV === null || oldV === 0) return null;
  return (newV - oldV) / oldV;
}

function toRow(h: PriceHistoryExportRow): (string | number | Date | null)[] {
  const d = new Date(h.changed_at);
  const month = d.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  const year = d.getFullYear();
  return [
    h.product?.ma_noi_bo ?? null,
    h.product?.ten_hang_hoa ?? "(sản phẩm đã xóa)",
    h.product?.category_sheet ?? null,
    h.gia_ban_old,
    h.gia_ban_new,
    percentChange(h.gia_ban_old, h.gia_ban_new),
    h.gia_thung_old,
    h.gia_thung_new,
    percentChange(h.gia_thung_old, h.gia_thung_new),
    d,
    `${String(month).padStart(2, "0")}/${year}`,
    `Q${quarter}/${year}`,
    year,
  ];
}

export async function buildPriceHistoryExcel(rows: PriceHistoryExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Lịch sử giá");
  sheet.addRow(HEADER);
  sheet.getRow(1).font = { bold: true };
  for (const h of rows) sheet.addRow(toRow(h));

  // % thay đổi: định dạng phần trăm 1 số lẻ; ngày đổi giá: định dạng ngày giờ
  // Việt Nam — cả 2 cột số/ngày thô đã ghi ở trên, chỉ đổi cách hiển thị.
  sheet.getColumn(6).numFmt = "0.0%";
  sheet.getColumn(9).numFmt = "0.0%";
  sheet.getColumn(10).numFmt = "dd/mm/yyyy hh:mm";

  sheet.columns.forEach((col) => {
    col.width = 18;
  });
  sheet.getColumn(2).width = 32;

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
