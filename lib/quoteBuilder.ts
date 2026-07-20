import path from "path";
import pdfmake from "pdfmake";
import { CATEGORY_ORDER, Product } from "./types";

const FONT_DIR = path.join(process.cwd(), "public", "fonts");

pdfmake.addFonts({
  Roboto: {
    normal: path.join(FONT_DIR, "Roboto-Regular.ttf"),
    bold: path.join(FONT_DIR, "Roboto-Medium.ttf"),
    italics: path.join(FONT_DIR, "Roboto-Italic.ttf"),
    bolditalics: path.join(FONT_DIR, "Roboto-MediumItalic.ttf"),
  },
});
// docDefinition content never references remote resources, so deny those —
// but local access must stay allowed since the Roboto font files above are
// themselves loaded through this same policy check.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => true);

export type QuoteInfo = {
  customerName?: string | null;
  address?: string | null;
  phone?: string | null;
  note?: string | null;
  date?: string | null; // yyyy-mm-dd
};

function formatPrice(n: number | null) {
  if (n === null || n === undefined) return "";
  return Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".");
}

function formatDateLine(dateStr?: string | null) {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  return `Ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
}

function sortForQuote(items: Product[]): Product[] {
  return [...items].sort((a, b) => {
    const catDiff = CATEGORY_ORDER.indexOf(a.category_sheet) - CATEGORY_ORDER.indexOf(b.category_sheet);
    if (catDiff !== 0) return catDiff;
    return a.ten_hang_hoa.localeCompare(b.ten_hang_hoa, "vi");
  });
}

const tableBorder = {
  hLineWidth: () => 0.75,
  vLineWidth: () => 0.75,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
};

export async function buildQuotePdf(items: Product[], info: QuoteInfo): Promise<Buffer> {
  const sorted = sortForQuote(items);

  const tableBody = [
    [
      { text: "STT", bold: true, alignment: "center" },
      { text: "TÊN SẢN PHẨM", bold: true, alignment: "center" },
      { text: "GIÁ LẺ", bold: true, alignment: "center" },
      { text: "GIÁ THÙNG", bold: true, alignment: "center" },
    ],
    ...sorted.map((p, i) => [
      { text: String(i + 1), alignment: "center" },
      { text: p.ten_hang_hoa, alignment: "left" },
      { text: formatPrice(p.gia_ban), alignment: "right" },
      { text: formatPrice(p.gia_thung), alignment: "right" },
    ]),
  ];

  const content: any[] = [
    { text: "BẢNG BÁO GIÁ", bold: true, fontSize: 16, alignment: "center", margin: [0, 0, 0, 4] },
    { text: formatDateLine(info.date), fontSize: 12, alignment: "center", margin: [0, 0, 0, 2] },
    { text: "Bảng báo giá có hiệu lực trong tháng", italics: true, fontSize: 11, alignment: "center", margin: [0, 0, 0, 10] },
    { text: `Khách hàng: ${info.customerName ?? ""}`, bold: true, margin: [0, 0, 0, 2] },
    { text: `Địa chỉ: ${info.address ?? ""}`, bold: true, margin: [0, 0, 0, 2] },
    { text: `Điện thoại: ${info.phone ?? ""}`, bold: true, margin: [0, 0, 0, 2] },
    { text: `Ghi chú: ${info.note ?? ""}`, bold: true, margin: [0, 0, 0, 10] },
  ];

  if (sorted.length === 0) {
    content.push({ text: "Không có sản phẩm nào trong danh sách đã chọn." });
  } else {
    content.push({
      table: { headerRows: 1, widths: ["8%", "51%", "20.5%", "20.5%"], body: tableBody },
      layout: tableBorder,
    });
  }

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: "Roboto", fontSize: 11 },
    content,
  };

  const doc = pdfmake.createPdf(docDefinition);
  return doc.getBuffer();
}
