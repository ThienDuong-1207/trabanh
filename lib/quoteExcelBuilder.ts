import ExcelJS from "exceljs";
import fs from "fs";
import { Product } from "./types";
import {
  COMPANY_INFO,
  LOGO_PATH,
  QuoteInfo,
  formatDateLine,
  formatHopUnit,
  formatPrice,
  formatQuyCach,
  sortForQuote,
  toRoman,
} from "./quoteBuilder";

// Bản Excel của cùng 1 bảng giá — dùng chung toàn bộ logic sắp xếp/định dạng
// với bản PDF (quoteBuilder.ts), chỉ khác phần "vẽ" ra Excel thay vì PDF, để
// giữ đúng 1 nguồn sự thật cho nội dung/thứ tự sản phẩm giữa 2 định dạng.
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
const CATEGORY_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDEADA" } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
};

export async function buildQuoteExcel(items: Product[], info: QuoteInfo): Promise<Buffer> {
  const sorted = sortForQuote(items);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bảng giá", { pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1 } });
  sheet.columns = [
    { width: 6 },
    { width: 52 },
    { width: 22 },
    { width: 14 },
    { width: 14 },
  ];

  // Letterhead: tên công ty + địa chỉ/SĐT/website bên trái, logo bên phải —
  // giữ đúng bố cục bản PDF.
  sheet.mergeCells("A1:C1");
  sheet.getCell("A1").value = COMPANY_INFO[0];
  sheet.getCell("A1").font = { bold: true, size: 13 };
  COMPANY_INFO.slice(1).forEach((line, i) => {
    const r = 2 + i;
    sheet.mergeCells(`A${r}:C${r}`);
    sheet.getCell(`A${r}`).value = line;
    sheet.getCell(`A${r}`).font = { size: 10.5 };
  });

  if (fs.existsSync(LOGO_PATH)) {
    const imageId = workbook.addImage({ filename: LOGO_PATH, extension: "png" });
    sheet.addImage(imageId, { tl: { col: 3.1, row: 0.1 }, ext: { width: 130, height: 45 } });
  }

  const TITLE_ROW = 6;
  sheet.mergeCells(`A${TITLE_ROW}:E${TITLE_ROW}`);
  const titleCell = sheet.getCell(`A${TITLE_ROW}`);
  titleCell.value = "BẢNG GIÁ";
  titleCell.font = { bold: true, size: 16 };
  titleCell.alignment = { horizontal: "center" };

  const DATE_ROW = TITLE_ROW + 1;
  sheet.mergeCells(`A${DATE_ROW}:E${DATE_ROW}`);
  const dateCell = sheet.getCell(`A${DATE_ROW}`);
  dateCell.value = formatDateLine(info.date);
  dateCell.font = { size: 11.5 };
  dateCell.alignment = { horizontal: "center" };

  const HEADER_ROW = DATE_ROW + 2;
  const headers = ["STT", "TÊN SẢN PHẨM", "QUY CÁCH", "GIÁ LẺ", "GIÁ THÙNG"];
  headers.forEach((h, i) => {
    const cell = sheet.getRow(HEADER_ROW).getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
  });

  if (sorted.length === 0) {
    const r = HEADER_ROW + 1;
    sheet.mergeCells(`A${r}:E${r}`);
    sheet.getCell(`A${r}`).value = "Không có sản phẩm nào trong danh sách đã chọn.";
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  let row = HEADER_ROW + 1;
  let lastCategory: string | null = null;
  let categoryIndex = 0;
  let stt = 1;
  for (const p of sorted) {
    if (p.category_sheet !== lastCategory) {
      categoryIndex++;
      sheet.mergeCells(`A${row}:E${row}`);
      const cell = sheet.getCell(`A${row}`);
      cell.value = `${toRoman(categoryIndex)}. ${p.category_sheet}:`;
      cell.font = { bold: true, italic: true, underline: true };
      cell.fill = CATEGORY_FILL;
      cell.border = THIN_BORDER;
      row++;
      lastCategory = p.category_sheet;
    }

    const hopUnit = formatHopUnit(p);
    const nameValue =
      p.gia_hop && hopUnit ? `${p.ten_hang_hoa}\n- Giá ${hopUnit}: ${formatPrice(p.gia_hop)}đ` : p.ten_hang_hoa;

    const excelRow = sheet.getRow(row);
    excelRow.getCell(1).value = stt;
    excelRow.getCell(1).alignment = { horizontal: "center" };
    excelRow.getCell(2).value = nameValue;
    excelRow.getCell(2).alignment = { horizontal: "left", wrapText: true, vertical: "top" };
    excelRow.getCell(3).value = formatQuyCach(p);
    excelRow.getCell(3).alignment = { horizontal: "left", vertical: "top", wrapText: true };
    excelRow.getCell(4).value = formatPrice(p.gia_ban);
    excelRow.getCell(4).alignment = { horizontal: "right", vertical: "top" };
    excelRow.getCell(5).value = formatPrice(p.gia_thung);
    excelRow.getCell(5).alignment = { horizontal: "right", vertical: "top" };
    for (let c = 1; c <= 5; c++) excelRow.getCell(c).border = THIN_BORDER;

    row++;
    stt++;
  }

  const notesRow = row + 1;
  const notes = [
    "Ghi chú:",
    "- Giá đã bao gồm VAT",
    "- Bảng giá có giá trị tại thời điểm báo giá (cho đến khi có thông báo mới)",
    "- Giá bán lẻ áp dụng tại Tiệm Trà&Bánh",
  ];
  notes.forEach((line, i) => {
    const r = notesRow + i;
    sheet.mergeCells(`A${r}:E${r}`);
    const cell = sheet.getCell(`A${r}`);
    cell.value = line;
    cell.font = { bold: true, italic: true };
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
