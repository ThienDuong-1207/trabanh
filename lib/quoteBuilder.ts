import pdfmake from "./pdfFonts";
import { CATEGORY_ORDER, Product } from "./types";
import { extractUnitFromQuyCach } from "./suggestionLists";

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

// dvt_cap_2 chỉ lưu tên đơn vị sạch (vd "Hộp"), số lượng nằm riêng ở
// ty_le_cap_2 — tự ghép lại thành mô tả đầy đủ "Hộp (12 Gói)" ở đây thay vì
// giả định dvt_cap_2 đã có sẵn số lượng. extractUnitFromQuyCach phòng
// trường hợp dữ liệu cũ/nhập tay vẫn còn dạng "Hộp (12 gói)" (tránh lặp số
// lượng 2 lần trong 1 câu).
function formatHopUnit(p: Product): string | null {
  if (!p.dvt_cap_2 || !p.ty_le_cap_2 || !p.dvt) return null;
  return `${extractUnitFromQuyCach(p.dvt_cap_2)} (${p.ty_le_cap_2} ${p.dvt})`;
}

// Gộp quy cách 2 cấp đóng gói (Thùng + Hộp trung gian, nếu có) thành 1 dòng
// mô tả cho khách xem, vd "Thùng (10 hộp), Hộp (12 Gói)" — sản phẩm thường
// (2 cấp, không có dvt_cap_2) chỉ hiện đúng quy_cach sẵn có.
function formatQuyCach(p: Product): string {
  const parts = [p.quy_cach, formatHopUnit(p)].filter((s): s is string => Boolean(s));
  return parts.join(", ");
}

// Sản phẩm bán 3 cấp (có giá Hộp) không có cột giá riêng — thay vào đó chèn
// 1 dòng ghi chú nhỏ ngay dưới tên sản phẩm, để khách thấy ngay giá Hộp gắn
// liền với đúng sản phẩm đó thay vì phải dò một cột giá riêng.
// Dùng "stack" (2 paragraph riêng) chứ không phải 1 "text" có ký tự "\n" —
// ký tự "\n" lồng trong text làm pdfmake tính sai chiều cao dòng, khiến các
// ô khác cùng hàng (vd cột Quy cách) bị cắt mất dòng thứ 2 (đã gặp thực tế).
// Cũng tránh ký tự mũi tên "↳": font Roboto nhúng trong file không có glyph
// này, hiện ra thành ô vuông rỗng.
function nameCell(p: Product) {
  const hopUnit = formatHopUnit(p);
  if (p.gia_hop && hopUnit) {
    return {
      stack: [
        { text: p.ten_hang_hoa },
        { text: `- Giá ${hopUnit}: ${formatPrice(p.gia_hop)}đ`, italics: true, fontSize: 9, color: "#555555", margin: [0, 2, 0, 0] },
      ],
    };
  }
  return { text: p.ten_hang_hoa, alignment: "left" };
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

  // Chèn 1 dòng tiêu đề tên nhóm hàng trước sản phẩm đầu tiên của mỗi nhóm
  // khác với nhóm ngay trước đó — STT vẫn đếm liên tục xuyên suốt bảng,
  // không reset về 1 ở mỗi nhóm (items đã được sortForQuote sắp theo đúng
  // thứ tự nhóm hàng nên chỉ cần so sánh với nhóm liền trước).
  const tableBody: any[] = [
    [
      { text: "STT", bold: true, alignment: "center" },
      { text: "TÊN SẢN PHẨM", bold: true, alignment: "center" },
      { text: "QUY CÁCH", bold: true, alignment: "center" },
      { text: "GIÁ LẺ", bold: true, alignment: "center" },
      { text: "GIÁ THÙNG", bold: true, alignment: "center" },
    ],
  ];
  let lastCategory: string | null = null;
  let stt = 1;
  for (const p of sorted) {
    if (p.category_sheet !== lastCategory) {
      tableBody.push([{ text: `${p.category_sheet}:`, bold: true, colSpan: 5, fillColor: "#f2f2f2" }, {}, {}, {}, {}]);
      lastCategory = p.category_sheet;
    }
    tableBody.push([
      { text: String(stt), alignment: "center" },
      nameCell(p),
      { text: formatQuyCach(p), alignment: "left" },
      { text: formatPrice(p.gia_ban), alignment: "right" },
      { text: formatPrice(p.gia_thung), alignment: "right" },
    ]);
    stt++;
  }

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
      table: { headerRows: 1, widths: ["7%", "35%", "24%", "17%", "17%"], body: tableBody },
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
