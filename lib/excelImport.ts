import ExcelJS from "exceljs";
import { supabaseAdmin } from "./supabaseServer";
import { CATEGORY_ORDER } from "./types";
import { stripXlsxDrawings } from "./stripXlsxDrawings";

export const SKIP_SHEETS = new Set([
  "HUONG DAN",
  "Master (Tổng hợp)",
  "Hướng dẫn nhập khẩu (MISA)",
  "Công cụ dụng cụ",
]);

export const COLUMN_TO_FIELD: Record<string, string> = {
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
  // Cấp đóng gói trung gian (Hộp) — chỉ số ít sản phẩm bán 3 cấp mới điền
  // (vd Bột Rau Câu), còn lại để trống như bình thường.
  "Đơn vị cấp 2 (Hộp)": "dvt_cap_2",
  "Tỷ lệ quy đổi cấp 2 (Gói/Túi → Hộp)": "ty_le_cap_2",
  "Giá Hộp": "gia_hop",
  "Thương hiệu": "thuong_hieu",
  "Nhà cung cấp": "nha_cung_cap",
  "Mã vạch": "ma_vach",
  "Mã thùng": "ma_thung",
  "Mã nhóm thay thế": "ma_nhom_thay_the",
  "Trạng thái": "trang_thai",
  "Xuất xứ": "xuat_xu",
};

export const NUMERIC_FIELDS = new Set(["gia_ban", "gia_thung", "ty_le", "ty_le_cap_2", "gia_hop"]);

export type ImportMode = "new-only" | "update-all";

export type UpsertSummary = {
  newCount: number;
  existingCount: number;
  brandsUpserted: number;
};

export type ImportSummary = UpsertSummary & { skippedSheets: string[]; skippedIncomplete: number };

// row_number is 1-based, matching the row as it appears in the source
// spreadsheet — only used to point at exactly which row a duplicate-check
// error refers to; stripped back out before the DB upsert (not a real column).
export type ProductRow = Record<string, string | number | null> & { category_sheet: string; row_number: number };

// Google Sheets sometimes appends a disambiguation suffix to a tab name
// (e.g. "Trà (76,18,77,78)") after a copy/merge conflict — strip a trailing
// parenthetical and retry before giving up on a sheet that would otherwise
// silently get skipped despite genuinely being one of our categories.
export function resolveCategoryName(sheetName: string): string | null {
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
export async function importProductsFromWorkbook(buffer: Buffer, mode: ImportMode = "new-only"): Promise<ImportSummary> {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const cleaned = await stripXlsxDrawings(arrayBuffer);
  // exceljs's own .d.ts redeclares an ambient `Buffer extends ArrayBuffer`, which
  // conflicts with @types/node's real Buffer under TS's newer resizable-ArrayBuffer
  // typings — cast to sidestep that bad third-party type, not a real type issue.
  await workbook.xlsx.load(Buffer.from(cleaned) as any);

  const rows: ProductRow[] = [];
  const skippedSheets: string[] = [];
  let skippedIncomplete = 0;

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
      const record: ProductRow = { category_sheet: category, row_number: rowNumber };
      let hasMaNoiBo = false;
      let hasTenHangHoa = false;
      fieldByCol.forEach((field, colNumber) => {
        const value = cellValue(row.getCell(colNumber).value);
        if (field === "ma_noi_bo" && value) hasMaNoiBo = true;
        if (field === "ten_hang_hoa" && value) hasTenHangHoa = true;
        record[field] = NUMERIC_FIELDS.has(field) && value !== null ? Number(value) : value;
      });
      // Chỉ nhập dòng có đủ cả Mã hàng hóa lẫn Tên hàng hóa — thiếu 1 trong 2
      // thì bỏ qua dòng đó thay vì chặn cả file (dòng hoàn toàn trống thì
      // không tính là "thiếu", chỉ là dòng rỗng bình thường trong sheet).
      if (hasMaNoiBo && hasTenHangHoa) rows.push(record);
      else if (hasMaNoiBo || hasTenHangHoa) skippedIncomplete++;
    });
  }

  const summary = await upsertProductRows(rows, mode);
  return { ...summary, skippedSheets, skippedIncomplete };
}

// Fail fast with a clear message: an upsert can't apply two rows with the
// same conflict key (ma_noi_bo) in one statement, and a raw unique-index
// violation (ma_noi_bo, but also ma_vach/ma_thung which the DB also
// enforces as unique) doesn't say which rows collided — so check every one
// of these before hitting the database at all.
function checkDuplicates(rows: ProductRow[], field: "ma_noi_bo" | "ma_vach" | "ma_thung", label: string) {
  const occurrencesByValue = new Map<string, { sheet: string; row: number }[]>();
  for (const r of rows) {
    const value = r[field];
    if (!value) continue;
    const occurrences = occurrencesByValue.get(String(value)) ?? [];
    occurrences.push({ sheet: r.category_sheet, row: r.row_number });
    occurrencesByValue.set(String(value), occurrences);
  }
  const duplicates = [...occurrencesByValue.entries()].filter(([, occurrences]) => occurrences.length > 1);
  if (duplicates.length > 0) {
    // Report sheet + row per occurrence (not just the sheet name repeated) —
    // otherwise "2 lần, sheet: Trà, Trà" reads as if there were 2 different
    // "Trà" sheets, when it actually means 2 different rows in that one sheet.
    const detail = duplicates
      .map(([value, occurrences]) => {
        const locations = occurrences.map((o) => `${o.sheet} dòng ${o.row}`).join(", ");
        return `"${value}" (${occurrences.length} lần: ${locations})`;
      })
      .join("; ");
    throw new Error(`Dữ liệu có ${label} bị trùng, cần sửa trước khi nhập: ${detail}`);
  }
}

// Shared by both the Excel import and the Google Sheet sync: takes rows
// already parsed into our column shape and upserts them into `products`.
//
// `mode` controls what happens to rows whose Mã nội bộ already exists:
// - "new-only": only inserts genuinely new products, leaves existing ones
//   untouched. Protects against a "hợp nhất" master file that only added a
//   few new products from silently overwriting everything else with
//   whatever's currently in that file (prices, names, codes) — the exact
//   kind of mass-reimport data loss that's bitten this shop before.
// - "update-all": upserts every row, overwriting existing products with the
//   source's values — for when the source really is the source of truth to
//   sync from (deliberate bulk corrections, or the Google Sheet sync).
export async function upsertProductRows(rows: ProductRow[], mode: ImportMode): Promise<UpsertSummary> {
  checkDuplicates(rows, "ma_noi_bo", "Mã nội bộ");
  checkDuplicates(rows, "ma_vach", "Mã vạch");
  checkDuplicates(rows, "ma_thung", "Mã thùng");

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

  let productRows: (Record<string, string | number | null> & { brand_id: string | null })[] = rows.map(
    ({ thuong_hieu, nha_cung_cap, row_number, ...rest }) => ({
      ...rest,
      brand_id: typeof thuong_hieu === "string" ? brandIdByName.get(thuong_hieu) ?? null : null,
    })
  );

  // Find which of the file's Mã nội bộ values already exist, batched to stay
  // well under any reasonable IN-clause size.
  const existingSet = new Set<string>();
  const allCodes = productRows.map((r) => r.ma_noi_bo as string);
  const LOOKUP_BATCH = 200;
  for (let i = 0; i < allCodes.length; i += LOOKUP_BATCH) {
    const chunk = allCodes.slice(i, i + LOOKUP_BATCH);
    const { data: existing, error: existingError } = await supabase
      .from("products")
      .select("ma_noi_bo")
      .in("ma_noi_bo", chunk);
    if (existingError) throw new Error(`Kiểm tra sản phẩm đã tồn tại thất bại: ${existingError.message}`);
    for (const row of existing ?? []) existingSet.add(row.ma_noi_bo as string);
  }

  const newCount = productRows.filter((r) => !existingSet.has(r.ma_noi_bo as string)).length;
  const existingCount = productRows.length - newCount;

  if (mode === "new-only") {
    productRows = productRows.filter((r) => !existingSet.has(r.ma_noi_bo as string));
  }

  const BATCH = 200;
  for (let i = 0; i < productRows.length; i += BATCH) {
    const chunk = productRows.slice(i, i + BATCH);
    const { error } = await supabase.from("products").upsert(chunk, { onConflict: "ma_noi_bo" });
    if (error) throw new Error(`Nhập sản phẩm thất bại (dòng ${i + 1}-${i + chunk.length}): ${error.message}`);
  }

  return { newCount, existingCount, brandsUpserted: brandNames.length };
}
