import fs from "fs";
import path from "path";
import pdfmake from "./pdfFonts";
import { Product } from "./types";
import { extractUnitFromQuyCach } from "./suggestionLists";

// Thứ tự nhóm hàng RIÊNG cho bảng báo giá — khác CATEGORY_ORDER dùng chung
// toàn hệ thống (dropdown thêm/sửa sản phẩm, import...). Theo yêu cầu: Sữa
// đặc/Sữa tươi/Kem đông lạnh lên đầu, Trà xuống cuối cùng trong các nhóm sản
// phẩm thật, Công cụ dụng cụ vẫn luôn ở cuối cùng tuyệt đối (không phải sản
// phẩm bán trực tiếp, tách riêng khỏi mọi nhóm hàng khác).
const QUOTE_CATEGORY_ORDER = [
  "Sữa đặc", "Sữa tươi", "Kem đông lạnh", "Syrup", "Bột",
  "Trân châu", "Mứt", "Đồ lon", "Mặt hàng khác", "Trà", "Công cụ dụng cụ",
];

// Chuyển sang dạng bảng giá niêm yết chung (không phải báo giá riêng theo
// từng khách) — theo mẫu thiết kế thật của tiệm, không còn thu thập tên/địa
// chỉ/điện thoại khách hàng nữa, chỉ còn ngày báo giá.
export type QuoteInfo = {
  date?: string | null; // yyyy-mm-dd
};

// Thông tin công ty cố định cho phần đầu trang (letterhead).
const COMPANY_INFO = [
  "TIỆM TRÀ BÁNH (CN TÂN CẢNG)",
  "Số 5 Ung Văn Khiêm, phường Thạnh Mỹ Tây, TP Hồ Chí Minh, Việt Nam",
  "Số điện thoại: 0906.363.395 (ZALO) - 0902.331.361",
  "Website: trabanh.com",
];

const LOGO_PATH = path.join(process.cwd(), "public", "templates", "logo.png");

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];
function toRoman(n: number): string {
  return ROMAN_NUMERALS[n - 1] ?? String(n);
}

function formatPrice(n: number | null) {
  if (n === null || n === undefined) return "";
  return Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".");
}

function formatDateLine(dateStr?: string | null) {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  return `Cập nhật đến ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`;
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
        { text: p.ten_hang_hoa, fontSize: TABLE_FONT_SIZE },
        { text: `- Giá ${hopUnit}: ${formatPrice(p.gia_hop)}đ`, italics: true, fontSize: TABLE_FONT_SIZE - 1.5, color: "#555555", margin: [0, 2, 0, 0] },
      ],
    };
  }
  return { text: p.ten_hang_hoa, alignment: "left", fontSize: TABLE_FONT_SIZE };
}

// Áp dụng cho MỌI nhóm hàng (không riêng Syrup): trong mỗi nhóm hàng, sắp
// theo Thương hiệu (A-Z) trước — ưu tiên cao nhất sau nhóm hàng — rồi trong
// mỗi thương hiệu sắp Giá bán lẻ GIẢM DẦN (đắt→rẻ), vd Syrup: DaVinci
// (đắt→rẻ) rồi mới tới Monin (đắt→rẻ), thay vì xen kẽ lộn xộn theo tên sản
// phẩm như trước. Sản phẩm không có thương hiệu bị đẩy xuống cuối nhóm hàng
// (sau mọi thương hiệu có tên), sắp theo tên A-Z. Trong 1 thương hiệu, sản
// phẩm chưa có giá bán lẻ (null — hiện "Liên hệ") vẫn bị đẩy xuống cuối
// nhóm thương hiệu đó, dù giá đang sắp giảm dần hay tăng dần.
function sortForQuote(items: Product[]): Product[] {
  return [...items].sort((a, b) => {
    const catDiff = QUOTE_CATEGORY_ORDER.indexOf(a.category_sheet) - QUOTE_CATEGORY_ORDER.indexOf(b.category_sheet);
    if (catDiff !== 0) return catDiff;

    const brandA = a.brand?.name ?? null;
    const brandB = b.brand?.name ?? null;
    if (brandA === null && brandB !== null) return 1;
    if (brandA !== null && brandB === null) return -1;
    if (brandA !== null && brandB !== null) {
      const brandDiff = brandA.localeCompare(brandB, "vi");
      if (brandDiff !== 0) return brandDiff;
    }

    if (brandA === null && brandB === null) {
      return a.ten_hang_hoa.localeCompare(b.ten_hang_hoa, "vi");
    }

    const priceA = a.gia_ban;
    const priceB = b.gia_ban;
    if (priceA === null && priceB !== null) return 1;
    if (priceA !== null && priceB === null) return -1;
    if (priceA !== null && priceB !== null && priceA !== priceB) return priceB - priceA;
    return a.ten_hang_hoa.localeCompare(b.ten_hang_hoa, "vi");
  });
}

// Giảm padding mọi phía so với mặc định của pdfmake (trái/phải mặc định 4,
// trên/dưới mặc định 2) — cùng với giảm cỡ chữ trong bảng, giúp mỗi hàng
// thấp lại đáng kể để 1 trang in được nhiều sản phẩm hơn. Giảm cả trái/phải
// (không chỉ trên/dưới như trước) vì các cột giá đã thu hẹp tới mức tiêu đề
// "GIÁ THÙNG" xém bị vỡ dòng ở padding mặc định.
const tableBorder = {
  hLineWidth: () => 0.75,
  vLineWidth: () => 0.75,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
  paddingLeft: () => 2,
  paddingRight: () => 2,
  paddingTop: () => 1,
  paddingBottom: () => 1,
};

const TABLE_FONT_SIZE = 9.5;
const TABLE_HEADER_FONT_SIZE = 9;

// Gộp ô dọc (rowSpan) cho 1 cột giá khi nhiều dòng SẢN PHẨM liên tiếp có
// đúng cùng 1 giá trị — bỏ qua dòng tiêu đề nhóm hàng (values[i] undefined,
// không nối chuỗi xuyên qua) và dòng chưa có giá (null → hiện "Liên hệ",
// không coi là "cùng giá" với nhau).
function mergeEqualPriceRuns(tableBody: any[][], values: (number | null | undefined)[], col: number) {
  let i = 0;
  while (i < values.length) {
    const v = values[i];
    if (v === undefined || v === null) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < values.length && values[j] === v) j++;
    const span = j - i;
    if (span > 1) {
      tableBody[i][col] = { ...tableBody[i][col], rowSpan: span };
      for (let k = i + 1; k < j; k++) tableBody[k][col] = {};
    }
    i = j;
  }
}

export async function buildQuotePdf(items: Product[], info: QuoteInfo): Promise<Buffer> {
  const sorted = sortForQuote(items);

  // Chèn 1 dòng tiêu đề tên nhóm hàng trước sản phẩm đầu tiên của mỗi nhóm
  // khác với nhóm ngay trước đó — STT vẫn đếm liên tục xuyên suốt bảng,
  // không reset về 1 ở mỗi nhóm (items đã được sortForQuote sắp theo đúng
  // thứ tự nhóm hàng nên chỉ cần so sánh với nhóm liền trước).
  // Màu ô lấy đúng theo file mẫu thật của tiệm (đo trực tiếp từ file PDF
  // "bao_gia_tra_banh_sheet1_logo_note_only.pdf"): header vàng #FFFF00, dòng
  // tiêu đề nhóm hàng màu cam nhạt #FDEADA.
  const HEADER_FILL = "#FFFF00";
  const CATEGORY_FILL = "#FDEADA";

  const tableBody: any[] = [
    [
      { text: "STT", bold: true, alignment: "center", fillColor: HEADER_FILL, fontSize: TABLE_HEADER_FONT_SIZE },
      { text: "TÊN SẢN PHẨM", bold: true, alignment: "center", fillColor: HEADER_FILL, fontSize: TABLE_HEADER_FONT_SIZE },
      { text: "QUY CÁCH", bold: true, alignment: "center", fillColor: HEADER_FILL, fontSize: TABLE_HEADER_FONT_SIZE },
      { text: "GIÁ LẺ", bold: true, alignment: "center", fillColor: HEADER_FILL, fontSize: TABLE_HEADER_FONT_SIZE },
      { text: "GIÁ THÙNG", bold: true, alignment: "center", fillColor: HEADER_FILL, fontSize: TABLE_HEADER_FONT_SIZE },
    ],
  ];
  let lastCategory: string | null = null;
  let categoryIndex = 0;
  let stt = 1;
  // Song song với tableBody: giá trị giá lẻ/giá thùng thật của từng dòng (để
  // gộp ô dọc bên dưới) — undefined ở dòng tiêu đề cột/nhóm hàng (không phải
  // dòng sản phẩm, không được gộp xuyên qua). Bắt đầu với 1 phần tử undefined
  // khớp với dòng tiêu đề cột (STT/TÊN SẢN PHẨM/...) đã có sẵn trong
  // tableBody — thiếu phần tử này làm lệch chỉ số 1 dòng so với tableBody,
  // khiến hàm gộp phía dưới ghi rowSpan nhầm sang đúng dòng tiêu đề nhóm hàng
  // (colSpan, cell rỗng "{}") thay vì dòng sản phẩm, làm pdfmake vỡ layout.
  const rawGiaBan: (number | null | undefined)[] = [undefined];
  const rawGiaThung: (number | null | undefined)[] = [undefined];
  for (const p of sorted) {
    if (p.category_sheet !== lastCategory) {
      categoryIndex++;
      tableBody.push([
        {
          text: `${toRoman(categoryIndex)}. ${p.category_sheet}:`,
          bold: true,
          italics: true,
          decoration: "underline",
          colSpan: 5,
          fillColor: CATEGORY_FILL,
          fontSize: TABLE_FONT_SIZE,
        },
        {},
        {},
        {},
        {},
      ]);
      rawGiaBan.push(undefined);
      rawGiaThung.push(undefined);
      lastCategory = p.category_sheet;
    }
    tableBody.push([
      { text: String(stt), alignment: "center", fontSize: TABLE_FONT_SIZE },
      nameCell(p),
      { text: formatQuyCach(p), alignment: "left", fontSize: TABLE_FONT_SIZE },
      { text: formatPrice(p.gia_ban), alignment: "right", fontSize: TABLE_FONT_SIZE },
      { text: formatPrice(p.gia_thung), alignment: "right", fontSize: TABLE_FONT_SIZE },
    ]);
    rawGiaBan.push(p.gia_ban);
    rawGiaThung.push(p.gia_thung);
    stt++;
  }
  // Mỗi sản phẩm vẫn giữ đúng STT/tên/quy cách riêng — chỉ gộp ô hiển thị của
  // cột giá khi nhiều dòng LIÊN TIẾP cùng đúng 1 giá trị, cho dễ nhìn (vd
  // nhiều vị/size khác nhau của cùng thương hiệu bán cùng 1 mức giá). Giá lẻ
  // và giá thùng gộp độc lập nhau — 1 cột có thể gộp dù cột kia không trùng.
  // Bỏ qua dòng chưa có giá (null → "Liên hệ"): thiếu giá không phải "cùng 1
  // mức giá", gộp chung sẽ gây hiểu lầm.
  mergeEqualPriceRuns(tableBody, rawGiaBan, 3);
  mergeEqualPriceRuns(tableBody, rawGiaThung, 4);

  const logo = fs.existsSync(LOGO_PATH)
    ? { image: LOGO_PATH, fit: [130, 45] as [number, number], alignment: "right" as const }
    : null;

  const content: any[] = [
    {
      columns: [
        { width: "*", stack: COMPANY_INFO.map((line, i) => ({ text: line, bold: i === 0, fontSize: i === 0 ? 11 : 10 })) },
        ...(logo ? [{ width: 130, ...logo }] : []),
      ],
      margin: [0, 0, 0, 14],
    },
    { text: "BẢNG GIÁ", bold: true, fontSize: 16, alignment: "center", margin: [0, 0, 0, 4] },
    { text: formatDateLine(info.date), fontSize: 12, alignment: "center", margin: [0, 0, 0, 10] },
  ];

  if (sorted.length === 0) {
    content.push({ text: "Không có sản phẩm nào trong danh sách đã chọn." });
  } else {
    content.push({
      table: { headerRows: 1, widths: ["6%", "55%", "17%", "11%", "11%"], body: tableBody },
      layout: tableBorder,
    });
    content.push({
      text:
        "Ghi chú:\n" +
        "- Giá đã bao gồm VAT\n" +
        "- Bảng giá có giá trị tại thời điểm báo giá (cho đến khi có thông báo mới)\n" +
        "- Giá bán lẻ áp dụng tại Tiệm Trà&Bánh",
      bold: true,
      italics: true,
      alignment: "left",
      margin: [0, 10, 0, 0],
    });
  }

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: "Roboto", fontSize: 11 },
    content,
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage}/${pageCount}`,
      alignment: "center" as const,
      fontSize: 9,
      margin: [0, 4, 0, 0] as [number, number, number, number],
    }),
  };

  const doc = pdfmake.createPdf(docDefinition);
  return doc.getBuffer();
}
