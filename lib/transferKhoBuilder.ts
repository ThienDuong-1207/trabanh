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
  xuat_kho: number;
};

export type TransferKhoFromTonKhoResult = {
  file: Buffer;
  rows: TransferKhoRow[];
  skippedZeroCount: number; // số mã có Xuất kho = 0, không cần chuyển
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
// mỗi mã hàng hóa in ra 2 dòng: 1 dòng TỔNG (cột Tên hàng hóa = tên sản phẩm
// thật) và ngay dưới là dòng CHI TIẾT theo kho (cột Tên hàng hóa bị thay bằng
// đúng tên kho "SHOPEE") — đây không phải 2 dòng trùng lặp để bỏ bớt 1, mà
// dòng tổng = tổng của (các) dòng chi tiết theo từng kho bên dưới nó. Số
// Xuất kho luôn phải lấy từ đúng dòng "SHOPEE" (không lấy dòng tổng), vì nếu
// sau này file không còn lọc cứng theo đúng 1 kho, dòng tổng có thể cộng gộp
// nhiều kho khác chứ không chỉ riêng SHOPEE. Tên hàng hóa/Đơn vị tính vẫn lấy
// từ dòng tổng vì dòng "SHOPEE" không có tên sản phẩm thật. Đọc thẳng theo
// tên cột (dò header, không phụ thuộc thứ tự cột) nên vẫn dùng được cả với
// file rút gọn chỉ có 4 cột (Tên/Mã/ĐVT/Xuất kho), không cần Đầu kỳ/Cuối kỳ.
const KHO_ROW_LABEL = "shopee";

export async function parseTonKhoWorkbook(buffer: Buffer): Promise<TonKhoRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("File tồn kho không có sheet nào");

  let colTen: number | undefined;
  let colMa: number | undefined;
  let colDvt: number | undefined;
  let colXuatKho: number | undefined;
  let headerRow = -1;
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const found = new Map<string, number>();
    sheet.getRow(r).eachCell((cell, colNumber) => {
      const text = cellText(cell);
      if (text) found.set(text, colNumber);
    });
    if (found.has("Mã hàng hóa") && found.has("Xuất kho")) {
      headerRow = r;
      colTen = found.get("Tên hàng hóa");
      colMa = found.get("Mã hàng hóa");
      colDvt = found.get("Đơn vị tính");
      colXuatKho = found.get("Xuất kho");
      break;
    }
  }
  if (headerRow === -1 || !colMa || !colXuatKho) {
    throw new Error(
      'File không đúng định dạng "Tổng hợp tồn kho" MISA — thiếu cột "Mã hàng hóa"/"Xuất kho"'
    );
  }

  type Acc = { ten_hang_hoa: string; dvt: string | null; xuatKhoShopee: number | null; xuatKhoTong: number | null };
  const byMa = new Map<string, Acc>();
  const order: string[] = [];

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const ma = cellText(row.getCell(colMa));
    if (!ma) continue;
    const xuatKho = Number(cellText(row.getCell(colXuatKho)));
    if (!Number.isFinite(xuatKho)) continue;

    const tenCell = colTen ? cellText(row.getCell(colTen)) : "";
    const isKhoRow = tenCell.trim().toLowerCase() === KHO_ROW_LABEL;

    let acc = byMa.get(ma);
    if (!acc) {
      acc = { ten_hang_hoa: "", dvt: colDvt ? cellText(row.getCell(colDvt)) || null : null, xuatKhoShopee: null, xuatKhoTong: null };
      byMa.set(ma, acc);
      order.push(ma);
    }
    if (isKhoRow) {
      acc.xuatKhoShopee = xuatKho;
    } else {
      acc.ten_hang_hoa = tenCell;
      acc.xuatKhoTong = xuatKho;
    }
  }

  // Ưu tiên đúng dòng "SHOPEE"; nếu vì lý do gì đó không có dòng đó (file
  // không theo đúng cấu trúc thường gặp), tạm dùng dòng tổng để không mất
  // hẳn dữ liệu, còn hơn bỏ sót cả mã.
  return order.map((ma) => {
    const acc = byMa.get(ma)!;
    return {
      ma_noi_bo: ma,
      ten_hang_hoa: acc.ten_hang_hoa,
      dvt: acc.dvt,
      xuat_kho: acc.xuatKhoShopee ?? acc.xuatKhoTong ?? 0,
    };
  });
}

// Số lượng cần chuyển kho = đúng bằng số đã "Xuất kho" trong ngày — không
// dùng Đầu kỳ/Cuối kỳ nữa (theo yêu cầu: chỉ tính đúng số đã bán ra hôm đó,
// không cộng dồn công nợ chuyển kho từ các ngày trước).
export async function buildTransferKhoFromTonKho(tonKhoRows: TonKhoRow[]): Promise<TransferKhoFromTonKhoResult> {
  const nonZero = tonKhoRows.filter((r) => r.xuat_kho !== 0);
  const rows: TransferKhoRow[] = nonZero
    .map((r) => ({ ma_noi_bo: r.ma_noi_bo, ten_hang_hoa: r.ten_hang_hoa, dvt: r.dvt, so_luong: r.xuat_kho }))
    .sort((a, b) => a.ma_noi_bo.localeCompare(b.ma_noi_bo));

  const file = await writeTransferKhoWorkbook(rows);
  return { file, rows, skippedZeroCount: tonKhoRows.length - nonZero.length };
}
