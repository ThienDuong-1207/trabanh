import ExcelJS from "exceljs";
import { supabaseAdmin } from "./supabaseServer";
import { CATEGORY_ORDER } from "./types";

const SKIP_SHEETS = new Set(["HUONG DAN", "Master (Tổng hợp)", "Hướng dẫn nhập khẩu (MISA)"]);

const COLUMN_TO_FIELD: Record<string, string> = {
  "Mã nội bộ": "ma_noi_bo",
  "Mã hàng hóa": "ma_noi_bo", // alternate header used by the xuất-nhập-tồn report format
  "Tên hàng hóa (gốc)": "ten_hang_hoa",
  "Tên hàng hóa": "ten_hang_hoa", // alternate header, same report format
  "Tên trên hóa đơn": "ten_hoa_don",
  "Tên hàng hóa trên Hóa đơn": "ten_hoa_don", // alternate header, same report format
  "Đơn vị tính": "dvt",
  "Giá bán lẻ": "gia_ban",
  "Giá thùng": "gia_thung",
  "Quy cách thùng": "quy_cach",
  "Tỷ lệ quy đổi": "ty_le",
  "Thương hiệu": "thuong_hieu",
  "Nhà cung cấp": "nha_cung_cap",
  "Mã vạch": "ma_vach",
  "Mã thùng": "ma_thung",
  "Mã nhóm thay thế": "ma_nhom_thay_the",
  "Trạng thái": "trang_thai",
  "Xuất xứ": "xuat_xu",
};

const NUMERIC_FIELDS = new Set(["gia_ban", "gia_thung", "ty_le"]);

export type ImportSummary = {
  productsUpserted: number;
  brandsUpserted: number;
  skippedSheets: string[];
};

// Google Sheets sometimes appends a disambiguation suffix to a tab name
// (e.g. "Trà (76,18,77,78)") after a copy/merge conflict — strip a trailing
// parenthetical and retry before giving up on a sheet that would otherwise
// silently get skipped despite genuinely being one of our categories.
function resolveCategoryName(sheetName: string): string | null {
  if (CATEGORY_ORDER.includes(sheetName)) return sheetName;
  const stripped = sheetName.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return CATEGORY_ORDER.includes(stripped) ? stripped : null;
}

function cellValue(raw: ExcelJS.CellValue): string | number | null {
  const value = raw && typeof raw === "object" && "result" in raw ? (raw as { result: unknown }).result : raw;
  if (value === undefined || value === null || value === "") return null;
  return value as string | number;
}

// Parses a workbook shaped like "Misa hàng hóa/1. Quản lý hàng hóa hợp nhất.xlsx":
// one sheet per CATEGORY_ORDER entry, columns matching COLUMN_TO_FIELD headers.
export async function importProductsFromWorkbook(buffer: Buffer): Promise<ImportSummary> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's own .d.ts redeclares an ambient `Buffer extends ArrayBuffer`, which
  // conflicts with @types/node's real Buffer under TS's newer resizable-ArrayBuffer
  // typings — cast to sidestep that bad third-party type, not a real type issue.
  await workbook.xlsx.load(buffer as any);

  const rows: Record<string, string | number | null>[] = [];
  const skippedSheets: string[] = [];

  for (const worksheet of workbook.worksheets) {
    const name = worksheet.name;
    if (SKIP_SHEETS.has(name)) continue;
    const category = resolveCategoryName(name);
    if (!category) {
      skippedSheets.push(name);
      continue;
    }

    const fieldByCol = new Map<number, string>();
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const field = COLUMN_TO_FIELD[String(cell.value ?? "").trim()];
      if (field) fieldByCol.set(colNumber, field);
    });

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: Record<string, string | number | null> = { category_sheet: category };
      let hasMaNoiBo = false;
      fieldByCol.forEach((field, colNumber) => {
        const value = cellValue(row.getCell(colNumber).value);
        if (field === "ma_noi_bo" && value) hasMaNoiBo = true;
        record[field] = NUMERIC_FIELDS.has(field) && value !== null ? Number(value) : value;
      });
      if (hasMaNoiBo) rows.push(record);
    });
  }

  // Fail fast with a clear message: an upsert can't apply two rows with the
  // same conflict key (ma_noi_bo) in one statement, and a raw unique-index
  // violation (ma_noi_bo, but also ma_vach/ma_thung which the DB also
  // enforces as unique) doesn't say which rows collided — so check every
  // one of these before hitting the database at all.
  function checkDuplicates(field: "ma_noi_bo" | "ma_vach" | "ma_thung", label: string) {
    const sheetsByValue = new Map<string, string[]>();
    for (const r of rows) {
      const value = r[field];
      if (!value) continue;
      const sheets = sheetsByValue.get(String(value)) ?? [];
      sheets.push(r.category_sheet as string);
      sheetsByValue.set(String(value), sheets);
    }
    const duplicates = [...sheetsByValue.entries()].filter(([, sheets]) => sheets.length > 1);
    if (duplicates.length > 0) {
      const detail = duplicates.map(([value, sheets]) => `"${value}" (${sheets.length} lần, sheet: ${sheets.join(", ")})`).join("; ");
      throw new Error(`File có ${label} bị trùng, cần sửa trong Excel trước khi nhập: ${detail}`);
    }
  }
  checkDuplicates("ma_noi_bo", "Mã nội bộ");
  checkDuplicates("ma_vach", "Mã vạch");
  checkDuplicates("ma_thung", "Mã thùng");

  const supabase = supabaseAdmin();

  const brandNames = [...new Set(rows.map((r) => r.thuong_hieu).filter((v): v is string => typeof v === "string" && v.length > 0))];
  if (brandNames.length > 0) {
    const { error } = await supabase.from("brands").upsert(
      brandNames.map((name) => ({ name })),
      { onConflict: "name" }
    );
    if (error) throw new Error(`Lưu thương hiệu thất bại: ${error.message}`);
  }

  const { data: brands, error: brandsFetchError } = await supabase.from("brands").select("id, name");
  if (brandsFetchError) throw new Error(`Không đọc được danh sách thương hiệu: ${brandsFetchError.message}`);
  const brandIdByName = new Map((brands ?? []).map((b) => [b.name as string, b.id as string]));

  const productRows = rows.map(({ thuong_hieu, nha_cung_cap, ...rest }) => ({
    ...rest,
    brand_id: typeof thuong_hieu === "string" ? brandIdByName.get(thuong_hieu) ?? null : null,
  }));

  const BATCH = 200;
  for (let i = 0; i < productRows.length; i += BATCH) {
    const chunk = productRows.slice(i, i + BATCH);
    const { error } = await supabase.from("products").upsert(chunk, { onConflict: "ma_noi_bo" });
    if (error) throw new Error(`Nhập sản phẩm thất bại (dòng ${i + 1}-${i + chunk.length}): ${error.message}`);
  }

  return { productsUpserted: productRows.length, brandsUpserted: brandNames.length, skippedSheets };
}
