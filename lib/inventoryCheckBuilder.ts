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

// Riêng nhóm "Trà" tách thêm 3 mục con theo từ khóa trong tên hàng hóa — các
// nhóm hàng khác không đổi, vẫn in 1 mục như cũ. Thứ tự cố định: Trà rời →
// Trà Icetea → Trà gói.
const TRA_ICETEA_KEYWORD = "hòa tan";
const TRA_GOI_KEYWORD = "túi lọc";
const TRA_SUBGROUP_ORDER = ["Trà rời", "Trà Icetea", "Trà gói"];

function inventoryGroupLabel(p: Product): string {
  if (p.category_sheet !== "Trà") return p.category_sheet;
  const name = p.ten_hang_hoa.toLowerCase();
  if (name.includes(TRA_ICETEA_KEYWORD)) return "Trà Icetea";
  if (name.includes(TRA_GOI_KEYWORD)) return "Trà gói";
  return "Trà rời";
}

function sortForInventory(items: Product[]): Product[] {
  return [...items].sort((a, b) => {
    const catDiff = CATEGORY_ORDER.indexOf(a.category_sheet) - CATEGORY_ORDER.indexOf(b.category_sheet);
    if (catDiff !== 0) return catDiff;
    const groupA = inventoryGroupLabel(a);
    const groupB = inventoryGroupLabel(b);
    if (groupA !== groupB) return TRA_SUBGROUP_ORDER.indexOf(groupA) - TRA_SUBGROUP_ORDER.indexOf(groupB);
    // Trong cùng 1 mục, gom theo thương hiệu trước rồi mới tới tên hàng hóa —
    // sản phẩm không có thương hiệu xếp xuống cuối thay vì lẫn lộn đầu danh
    // sách (chuỗi rỗng vốn xếp trước mọi tên thật theo localeCompare).
    const brandA = a.brand?.name || "";
    const brandB = b.brand?.name || "";
    if (!brandA !== !brandB) return brandA ? -1 : 1;
    const brandDiff = brandA.localeCompare(brandB, "vi");
    if (brandDiff !== 0) return brandDiff;
    return a.ten_hang_hoa.localeCompare(b.ten_hang_hoa, "vi");
  });
}

const HEADER_FONT_SIZE = 7.5;
const DATA_FONT_SIZE = 7;

// Padding trên/dưới CHỈ nới rộng cho hàng dữ liệu (ô trống viết tay) — hàng
// tiêu đề/tiêu đề nhóm hàng chỉ là chữ in sẵn, không cần chỗ viết nên giữ
// mỏng để không tốn giấy. Đây là lý do chiều cao hàng dữ liệu không thể giảm
// thêm chỉ bằng cách hạ cỡ chữ — ô cần đủ cao để viết tay 1 con số bằng bút.
// paddingTop/Bottom=4 (đã giảm từ 6) là mức tối thiểu còn đủ chỗ viết tay 1
// chữ số — thu nhỏ thêm sẽ ảnh hưởng thật đến việc viết tay, không chỉ giấy.
const tableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
  paddingLeft: () => 2,
  paddingRight: () => 2,
  paddingTop: (i: number, node: any) => {
    const cell = node.table.body[i]?.[0];
    const isHeaderOrCategory = i === 0 || Boolean(cell && cell.colSpan);
    return isHeaderOrCategory ? 1.5 : 4;
  },
  paddingBottom: (i: number, node: any) => {
    const cell = node.table.body[i]?.[0];
    const isHeaderOrCategory = i === 0 || Boolean(cell && cell.colSpan);
    return isHeaderOrCategory ? 1.5 : 4;
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

  // So le màu xám rất nhạt giữa các hàng liền nhau — bảng có 12 cột trống kề
  // nhau nên mắt rất dễ lạc dòng khi kéo ngang; #F4F4F4 (~4% đen) vẫn hiện rõ
  // khi in đen trắng, không tốn nhiều mực. Đếm lại từ đầu ở mỗi nhóm hàng để
  // hàng đầu tiên sau tiêu đề nhóm luôn thống nhất không tô màu.
  const STRIPE_FILL = "#F4F4F4";

  let lastGroup: string | null = null;
  let categoryIndex = 0;
  let rowInCategory = 0;
  for (const p of sorted) {
    const group = inventoryGroupLabel(p);
    if (group !== lastGroup) {
      categoryIndex++;
      rowInCategory = 0;
      const emptyCells = Array.from({ length: NUM_DAY_COLS }, () => ({}));
      tableBody.push([
        {
          text: `${toRoman(categoryIndex)}. ${group}:`,
          bold: true,
          italics: true,
          decoration: "underline",
          colSpan: NUM_DAY_COLS + 1,
          fontSize: DATA_FONT_SIZE,
        },
        ...emptyCells,
      ]);
      lastGroup = group;
    }
    const fillColor = rowInCategory % 2 === 1 ? STRIPE_FILL : undefined;
    tableBody.push([
      { text: p.ten_hang_hoa, fontSize: DATA_FONT_SIZE, alignment: "left", fillColor },
      ...Array.from({ length: NUM_DAY_COLS }, () => ({ text: "", fontSize: DATA_FONT_SIZE, fillColor })),
    ]);
    rowInCategory++;
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
    pageOrientation: "portrait" as const,
    pageMargins: [18, 16, 18, 16] as [number, number, number, number],
    defaultStyle: { font: "Roboto", fontSize: DATA_FONT_SIZE },
    content,
  };

  const doc = pdfmake.createPdf(docDefinition);
  return doc.getBuffer();
}
