import ExcelJS from "exceljs";
import path from "path";
import { supabaseAdmin } from "./supabaseServer";

const TEMPLATE_PATH = path.join(process.cwd(), "public", "templates", "Nhap_khau_chi_tiet_hang_hoa_chuyen_kho.xlsx");
const SHEET_NAME = "Nhập khẩu hàng hóa xuất kho";
// Khớp đúng list "_hidden_stocks" trong file mẫu Misa — dropdown Kho xuất/Kho
// nhập yêu cầu đúng định dạng "<mã kho> | <tên kho>", không phải tên trơn.
const KHO_XUAT = "001 | Kho mặc định";
const KHO_NHAP = "002 | SHOPEE";
const FIRST_DATA_ROW = 6; // hàng 1-5 là tiêu đề/hướng dẫn của file mẫu, giữ nguyên
const TEMPLATE_SAMPLE_ROWS = 3; // 3 dòng mẫu (MH00001..) có sẵn trong file gốc, cần xoá trước khi ghi dữ liệu thật

// Trạng thái coi là "chưa thực sự rời kho" — loại khỏi mọi lần tính, dù có
// đúng ngày làm việc đang chọn hay không. Xác nhận bằng dữ liệu thật: khi
// còn ở trạng thái này, "Thời gian giao hàng" luôn trống (chưa quét mã);
// "Ngày gửi hàng" (nếu có) chỉ là hạn chót Shopee đặt ra, không phải ngày
// đã giao thật — không dùng cột đó để tính.
const PENDING_STATUS = "chờ giao hàng";
// Giờ chốt ca làm việc thật của tiệm — không đóng gói thêm sau giờ này.
// "Ngày làm việc X" = khoảng [17:00 ngày X-1, 17:00 ngày X) theo "Thời gian
// giao hàng", KHÔNG phải theo ngày lịch (00:00-23:59).
const SHIFT_CUTOFF_HOUR = 17;

export type ShopeeOrderRow = {
  ten_san_pham: string;
  ten_phan_loai: string | null;
  so_luong: number;
  trang_thai: string | null;
  thoi_gian_giao_hang: string | null; // giữ nguyên dạng "YYYY-MM-DD HH:mm[:ss]" đọc từ file, không parse thành Date để tránh lệch múi giờ server
};

export type TransferKhoRow = {
  ma_noi_bo: string;
  ten_hang_hoa: string;
  dvt: string | null;
  so_luong: number;
};

export type TransferKhoResult = {
  file: Buffer;
  rows: TransferKhoRow[];
  unmatched: ShopeeOrderRow[];
  excludedPendingCount: number; // số dòng bị loại vì còn "Chờ giao hàng" — hiển thị cho người dùng yên tâm không phải bị bỏ sót
  excludedOutOfWindowCount: number; // số dòng có Thời gian giao hàng nhưng rơi ngoài khoảng ngày làm việc đã chọn
};

// Cụm chỉ nói số lượng ("Combo 2 túi", "1 hộp"...) chứ không phải hương vị —
// nhận diện bằng việc mở đầu bằng "Combo <số>" hoặc "<số> <từ>", để không
// nhầm với hương vị viết liền không dấu phẩy như "Vị hạnh nhân".
const QTY_PHRASE_RE = /^\s*(combo\s+\d+.*|\d+\s+\S+.*)\s*$/i;

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// Tách phần hương vị ra khỏi "Tên phân loại hàng" của Shopee (dạng
// "Oatside,Combo 2 hộp" hoặc chỉ "Combo 2 hộp"/"1 túi" nếu sản phẩm chỉ có
// 1 loại) — bỏ cụm số lượng ở cuối, giữ lại phần còn lại nếu có.
export function extractFlavor(variationName: string | null): string | null {
  if (!variationName) return null;
  const parts = variationName.split(",").map((p) => p.trim());
  while (parts.length && QTY_PHRASE_RE.test(parts[parts.length - 1])) parts.pop();
  const flavor = parts.join(",").trim();
  return flavor || null;
}

export function buildShopeeKey(productName: string, variationName: string | null): string {
  const flavor = extractFlavor(variationName);
  const base = flavor ? `${productName.trim()},${flavor}` : productName.trim();
  return normalize(base);
}

// Lấy hệ số nhân từ cụm số lượng ở cuối "Tên phân loại hàng" — không chỉ
// nhận diện đúng chữ "combo" (VD "Combo 2 túi") mà cả cách viết khác cùng
// dạng "<số> <từ>" ở cuối (VD "Lốc 6 chai", "Set 3") nếu seller đặt tên
// không dùng từ "combo" — dùng chung QTY_PHRASE_RE với extractFlavor() để cả
// 2 hàm luôn thống nhất "đâu là cụm số lượng", tránh lệch nhau khi 1 bên sửa
// mà quên sửa bên kia.
export function extractComboMultiplier(variationName: string | null): number {
  if (!variationName) return 1;
  const parts = variationName.split(",").map((p) => p.trim());
  const last = parts[parts.length - 1] ?? "";
  if (!QTY_PHRASE_RE.test(last)) return 1;
  const m = last.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

// Số nguyên có thể so sánh trực tiếp (yyyy*1e8 + mm*1e6 + dd*1e4 + hh*1e2 + mi)
// — cố tình KHÔNG dùng đối tượng Date: chuỗi "Thời gian giao hàng" trong file
// Shopee là giờ Việt Nam không kèm múi giờ, nếu parse qua `new Date(...)` sẽ
// bị hiểu theo múi giờ của máy chủ chạy code (thường là UTC trên Vercel),
// lệch hẳn 7 tiếng so với giờ thật. Tách số trực tiếp từ chuỗi tránh hoàn
// toàn vấn đề này.
type TimeKey = number;

function parseTimeKey(raw: string | null): TimeKey | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return Number(y) * 100000000 + Number(mo) * 1000000 + Number(d) * 10000 + Number(h) * 100 + Number(mi);
}

// "Ngày làm việc X" = khoảng [17:00 ngày X-1, 17:00 ngày X). Dùng Date.UTC +
// getUTC* thuần túy để cộng/trừ 1 ngày lịch — chỉ dùng Date ở đây như một bộ
// đếm ngày trừu tượng (không đại diện 1 thời điểm thật), nên không bị ảnh
// hưởng bởi múi giờ máy chủ.
function shiftWindowKeys(targetDateStr: string): { startKey: TimeKey; endKey: TimeKey } {
  const m = targetDateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Ngày làm việc không hợp lệ: "${targetDateStr}" (cần dạng YYYY-MM-DD)`);
  const [, y, mo, d] = m;
  const targetUTC = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const prevUTC = targetUTC - 24 * 60 * 60 * 1000;
  const keyFor = (epochMs: number) => {
    const dt = new Date(epochMs);
    return (
      dt.getUTCFullYear() * 100000000 +
      (dt.getUTCMonth() + 1) * 1000000 +
      dt.getUTCDate() * 10000 +
      SHIFT_CUTOFF_HOUR * 100
    );
  };
  return { startKey: keyFor(prevUTC), endKey: keyFor(targetUTC) };
}

type ProductLookupEntry = { ma_noi_bo: string; ten_hang_hoa: string; dvt: string | null };

// 1 giá trị Tên Shopee (khoá) có thể trỏ tới NHIỀU mã hàng hóa — dùng cho
// combo gồm nhiều sản phẩm khác nhau (SET COMBO), nơi mỗi mã thành phần đều
// ghi cùng 1 giá trị Tên Shopee của combo đó vào cột "Tên Shopee" của mình.
async function buildShopeeLookup(): Promise<Map<string, ProductLookupEntry[]>> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.from("products").select("ma_noi_bo, ten_hang_hoa, dvt, ten_shopee").not("ten_shopee", "is", null);
  if (error) throw new Error(`Không đọc được danh sách sản phẩm: ${error.message}`);

  const map = new Map<string, ProductLookupEntry[]>();
  for (const p of data ?? []) {
    const raw = p.ten_shopee as string | null;
    if (!raw) continue;
    const entries = raw
      .split(/[;\n]/)
      .map((e) => e.trim())
      .filter(Boolean);
    for (const entry of entries) {
      const key = normalize(entry);
      const list = map.get(key) ?? [];
      list.push({ ma_noi_bo: p.ma_noi_bo as string, ten_hang_hoa: p.ten_hang_hoa as string, dvt: (p.dvt as string | null) ?? null });
      map.set(key, list);
    }
  }
  return map;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && "result" in (v as unknown as Record<string, unknown>)) {
    return String((v as unknown as { result: unknown }).result ?? "").trim();
  }
  return String(v).trim();
}

// Đọc file đơn hàng giao theo ngày export từ Shopee — cần đúng 5 cột "Tên
// sản phẩm", "Tên phân loại hàng", "Số lượng", "Trạng Thái Đơn Hàng", "Thời
// gian giao hàng" (dò theo tên cột ở hàng tiêu đề, không phụ thuộc thứ tự/số
// lượng cột khác của file gốc).
export async function parseShopeeOrderWorkbook(buffer: Buffer): Promise<ShopeeOrderRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("File đơn hàng không có sheet nào");

  const colByHeader = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const text = cellText(cell);
    if (text) colByHeader.set(text, colNumber);
  });

  const colTenSp = colByHeader.get("Tên sản phẩm");
  const colTenPhanLoai = colByHeader.get("Tên phân loại hàng");
  const colSoLuong = colByHeader.get("Số lượng");
  const colTrangThai = colByHeader.get("Trạng Thái Đơn Hàng");
  const colThoiGianGiao = colByHeader.get("Thời gian giao hàng");
  if (!colTenSp || !colSoLuong || !colTrangThai || !colThoiGianGiao) {
    throw new Error(
      'File đơn hàng thiếu cột "Tên sản phẩm"/"Số lượng"/"Trạng Thái Đơn Hàng"/"Thời gian giao hàng" — kiểm tra lại đúng file export đơn hàng giao từ Shopee'
    );
  }

  const rows: ShopeeOrderRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const tenSanPham = cellText(row.getCell(colTenSp));
    if (!tenSanPham) continue;
    const tenPhanLoai = colTenPhanLoai ? cellText(row.getCell(colTenPhanLoai)) || null : null;
    const soLuong = Number(cellText(row.getCell(colSoLuong)));
    if (!Number.isFinite(soLuong) || soLuong <= 0) continue;
    const trangThai = cellText(row.getCell(colTrangThai)) || null;
    const thoiGianGiao = cellText(row.getCell(colThoiGianGiao)) || null;
    rows.push({ ten_san_pham: tenSanPham, ten_phan_loai: tenPhanLoai, so_luong: soLuong, trang_thai: trangThai, thoi_gian_giao_hang: thoiGianGiao });
  }
  return rows;
}

// targetDate: "YYYY-MM-DD" — ngày làm việc muốn tính (khoảng 17:00 hôm
// trước → 17:00 ngày này, xem shiftWindowKeys).
export async function buildTransferKhoFile(orderRows: ShopeeOrderRow[], targetDate: string): Promise<TransferKhoResult> {
  const { startKey, endKey } = shiftWindowKeys(targetDate);
  const lookup = await buildShopeeLookup();

  const aggregated = new Map<string, TransferKhoRow>();
  const unmatched = new Map<string, ShopeeOrderRow>();
  let excludedPendingCount = 0;
  let excludedOutOfWindowCount = 0;

  for (const row of orderRows) {
    if (row.trang_thai && normalize(row.trang_thai) === PENDING_STATUS) {
      excludedPendingCount++;
      continue;
    }
    const timeKey = parseTimeKey(row.thoi_gian_giao_hang);
    if (timeKey === null || timeKey < startKey || timeKey >= endKey) {
      excludedOutOfWindowCount++;
      continue;
    }

    const key = buildShopeeKey(row.ten_san_pham, row.ten_phan_loai);
    const matches = lookup.get(key);
    if (!matches || matches.length === 0) {
      const unmatchedKey = `${row.ten_san_pham}|||${row.ten_phan_loai ?? ""}`;
      const existing = unmatched.get(unmatchedKey);
      if (existing) existing.so_luong += row.so_luong;
      else unmatched.set(unmatchedKey, { ...row });
      continue;
    }
    const multiplier = extractComboMultiplier(row.ten_phan_loai);
    for (const match of matches) {
      const soLuong = row.so_luong * multiplier;
      const existing = aggregated.get(match.ma_noi_bo);
      if (existing) existing.so_luong += soLuong;
      else aggregated.set(match.ma_noi_bo, { ma_noi_bo: match.ma_noi_bo, ten_hang_hoa: match.ten_hang_hoa, dvt: match.dvt, so_luong: soLuong });
    }
  }

  const rows = Array.from(aggregated.values()).sort((a, b) => a.ma_noi_bo.localeCompare(b.ma_noi_bo));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw new Error(`File mẫu thiếu sheet "${SHEET_NAME}"`);

  // Xoá 3 dòng dữ liệu mẫu có sẵn (MH00001...) trước khi ghi dữ liệu thật.
  for (let i = 0; i < TEMPLATE_SAMPLE_ROWS; i++) {
    const r = sheet.getRow(FIRST_DATA_ROW + i);
    for (let c = 1; c <= 11; c++) r.getCell(c).value = null;
  }

  rows.forEach((row, i) => {
    const r = sheet.getRow(FIRST_DATA_ROW + i);
    r.getCell(1).value = row.ma_noi_bo; // Mã hàng hóa (*)
    r.getCell(3).value = row.ten_hang_hoa; // Tên hàng hóa
    r.getCell(6).value = KHO_XUAT; // Kho xuất (*)
    r.getCell(8).value = KHO_NHAP; // Kho nhập (*)
    r.getCell(10).value = row.dvt ?? ""; // Đơn vị tính (*)
    r.getCell(11).value = row.so_luong; // Số lượng (*)
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return {
    file: Buffer.from(arrayBuffer),
    rows,
    unmatched: Array.from(unmatched.values()),
    excludedPendingCount,
    excludedOutOfWindowCount,
  };
}
