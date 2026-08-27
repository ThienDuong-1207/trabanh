import ExcelJS from "exceljs";
import path from "path";

const TEMPLATE_PATH = path.join(process.cwd(), "public", "templates", "Nhap_khau_chi_tiet_hang_hoa_chuyen_kho.xlsx");
const SHEET_NAME = "Nhập khẩu hàng hóa xuất kho";
// Khớp đúng list "_hidden_stocks" trong file mẫu Misa — dropdown Kho xuất/Kho
// nhập yêu cầu đúng định dạng "<mã kho> | <tên kho>", không phải tên trơn.
const KHO_XUAT = "001 | Kho mặc định";
const KHO_NHAP = "0002 | SHOPEE";
const FIRST_DATA_ROW = 6; // hàng 1-5 là tiêu đề/hướng dẫn của file mẫu, giữ nguyên
const TEMPLATE_SAMPLE_ROWS = 3; // 3 dòng mẫu (MH00001..) có sẵn trong file gốc, cần xoá trước khi ghi dữ liệu thật

export type TransferKhoRow = {
  ma_noi_bo: string;
  ten_hang_hoa: string;
  dvt: string | null;
  so_luong: number;
};

export type TonKhoRow = {
  ma_noi_bo: string;
  ten_hang_hoa: string;
  dvt: string | null;
  cuoi_ky: number;
};

export type TransferKhoFromTonKhoResult = {
  file: Buffer;
  rows: TransferKhoRow[];
  skippedNonNegativeCount: number; // số mã có Cuối kỳ >= 0, không cần chuyển thêm
};

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && "result" in (v as unknown as Record<string, unknown>)) {
    return String((v as unknown as { result: unknown }).result ?? "").trim();
  }
  return String(v).trim();
}

// Ghi danh sách (mã, tên, đvt, số lượng) vào đúng file mẫu MISA "Nhập khẩu
// chi tiết hàng hóa xuất chuyển kho".
async function writeTransferKhoWorkbook(rows: TransferKhoRow[]): Promise<Buffer> {
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
  return Buffer.from(arrayBuffer);
}

// Đọc file MISA "Tổng hợp tồn kho" (báo cáo tồn kho lọc theo Kho: SHOPEE) —
// mỗi mã hàng hóa lặp lại 2 dòng (1 dòng tên hàng hóa thật + 1 dòng phụ tên
// "SHOPEE" giống hệt số liệu, do MISA tự chia theo kho khi báo cáo chỉ lọc 1
// kho) — chỉ giữ dòng đầu tiên gặp của mỗi mã, bỏ dòng lặp. Đọc thẳng theo
// tên cột (dò header, không phụ thuộc thứ tự cột) nên không bị ảnh hưởng bởi
// việc MISA ẩn sẵn cột Đầu kỳ/Nhập kho/Cuối kỳ trong file xuất — ẩn cột chỉ
// ảnh hưởng hiển thị, dữ liệu vẫn đọc được bình thường.
export async function parseTonKhoWorkbook(buffer: Buffer): Promise<TonKhoRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("File tồn kho không có sheet nào");

  let colTen: number | undefined;
  let colMa: number | undefined;
  let colDvt: number | undefined;
  let colCuoiKy: number | undefined;
  let headerRow = -1;
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const found = new Map<string, number>();
    sheet.getRow(r).eachCell((cell, colNumber) => {
      const text = cellText(cell);
      if (text) found.set(text, colNumber);
    });
    if (found.has("Mã hàng hóa") && found.has("Cuối kỳ")) {
      headerRow = r;
      colTen = found.get("Tên hàng hóa");
      colMa = found.get("Mã hàng hóa");
      colDvt = found.get("Đơn vị tính");
      colCuoiKy = found.get("Cuối kỳ");
      break;
    }
  }
  if (headerRow === -1 || !colMa || !colCuoiKy) {
    throw new Error(
      'File không đúng định dạng "Tổng hợp tồn kho" MISA — thiếu cột "Mã hàng hóa"/"Cuối kỳ" (nhớ bấm hiện lại cột nếu đang ẩn trước khi kiểm tra thủ công, code vẫn đọc được dù ẩn)'
    );
  }

  const rows: TonKhoRow[] = [];
  const seen = new Set<string>();
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const ma = cellText(row.getCell(colMa));
    if (!ma || seen.has(ma)) continue;
    const cuoiKy = Number(cellText(row.getCell(colCuoiKy)));
    if (!Number.isFinite(cuoiKy)) continue;
    seen.add(ma);
    rows.push({
      ma_noi_bo: ma,
      ten_hang_hoa: colTen ? cellText(row.getCell(colTen)) : "",
      dvt: colDvt ? cellText(row.getCell(colDvt)) || null : null,
      cuoi_ky: cuoiKy,
    });
  }
  return rows;
}

// Số lượng cần chuyển kho = trị tuyệt đối phần Cuối kỳ âm, để đưa tồn kho
// SHOPEE về đúng 0 — Cuối kỳ âm nghĩa là đã "Xuất kho" (bán) nhiều hơn đã
// từng "Nhập kho" (chuyển vào) cho mã đó, tức còn nợ chuyển kho đúng bằng
// đúng phần âm này (xem giải thích đã thống nhất với người dùng).
export async function buildTransferKhoFromTonKho(tonKhoRows: TonKhoRow[]): Promise<TransferKhoFromTonKhoResult> {
  const negative = tonKhoRows.filter((r) => r.cuoi_ky < 0);
  const rows: TransferKhoRow[] = negative
    .map((r) => ({ ma_noi_bo: r.ma_noi_bo, ten_hang_hoa: r.ten_hang_hoa, dvt: r.dvt, so_luong: -r.cuoi_ky }))
    .sort((a, b) => a.ma_noi_bo.localeCompare(b.ma_noi_bo));

  const file = await writeTransferKhoWorkbook(rows);
  return { file, rows, skippedNonNegativeCount: tonKhoRows.length - negative.length };
}
