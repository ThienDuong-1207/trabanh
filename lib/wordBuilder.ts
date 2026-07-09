import fs from "fs";
import path from "path";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, VerticalAlign,
  HeightRule, PageOrientation, TableLayoutType, Tab, ImageRun,
} from "docx";
import { Product } from "./types";

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

// Title: the reference never varies this — even a 42-character name stays
// one line at this size within the 7.7cm block, so there's no need for the
// dynamic multi-line-fitting this file used to do.
const TITLE_SIZE_HALF = 20; // 10pt
const TITLE_LINE = 220; // exact twips, reference spacing/line
const PRICE_SPACING_AFTER = 49; // twips, reference spacing/after on the price paragraph
const BOTTOM_LINE = 198; // exact twips, reference spacing/line
const BOTTOM_INDENT = 85; // twips, reference ind left/right
const BOTTOM_TAB_POS = 4139; // dxa, reference right-aligned tab stop
const BARCODE_SIZE_HALF = 15; // 7.5pt
const UNIT_SIZE_HALF = 18; // 9pt

// Price gets every bit of vertical room left in the block after the fixed
// zones (top margin, title line, the gap after the price, the bottom line,
// and the tightened bottom margin) — instead of a fixed conservative
// budget, so the price grows to fill the block rather than leaving empty
// space above the barcode/unit line.
const PRICE_ZONE_PT = (BLOCK_H - CELL_MARGIN_TOP - TITLE_LINE - PRICE_SPACING_AFTER - BOTTOM_LINE - CELL_MARGIN_BOTTOM) / 20;
const SAFETY = 1.15;
const DIGIT_WIDTH_EM = 0.556;
const SEPARATOR_WIDTH_EM = 0.278;
// Calibrated (not the literal cell margin) — this specific allowance is what
// reproduces the reference's actual sizes almost exactly (60pt/6-char,
// 62pt/5-char, 51.5pt/7-char) when combined with the glyph widths above.
const PRICE_BOX_WIDTH_PT = ((BLOCK_W / DXA_PER_CM) - 0.24) * 28.3465;

function estimatePriceWidthUnits(price: string): number {
  let units = 0;
  for (const ch of price) units += /[.,]/.test(ch) ? SEPARATOR_WIDTH_EM : DIGIT_WIDTH_EM;
  return units;
}

function priceFontSizeHalf(price: string) {
  const sizeFromWidth = PRICE_BOX_WIDTH_PT / (estimatePriceWidthUnits(price) * SAFETY);
  const sizeFromHeight = PRICE_ZONE_PT / (1.15 * SAFETY);
  return Math.round(Math.min(sizeFromWidth, sizeFromHeight) * 2);
}

// Most real prices are width-capped (e.g. every 6-character price lands at
// 60pt regardless of the height ceiling above), so the price paragraph's own
// line is usually much shorter than the vertical budget it was given. Split
// that leftover evenly before/after the price instead of dumping it all
// after: the barcode/unit line stays pinned to the bottom margin either way,
// but the price itself sits centered between the title and the barcode line
// rather than stuck right under the title.
const FIXED_ZONES_DXA = CELL_MARGIN_TOP + TITLE_LINE + BOTTOM_LINE + CELL_MARGIN_BOTTOM;

function priceSpacingDxa(priceSizeHalf: number): { before: number; after: number } {
  const priceLineDxa = Math.round((priceSizeHalf / 2) * 1.15 * 20);
  const leftover = Math.max(0, BLOCK_H - FIXED_ZONES_DXA - priceLineDxa);
  const before = Math.floor(leftover / 2);
  const after = Math.max(PRICE_SPACING_AFTER, leftover - before);
  return { before, after };
}

const LOGO_PATH = path.join(process.cwd(), "public", "templates", "logo.png");
const LOGO_DISPLAY_W = 68; // px; reference logo is 857250 EMU wide (~2.38cm)
const LOGO_DISPLAY_H = 22; // px; reference logo is 276225 EMU tall (~0.77cm)

function logoImageRun() {
  if (!fs.existsSync(LOGO_PATH)) return null;
  // Inline (flows with the header text), matching the reference — the
  // previous version absolutely-positioned the logo over the page instead.
  return new ImageRun({
    type: "png",
    data: fs.readFileSync(LOGO_PATH),
    transformation: { width: LOGO_DISPLAY_W, height: LOGO_DISPLAY_H },
  });
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

function buildCell(item: Product | null) {
  if (!item || !item.gia_ban) {
    return new TableCell({
      width: { size: BLOCK_W, type: WidthType.DXA },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
      children: [new Paragraph({ text: "" })],
    });
  }
  const name = (item.ten_hoa_don || item.ten_hang_hoa).toUpperCase();
  const titlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0, line: TITLE_LINE, lineRule: "exact" },
    children: [new TextRun({ text: name, bold: true, font: FONT, size: TITLE_SIZE_HALF })],
  });

  const priceStr = formatPrice(item.gia_ban);
  const priceSize = priceFontSizeHalf(priceStr);
  const { before: priceBefore, after: priceAfter } = priceSpacingDxa(priceSize);
  const pricePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: priceBefore, after: priceAfter },
    children: [new TextRun({ text: priceStr, bold: true, font: FONT, size: priceSize })],
  });

  const bottomLine = new Paragraph({
    tabStops: [{ type: "right", position: BOTTOM_TAB_POS }],
    spacing: { line: BOTTOM_LINE, lineRule: "exact" },
    indent: { left: BOTTOM_INDENT, right: BOTTOM_INDENT },
    children: [
      new TextRun({ text: item.ma_vach || item.ma_hang_hoa || "", font: FONT, size: BARCODE_SIZE_HALF }),
      new TextRun({ children: [new Tab()], font: FONT }),
      new TextRun({ text: (item.dvt || "").toUpperCase(), bold: true, font: FONT, size: UNIT_SIZE_HALF }),
    ],
  });

  return new TableCell({
    width: { size: BLOCK_W, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: CELL_MARGIN_TOP, bottom: CELL_MARGIN_BOTTOM, left: CELL_MARGIN_SIDE, right: CELL_MARGIN_SIDE },
    borders: cellBorderThin,
    children: [titlePara, pricePara, bottomLine],
  });
}

function buildPage(label: string, items: (Product | null)[]) {
  const rows: TableRow[] = [];
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    const cells: TableCell[] = [];
    for (let c = 0; c < COLS; c++) {
      cells.push(buildCell(items[idx] ?? null));
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

  const logo = logoImageRun();
  const headerChildren = [
    ...(logo ? [logo] : []),
    new TextRun({ text: `  ${label}`, bold: true, font: FONT, size: 24 }),
  ];

  return [
    new Paragraph({
      children: headerChildren,
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 4 } },
    }),
    table,
  ];
}

export async function buildWordFile(items: Product[]): Promise<Buffer> {
  const priced = items.filter((it) => it.gia_ban);
  const PER_PAGE = COLS * ROWS;
  const sections = [];
  let pageNum = 0;
  const today = new Date().toLocaleDateString("vi-VN");

  for (let i = 0; i < priced.length; i += PER_PAGE) {
    pageNum += 1;
    const chunk = priced.slice(i, i + PER_PAGE);
    const label = `Cập nhật giá ${today} - Trang ${String(pageNum).padStart(2, "0")}`;
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
      children: buildPage(label, chunk),
    });
  }

  if (sections.length === 0) {
    sections.push({
      properties: { page: { size: { width: PAGE_H, height: PAGE_W, orientation: PageOrientation.LANDSCAPE } } },
      children: [new Paragraph({ text: "Không có sản phẩm nào có giá bán lẻ trong danh sách đã chọn." })],
    });
  }

  const doc = new Document({ sections });
  return Buffer.from(await Packer.toBuffer(doc));
}
