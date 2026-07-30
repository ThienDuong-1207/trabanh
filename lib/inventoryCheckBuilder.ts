import pdfmake from "./pdfFonts";
import { CATEGORY_ORDER, Product } from "./types";

const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];
function toRoman(n: number): string {
  return ROMAN_NUMERALS[n - 1] ?? String(n);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDdMm(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

function formatDdMmYyyy(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Tiệm chỉ kiểm kho Thứ 2 - Thứ 7 (nghỉ Chủ nhật) — bỏ qua mọi Chủ nhật rơi
// vào giữa khi đếm đủ 12 ngày, kể cả khi ngày bắt đầu người dùng chọn lỡ rơi
// đúng Chủ nhật (khi đó ngày đó không tính, tự nhảy sang ngày kế tiếp).
export function getWorkingDays(startDateStr: string, count: number): Date[] {
  const days: Date[] = [];
  let cur = new Date(startDateStr + "T00:00:00");
  while (days.length < count) {
    if (cur.getDay() !== 0) days.push(new Date(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return days;
}

function sortForInventory(items: Product[]): Product[] {
  return [...items].sort((a, b) => {
    const catDiff = CATEGORY_ORDER.indexOf(a.category_sheet) - CATEGORY_ORDER.indexOf(b.category_sheet);
    if (catDiff !== 0) return catDiff;
    return a.ten_hang_hoa.localeCompare(b.ten_hang_hoa, "vi");
  });
}

const HEADER_FONT_SIZE = 8;
const DATA_FONT_SIZE = 7.5;

// Padding trên/dưới CHỈ nới rộng cho hàng dữ liệu (ô trống viết tay) — hàng
// tiêu đề/tiêu đề nhóm hàng chỉ là chữ in sẵn, không cần chỗ viết nên giữ
// mỏng để không tốn giấy. Đây là lý do chiều cao hàng dữ liệu không thể giảm
// thêm chỉ bằng cách hạ cỡ chữ — ô cần đủ cao để viết tay 1 con số bằng bút.
const tableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
  paddingLeft: () => 3,
  paddingRight: () => 3,
  paddingTop: (i: number, node: any) => {
    const cell = node.table.body[i]?.[0];
    const isHeaderOrCategory = i === 0 || Boolean(cell && cell.colSpan);
    return isHeaderOrCategory ? 2 : 6;
  },
  paddingBottom: (i: number, node: any) => {
    const cell = node.table.body[i]?.[0];
    const isHeaderOrCategory = i === 0 || Boolean(cell && cell.colSpan);
    return isHeaderOrCategory ? 2 : 6;
  },
};

export async function buildInventoryCheckPdf(items: Product[], startDateStr: string): Promise<Buffer> {
  const sorted = sortForInventory(items);
  const days = getWorkingDays(startDateStr, 12);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  const NUM_DAY_COLS = 12;
  const tableBody: any[] = [
    [
      { text: "TÊN HÀNG HÓA", bold: true, alignment: "center", fontSize: HEADER_FONT_SIZE },
      ...days.map((d) => ({ text: formatDdMm(d), bold: true, alignment: "center", fontSize: HEADER_FONT_SIZE })),
    ],
  ];

  let lastCategory: string | null = null;
  let categoryIndex = 0;
  for (const p of sorted) {
    if (p.category_sheet !== lastCategory) {
      categoryIndex++;
      const emptyCells = Array.from({ length: NUM_DAY_COLS }, () => ({}));
      tableBody.push([
        {
          text: `${toRoman(categoryIndex)}. ${p.category_sheet}:`,
          bold: true,
          italics: true,
          decoration: "underline",
          colSpan: NUM_DAY_COLS + 1,
          fontSize: DATA_FONT_SIZE,
        },
        ...emptyCells,
      ]);
      lastCategory = p.category_sheet;
    }
    tableBody.push([
      { text: p.ten_hang_hoa, fontSize: DATA_FONT_SIZE, alignment: "left" },
      ...Array.from({ length: NUM_DAY_COLS }, () => ({ text: "", fontSize: DATA_FONT_SIZE })),
    ]);
  }

  const content: any[] = [
    { text: "PHIẾU KIỂM KHO", bold: true, fontSize: 14, margin: [0, 0, 0, 2] },
    { text: `Từ ngày ${formatDdMmYyyy(firstDay)} đến ngày ${formatDdMmYyyy(lastDay)}`, fontSize: 10, margin: [0, 0, 0, 10] },
  ];

  if (sorted.length === 0) {
    content.push({ text: "Không có sản phẩm nào trong danh sách đã chọn." });
  } else {
    const dayColWidth = `${(70 / NUM_DAY_COLS).toFixed(2)}%`;
    content.push({
      table: {
        headerRows: 1,
        widths: ["30%", ...Array(NUM_DAY_COLS).fill(dayColWidth)],
        body: tableBody,
      },
      layout: tableLayout,
    });
  }

  const docDefinition = {
    pageSize: "A4",
    pageOrientation: "landscape" as const,
    pageMargins: [24, 24, 24, 24] as [number, number, number, number],
    defaultStyle: { font: "Roboto", fontSize: DATA_FONT_SIZE },
    content,
  };

  const doc = pdfmake.createPdf(docDefinition);
  return doc.getBuffer();
}
