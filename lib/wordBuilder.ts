import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, VerticalAlign,
  HeightRule, PageOrientation, TableLayoutType, Tab,
} from "docx";
import { fixDuplicateDocPrIds } from "./docxFixup";
import { estimateTextWidthPt } from "./textWidth";

// All fixed layout numbers in this file (cell margins, border weight, line
// spacing, title/barcode/unit sizes) are taken directly from
// "Misa hàng hóa/Bảng giá full 7.7x4cm.docx" — the shop's own hand-built
// reference — by unzipping it and reading word/document.xml, not guessed.
// Only the price font size is computed (the reference doesn't hand-tune a
// price size per length), calibrated to land on the same sizes the
// reference actually uses (60pt/6-char, 62pt/5-char, 51.5pt/7-char).

const DXA_PER_CM = 566.929;
const cm = (v: number) => Math.round(v * DXA_PER_CM);

const BLOCK_W = cm(7.7); // 4365 dxa, matches reference tblGrid/tcW
const BLOCK_H = cm(4.0); // 2268 dxa, matches reference trHeight
const MARGIN = cm(1.0);
const PAGE_W = cm(29.7);
const PAGE_H = cm(21.0);
const COLS = 3;
const ROWS = 3;
const FONT = "Arial";

// Cell margins from the reference tcMar (dxa), except: top nudged out a
// little (the reference's 28dxa/~0.05cm sat the title right on the border),
// and bottom tightened to 0.1cm so the barcode/unit line sits right at the
// bottom edge instead of floating above leftover empty space.
const CELL_MARGIN_TOP = cm(0.12);
const CELL_MARGIN_SIDE = 28;
const CELL_MARGIN_BOTTOM = cm(0.1);
const CELL_BORDER_SIZE = 4; // reference tcBorders sz (eighths of a point)

// Title tăng từ 10pt lên 12pt (theo yêu cầu ưu tiên hiển thị tên sản phẩm) —
// khác bản gốc, giờ CÓ THỂ cần xuống 2 dòng với tên dài (xem fitTitleLines),
// nên không còn là hằng số 1-dòng cố định như trước.
const TITLE_SIZE_HALF = 24; // 12pt
const TITLE_LINE = Math.round((TITLE_SIZE_HALF / 2) * 1.15 * 20); // 276 twips/dòng
// Giảm từ 49 xuống còn mức tối thiểu vẫn tách rõ giá với dòng mã vạch, để
// nhường thêm không gian cho tên sản phẩm to hơn.
const PRICE_SPACING_AFTER = 25; // twips, mức tối thiểu giữa giá và dòng mã vạch
const BOTTOM_LINE = 198; // exact twips, reference spacing/line
const BOTTOM_INDENT = 85; // twips, reference ind left/right
const BOTTOM_TAB_POS = 4139; // dxa, reference right-aligned tab stop
const BARCODE_SIZE_HALF = 15; // 7.5pt
const UNIT_SIZE_HALF = 18; // 9pt

// Price gets every bit of vertical room left in the block after the fixed
// zones (top margin, title line, the gap after the price, the bottom line,
// and the tightened bottom margin) — instead of a fixed conservative
// budget, so the price grows to fill the block rather than leaving empty
// space above the barcode/unit line. `extraZoneDxa` reserves additional room
// above the price for the old-price line in "price_change" mode (0 in
// "normal" mode, which reproduces the original single-zone calibration
// exactly).
const SAFETY = 1.15;
const DIGIT_WIDTH_EM = 0.556;
const SEPARATOR_WIDTH_EM = 0.278;
// Calibrated (not the literal cell margin) — this specific allowance is what
// reproduces the reference's actual sizes almost exactly (60pt/6-char,
// 62pt/5-char, 51.5pt/7-char) when combined with the glyph widths above.
const PRICE_BOX_WIDTH_PT = ((BLOCK_W / DXA_PER_CM) - 0.24) * 28.3465;

// Old-price line ("tem đổi giá" mode only) — struck-through, red, smaller
// than the title, căn trái (khớp lề dòng mã vạch bên dưới), nằm ngay trên
// giá mới. Cỡ chữ + khoảng cách thu nhỏ hết mức còn đọc được để nhường không
// gian cho giá mới (số to) — không phải giá trị đo từ 1 file mẫu cố định.
const OLD_PRICE_SIZE_HALF = 24; // 12pt
// Line height phải đủ chỗ cho cỡ chữ (cùng hệ số 1.15 dùng cho dòng giá
// chính bên dưới) — từng cố định 190 twips (~9.5pt), THẤP HƠN cỡ chữ 14pt
// dùng lúc đó, khiến "exact" line height ép chữ tràn/đè lên dòng tiêu đề
// phía trên khi in thật (lỗi thực tế gặp phải, không phải chỉ trên màn hình
// xem trước) — luôn tính theo công thức này, không hardcode số cố định nữa.
const OLD_PRICE_LINE = Math.round((OLD_PRICE_SIZE_HALF / 2) * 1.15 * 20); // 276 twips
// Khoảng trống dồn vào TRƯỚC giá cũ (giữa tên sản phẩm và giá cũ), gần như bỏ
// hẳn khoảng cách SAU giá cũ (giữa giá cũ và giá mới) — theo đúng yêu cầu
// "giá cũ và giá mới gần nhau hơn" thay vì giá cũ dính sát tên sản phẩm. Siết
// tiếp cả khoảng TRƯỚC (60→36) để nhường thêm chỗ cho tên sản phẩm.
const OLD_PRICE_GAP_BEFORE = 36; // twips
const OLD_PRICE_GAP_AFTER = 0; // twips

// Dòng thời gian khuyến mãi ("mode khuyến mãi" + có ngày) — căn phải, chỉ
// nằm ngay TRÊN chữ ĐVT (không kéo dài hết bề ngang, không đè lên phần mã
// vạch bên trái), cỡ chữ nhỏ ngang dòng mã vạch. Đặt sát dòng mã vạch/ĐVT
// (before/after = 0) vì bản chất là 1 cặp thông tin đi liền với ĐVT.
const PROMO_SIZE_HALF = 15; // 7.5pt, bằng cỡ chữ mã vạch
const PROMO_LINE = Math.round((PROMO_SIZE_HALF / 2) * 1.15 * 20);

function estimatePriceWidthUnits(price: string): number {
  let units = 0;
  for (const ch of price) units += /[.,]/.test(ch) ? SEPARATOR_WIDTH_EM : DIGIT_WIDTH_EM;
  return units;
}

// Tên sản phẩm ưu tiên 1 dòng ở đúng TITLE_SIZE_HALF; chỉ xuống dòng 2 khi
// thật sự không vừa bề ngang khối (7.7cm trừ lề 2 bên) — tách tại ranh giới
// từ, dòng dài chia trước (greedy) như cách đã làm ổn định ở tem cuộn 5x3cm.
// Cả 2 dòng đều căn giữa (title Paragraph alignment CENTER áp dụng từng dòng
// trong cùng đoạn văn, không riêng dòng đầu).
const TITLE_CONTENT_WIDTH_PT = (BLOCK_W - 2 * CELL_MARGIN_SIDE) / 20;

function fitTitleLines(name: string): string[] {
  const sizePt = TITLE_SIZE_HALF / 2;
  if (estimateTextWidthPt(name, sizePt) <= TITLE_CONTENT_WIDTH_PT) return [name];
  const words = name.split(" ");
  if (words.length < 2) return [name]; // không có chỗ tách từ — hiếm, chấp nhận tràn nhẹ
  let line1 = words[0];
  let idx = 1;
  for (; idx < words.length; idx++) {
    const candidate = `${line1} ${words[idx]}`;
    if (estimateTextWidthPt(candidate, sizePt) > TITLE_CONTENT_WIDTH_PT) break;
    line1 = candidate;
  }
  const line2 = words.slice(idx).join(" ");
  return line2 ? [line1, line2] : [name];
}

// `reservedDxa` = vùng đã bị chiếm bởi tên sản phẩm (1 hay 2 dòng, tính theo
// TITLE_LINE * số dòng) CỘNG vùng giá cũ (nếu là tem đổi giá) — giá chính
// luôn nhận toàn bộ phần còn lại của khối 4cm, co giãn theo đúng phần còn
// trống thay vì 1 ngân sách cố định, để không lãng phí khoảng trắng phía
// trên dòng mã vạch/đơn vị.
const BASE_ZONES_DXA = CELL_MARGIN_TOP + BOTTOM_LINE + CELL_MARGIN_BOTTOM;

function priceZonePt(reservedDxa: number): number {
  return (BLOCK_H - BASE_ZONES_DXA - PRICE_SPACING_AFTER - reservedDxa) / 20;
}

function priceFontSizeHalf(price: string, reservedDxa: number) {
  const sizeFromWidth = PRICE_BOX_WIDTH_PT / (estimatePriceWidthUnits(price) * SAFETY);
  const sizeFromHeight = priceZonePt(reservedDxa) / (1.15 * SAFETY);
  return Math.round(Math.min(sizeFromWidth, sizeFromHeight) * 2);
}

// `tightBefore`: dùng cho tem "đổi giá" — muốn giá cũ và giá mới nằm SÁT
// nhau, khoảng trống dôi ra dồn hết xuống dưới (giữa giá mới và dòng mã
// vạch) thay vì chia đều 2 bên như tem thường (before=0 thay vì chia đôi
// leftover).
function priceSpacingDxa(priceSizeHalf: number, reservedDxa: number, tightBefore = false): { before: number; after: number } {
  const priceLineDxa = Math.round((priceSizeHalf / 2) * 1.15 * 20);
  const leftover = Math.max(0, BLOCK_H - BASE_ZONES_DXA - reservedDxa - priceLineDxa);
  if (tightBefore) {
    return { before: 0, after: Math.max(PRICE_SPACING_AFTER, leftover) };
  }
  const before = Math.floor(leftover / 2);
  const after = Math.max(PRICE_SPACING_AFTER, leftover - before);
  return { before, after };
}

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const cellBorderThin = {
  top: { style: BorderStyle.SINGLE, size: CELL_BORDER_SIZE, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: CELL_BORDER_SIZE, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: CELL_BORDER_SIZE, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: CELL_BORDER_SIZE, color: "000000" },
};

function formatPrice(n: number) {
  return Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".");
}

// "yyyy-mm-dd" (giá trị input type=date) -> "dd/mm" — bỏ năm để tiết kiệm
// chỗ trên dòng nhỏ, đủ dùng cho khuyến mãi trong cùng 1 năm.
function formatDdMm(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

export type PromoRange = { from: string; to: string };

function buildCell(item: WordLabelItem | null, mode: WordLabelMode, promo?: PromoRange) {
  if (!item || !item.gia_ban) {
    return new TableCell({
      width: { size: BLOCK_W, type: WidthType.DXA },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
      children: [new Paragraph({ text: "" })],
    });
  }
  const name = item.ten_hang_hoa.toUpperCase();
  const titleLines = fitTitleLines(name);
  const titleZoneDxa = TITLE_LINE * titleLines.length;
  const titlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0, line: TITLE_LINE, lineRule: "exact" },
    children: titleLines.map(
      (line, i) => new TextRun({ text: line, bold: true, font: FONT, size: TITLE_SIZE_HALF, break: i > 0 ? 1 : undefined })
    ),
  });

  // Tem "đổi giá": thêm 1 dòng giá cũ gạch ngang màu đỏ ngay trên giá mới —
  // chiếm thêm 1 vùng cố định (OLD_PRICE_LINE + khoảng cách trước), nên giá
  // mới co lại nhường chỗ đúng bằng vùng đó (mode "normal" không có vùng này,
  // reservedDxa chỉ còn đúng vùng tên sản phẩm).
  const hasOldPrice = mode === "price_change" && item.gia_ban_old != null;
  const oldPriceZoneDxa = hasOldPrice ? OLD_PRICE_GAP_BEFORE + OLD_PRICE_LINE + OLD_PRICE_GAP_AFTER : 0;
  const hasPromo = mode === "price_change" && !!promo;
  const promoZoneDxa = hasPromo ? PROMO_LINE : 0;
  const reservedDxa = titleZoneDxa + oldPriceZoneDxa + promoZoneDxa;

  const oldPricePara = hasOldPrice
    ? new Paragraph({
        alignment: AlignmentType.LEFT,
        indent: { left: BOTTOM_INDENT }, // khớp lề trái với dòng mã vạch/đơn vị bên dưới
        spacing: { before: OLD_PRICE_GAP_BEFORE, after: OLD_PRICE_GAP_AFTER, line: OLD_PRICE_LINE, lineRule: "exact" },
        children: [
          new TextRun({
            text: formatPrice(item.gia_ban_old!),
            bold: true,
            strike: true,
            color: "FF0000",
            font: FONT,
            size: OLD_PRICE_SIZE_HALF,
          }),
        ],
      })
    : null;

  const priceStr = formatPrice(item.gia_ban);
  const priceSize = priceFontSizeHalf(priceStr, reservedDxa);
  const { before: priceBefore, after: priceAfter } = priceSpacingDxa(priceSize, reservedDxa, hasOldPrice);
  const pricePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: priceBefore, after: priceAfter },
    children: [new TextRun({ text: priceStr, bold: true, font: FONT, size: priceSize })],
  });

  const promoPara = hasPromo
    ? new Paragraph({
        alignment: AlignmentType.RIGHT,
        indent: { left: BOTTOM_INDENT, right: BOTTOM_INDENT },
        spacing: { before: 0, after: 0, line: PROMO_LINE, lineRule: "exact" },
        children: [new TextRun({ text: `${formatDdMm(promo!.from)} - ${formatDdMm(promo!.to)}`, font: FONT, size: PROMO_SIZE_HALF })],
      })
    : null;

  const bottomLine = new Paragraph({
    tabStops: [{ type: "right", position: BOTTOM_TAB_POS }],
    spacing: { line: BOTTOM_LINE, lineRule: "exact" },
    indent: { left: BOTTOM_INDENT, right: BOTTOM_INDENT },
    children: [
      new TextRun({ text: item.ma_vach || "", font: FONT, size: BARCODE_SIZE_HALF }),
      new TextRun({ children: [new Tab()], font: FONT }),
      new TextRun({ text: (item.dvt || "").toUpperCase(), bold: true, font: FONT, size: UNIT_SIZE_HALF }),
    ],
  });

  return new TableCell({
    width: { size: BLOCK_W, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: CELL_MARGIN_TOP, bottom: CELL_MARGIN_BOTTOM, left: CELL_MARGIN_SIDE, right: CELL_MARGIN_SIDE },
    borders: cellBorderThin,
    children: [titlePara, ...(oldPricePara ? [oldPricePara] : []), pricePara, ...(promoPara ? [promoPara] : []), bottomLine],
  });
}

function buildPage(label: string, items: (WordLabelItem | null)[], mode: WordLabelMode, promo?: PromoRange) {
  const rows: TableRow[] = [];
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    const cells: TableCell[] = [];
    for (let c = 0; c < COLS; c++) {
      cells.push(buildCell(items[idx] ?? null, mode, promo));
      idx += 1;
    }
    rows.push(new TableRow({ height: { value: BLOCK_H, rule: HeightRule.ATLEAST }, children: cells }));
  }
  const table = new Table({
    width: { size: COLS * BLOCK_W, type: WidthType.DXA },
    columnWidths: Array(COLS).fill(BLOCK_W),
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    rows,
  });

  return [
    new Paragraph({
      children: [new TextRun({ text: label, bold: true, font: FONT, size: 24 })],
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 4 } },
    }),
    table,
  ];
}

export type WordLabelMode = "normal" | "price_change";
// Chỉ giữ đúng các trường buildCell thật sự đọc tới — không ràng buộc theo
// Product nữa (combo giờ cũng là 1 dòng products với is_combo=true, đã tự
// khớp cấu trúc này nên không cần thêm mode riêng).
export type WordLabelItem = {
  ten_hang_hoa: string;
  gia_ban: number | null;
  ma_vach?: string | null;
  dvt?: string | null;
  gia_ban_old?: number | null;
};

export async function buildWordFile(items: WordLabelItem[], mode: WordLabelMode = "normal", promo?: PromoRange): Promise<Buffer> {
  const priced = items.filter((it) => it.gia_ban);
  const PER_PAGE = COLS * ROWS;
  const sections = [];
  let pageNum = 0;
  const today = new Date().toLocaleDateString("vi-VN");
  const labelPrefix = mode === "price_change" ? "Bảng giá khuyến mãi" : "Cập nhật giá";

  for (let i = 0; i < priced.length; i += PER_PAGE) {
    pageNum += 1;
    const chunk = priced.slice(i, i + PER_PAGE);
    const label = `${labelPrefix} ${today} - Trang ${String(pageNum).padStart(2, "0")}`;
    sections.push({
      properties: {
        page: {
          // docx's `orientation: LANDSCAPE` swaps whatever width/height it's
          // given, so passing already-landscape dimensions here double-swaps
          // back to portrait — pass the portrait-order values instead.
          size: { width: PAGE_H, height: PAGE_W, orientation: PageOrientation.LANDSCAPE },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      children: buildPage(label, chunk, mode, promo),
    });
  }

  if (sections.length === 0) {
    sections.push({
      properties: { page: { size: { width: PAGE_H, height: PAGE_W, orientation: PageOrientation.LANDSCAPE } } },
      children: [new Paragraph({ text: "Không có sản phẩm nào có giá bán lẻ trong danh sách đã chọn." })],
    });
  }

  const doc = new Document({ sections });
  return fixDuplicateDocPrIds(Buffer.from(await Packer.toBuffer(doc)));
}
