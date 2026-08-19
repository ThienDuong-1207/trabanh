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
// Trạng thái "khách đã nhận hàng nhưng còn trong hạn được yêu cầu trả
// hàng/hoàn tiền" — khác PENDING_STATUS ở chỗ hàng ĐÃ rời kho vật lý thật
// (khách đã cầm hàng), nhưng theo yêu cầu kinh doanh vẫn loại khỏi phiếu
// chuyển kho vì chưa coi là "bán chắc chắn" cho tới khi hết hạn trả hàng —
// xác nhận trực tiếp với chủ tiệm (không phải suy đoán). Chỉ so khớp phần
// đầu câu vì đuôi câu có ngày hết hạn trả hàng khác nhau theo từng dòng
// (VD "...tới ngày 2026-09-02."), không so khớp được nguyên câu.
const RETURN_WINDOW_STATUS_PREFIX = "người mua xác nhận đã nhận được hàng";

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
  excludedReturnWindowCount: number; // số dòng bị loại vì còn trong hạn được yêu cầu trả hàng/hoàn tiền (đã giao nhưng chưa tính bán chắc chắn)
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

// "Ngày làm việc X" = đúng ngày lịch X của "Thời gian giao hàng" (không phải
// khoảng giờ 17:00 hôm trước → 17:00 hôm sau như bản trước). Đổi vì đối
// chiếu với nhãn PDF đã in thực tế cho thấy mốc cắt cứng 17:00 sai lệch: giờ
// bưu tá quét mã trong "Thời gian giao hàng" có độ trễ vài phút so với giờ
// tiệm thực đóng gói xong — có lô hàng qué mã lúc 17:09 (chỉ trễ 9 phút) vẫn
// được tiệm in nhãn/tính vào đúng ngày hôm đó, không dời sang ngày hôm sau
// như quy tắc cũ suy luận. So ngày lịch đơn thuần khớp đúng 100% với thực tế
// (đã đối chiếu PDF nhãn thật), trong khi mốc 17:00 làm dư/thiếu vài đơn mỗi
// lần có lô giáp ranh giờ cắt.
function extractDateOnly(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
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

// targetDate: "YYYY-MM-DD" — ngày làm việc muốn tính, so đúng ngày lịch của
// "Thời gian giao hàng" (xem extractDateOnly).
export async function buildTransferKhoFile(orderRows: ShopeeOrderRow[], targetDate: string): Promise<TransferKhoResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate.trim())) {
    throw new Error(`Ngày làm việc không hợp lệ: "${targetDate}" (cần dạng YYYY-MM-DD)`);
  }
  const lookup = await buildShopeeLookup();

  const aggregated = new Map<string, TransferKhoRow>();
  const unmatched = new Map<string, ShopeeOrderRow>();
  let excludedPendingCount = 0;
  let excludedReturnWindowCount = 0;
  let excludedOutOfWindowCount = 0;

  for (const row of orderRows) {
    const trangThai = row.trang_thai ? normalize(row.trang_thai) : "";
    if (trangThai === PENDING_STATUS) {
      excludedPendingCount++;
      continue;
    }
    if (trangThai.startsWith(RETURN_WINDOW_STATUS_PREFIX)) {
      excludedReturnWindowCount++;
      continue;
    }
    const rowDate = extractDateOnly(row.thoi_gian_giao_hang);
    if (rowDate !== targetDate.trim()) {
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
    excludedReturnWindowCount,
    excludedOutOfWindowCount,
  };
}
