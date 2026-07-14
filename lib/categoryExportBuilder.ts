import ExcelJS from "exceljs";
import { CATEGORY_ORDER, Product } from "./types";

const LOAI_HANG_HOA_MAC_DINH = "Hàng hóa thường";

const HEADER = [
  "Mã hàng hóa", "Tên hàng hóa (gốc)", "Tên trên hóa đơn", "Đơn vị tính",
  "Giá bán lẻ", "Giá thùng", "Quy cách thùng", "Tỷ lệ quy đổi",
  "Thương hiệu", "Nhà cung cấp", "Mã vạch",
  "Mã thùng", "Loại hàng hóa", "Trạng thái", "Xuất xứ",
];

function toRow(p: Product): (string | number | null)[] {
  const brandName = p.brand?.name ?? null;
  return [
    p.ma_noi_bo, p.ten_hang_hoa, p.ten_hoa_don, p.dvt,
    p.gia_ban, p.gia_thung, p.quy_cach, p.ty_le,
    brandName, brandName, p.ma_vach,
    p.ma_thung, LOAI_HANG_HOA_MAC_DINH, p.trang_thai, p.xuat_xu,
  ];
}

// Mirrors "Misa hàng hóa/2. Danh sách theo loại sản phẩm.xlsx": one sheet per
// category, full catalog every time.
export async function buildCategoryExport(products: Product[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const byCategory = new Map<string, Product[]>();
  for (const p of products) {
    const list = byCategory.get(p.category_sheet) ?? [];
    list.push(p);
    byCategory.set(p.category_sheet, list);
  }

  for (const category of CATEGORY_ORDER) {
    const sheet = workbook.addWorksheet(category);
    sheet.addRow(HEADER);
    sheet.getRow(1).font = { bold: true };
    for (const p of byCategory.get(category) ?? []) {
      sheet.addRow(toRow(p));
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
