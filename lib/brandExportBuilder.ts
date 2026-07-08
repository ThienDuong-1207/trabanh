import ExcelJS from "exceljs";
import { Product } from "./types";

const CHUA_XAC_DINH_NCC = "CHƯA XÁC ĐỊNH NCC";

const HEADER = [
  "Mã hàng hóa", "Tên trên hóa đơn", "Đơn vị tính", "Giá bán lẻ", "Giá Thùng",
  "Quy Cách", "Tỷ lệ quy đổi", "Mã vạch (lẻ)", "Mã vạch (thùng)", "Ghi chú",
];

// Excel sheet names: max 31 chars, no : \ / ? * [ ]
function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31).trim() || "Khác";
}

function toRow(p: Product): (string | number | null)[] {
  return [
    p.ma_noi_bo, p.ten_hoa_don || p.ten_hang_hoa, p.dvt, p.gia_ban, p.gia_thung,
    p.quy_cach, p.ty_le, p.ma_vach, p.ma_thung, null,
  ];
}

function hasQuyCach(p: Product): boolean {
  return Boolean(p.quy_cach && p.ty_le);
}

// Mirrors "Misa hàng hóa/3. Danh sách SP theo thương hiệu.xlsx": one sheet
// per brand + a bucket for products with no brand + a summary sheet.
export async function buildBrandExport(products: Product[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const byBrand = new Map<string, Product[]>();
  const unassigned: Product[] = [];
  for (const p of products) {
    const brandName = p.brand?.name;
    if (!brandName) {
      unassigned.push(p);
      continue;
    }
    const list = byBrand.get(brandName) ?? [];
    list.push(p);
    byBrand.set(brandName, list);
  }

  const brandNames = [...byBrand.keys()].sort((a, b) => a.localeCompare(b, "vi"));
  const summaryRows: [string, number, number, number][] = [];

  for (const brandName of brandNames) {
    const items = byBrand.get(brandName)!;
    const sheet = workbook.addWorksheet(safeSheetName(brandName));
    sheet.addRow(HEADER);
    sheet.getRow(1).font = { bold: true };
    for (const p of items) sheet.addRow(toRow(p));

    const complete = items.filter(hasQuyCach).length;
    summaryRows.push([brandName, items.length, complete, items.length - complete]);
  }

  if (unassigned.length > 0) {
    const sheet = workbook.addWorksheet(safeSheetName(CHUA_XAC_DINH_NCC));
    sheet.addRow(HEADER);
    sheet.getRow(1).font = { bold: true };
    for (const p of unassigned) sheet.addRow(toRow(p));

    const complete = unassigned.filter(hasQuyCach).length;
    summaryRows.push([CHUA_XAC_DINH_NCC, unassigned.length, complete, unassigned.length - complete]);
  }

  const summarySheet = workbook.addWorksheet("TỔNG QUAN");
  summarySheet.addRow(["Sheet (Thương hiệu/NCC)", "Số sản phẩm", "Đã có Quy cách/Giá thùng", "Còn thiếu"]);
  summarySheet.getRow(1).font = { bold: true };
  for (const row of summaryRows) summarySheet.addRow(row);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
