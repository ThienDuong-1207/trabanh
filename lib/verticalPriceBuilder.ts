import fs from "fs";
import path from "path";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, VerticalAlign,
  HeightRule, TableLayoutType, Tab, ImageRun,
} from "docx";
import { CATEGORY_ORDER, Product } from "./types";
import { fixDuplicateDocPrIds } from "./docxFixup";

// Page size, margins, border weight, and title/barcode/unit sizes are taken
// directly from "Misa hàng hóa/Bang gia dung Sua + Rich lun.docx" — the
// shop's own hand-built full-page vertical price sign — by unzipping it and
// reading word/document.xml. Only the price font size is computed (the
// reference hand-tunes it per product instead), reusing the same
// width/height-fit approach as lib/wordBuilder.ts's small price blocks,
// recalibrated for a full A4 page instead of a 7.7x4cm cell.

const PAGE_W = 11906; // A4 portrait, dxa — matches reference pgSz
const PAGE_H = 16838;
const MARGIN_TOP_BOTTOM = 567; // dxa, matches reference pgMar top/bottom
const MARGIN_SIDE = 0; // matches reference pgMar left/right

const FONT = "Arial";
const TITLE_SIZE_HALF = 72; // 36pt, matches reference
const BARCODE_SIZE_HALF = 40; // 20pt, matches reference
const UNIT_SIZE_HALF = 48; // 24pt, matches reference
const CELL_BORDER_SIZE = 4; // matches reference tblBorders sz (eighths of a point)
const BOTTOM_TAB_POS = PAGE_W; // right-aligned tab stop at the full page width

// Reserves room above the table for the logo line, so the table's own
// "atLeast" height still leaves the whole page — logo included — on one
// page instead of spilling onto a second.
const LOGO_RESERVE_DXA = 400;
const TABLE_H = PAGE_H - MARGIN_TOP_BOTTOM * 2 - LOGO_RESERVE_DXA;

const TITLE_LINE = Math.round(36 * 1.15 * 20); // twips
const BOTTOM_LINE = Math.round(24 * 1.15 * 20); // twips, off the larger of the two bottom-line fonts
const PRICE_SPACING_AFTER = 200; // twips, gap kept between price and the barcode/unit line

const SAFETY = 1.15;
const DIGIT_WIDTH_EM = 0.556;
const SEPARATOR_WIDTH_EM = 0.278;
const DXA_PER_CM = 566.929;
const PRICE_BOX_WIDTH_PT = (PAGE_W / DXA_PER_CM - 1) * 28.3465; // -1cm allowance for cell padding

function estimatePriceWidthUnits(price: string): number {
  let units = 0;
  for (const ch of price) units += /[.,]/.test(ch) ? SEPARATOR_WIDTH_EM : DIGIT_WIDTH_EM;
  return units;
}

const PRICE_ZONE_PT = (TABLE_H - TITLE_LINE - PRICE_SPACING_AFTER - BOTTOM_LINE) / 20;

function priceFontSizeHalf(price: string) {
  const sizeFromWidth = PRICE_BOX_WIDTH_PT / (estimatePriceWidthUnits(price) * SAFETY);
  const sizeFromHeight = PRICE_ZONE_PT / (1.15 * SAFETY);
  return Math.round(Math.min(sizeFromWidth, sizeFromHeight) * 2);
}

const FIXED_ZONES_DXA = TITLE_LINE + BOTTOM_LINE;

function priceSpacingDxa(priceSizeHalf: number): { before: number; after: number } {
  const priceLineDxa = Math.round((priceSizeHalf / 2) * 1.15 * 20);
  const leftover = Math.max(0, TABLE_H - FIXED_ZONES_DXA - priceLineDxa);
  const before = Math.floor(leftover / 2);
  const after = Math.max(PRICE_SPACING_AFTER, leftover - before);
  return { before, after };
}

const LOGO_PATH = path.join(process.cwd(), "public", "templates", "logo.png");
const LOGO_DISPLAY_W = 68; // px; reference logo is 857250 EMU wide (~2.38cm)
const LOGO_DISPLAY_H = 22; // px; reference logo is 276225 EMU tall (~0.77cm)

function logoImageRun() {
  if (!fs.existsSync(LOGO_PATH)) return null;
  return new ImageRun({
    type: "png",
    data: fs.readFileSync(LOGO_PATH),
    transformation: { width: LOGO_DISPLAY_W, height: LOGO_DISPLAY_H },
  });
}

const cellBorderThin = {
  top: { style: BorderStyle.SINGLE, size: CELL_BORDER_SIZE, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: CELL_BORDER_SIZE, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: CELL_BORDER_SIZE, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: CELL_BORDER_SIZE, color: "000000" },
};

function formatPrice(n: number) {
  return Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".");
}

function buildPage(item: Product) {
  const logo = logoImageRun();
  const logoPara = new Paragraph({ children: logo ? [logo] : [] });

  const name = item.ten_hang_hoa.toUpperCase();
  const titlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: name, bold: true, font: FONT, size: TITLE_SIZE_HALF })],
  });

  const priceStr = formatPrice(item.gia_ban!);
  const priceSize = priceFontSizeHalf(priceStr);
  const { before: priceBefore, after: priceAfter } = priceSpacingDxa(priceSize);
  const pricePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: priceBefore, after: priceAfter },
    children: [new TextRun({ text: priceStr, bold: true, font: FONT, size: priceSize })],
  });

  const bottomLine = new Paragraph({
    tabStops: [{ type: "right", position: BOTTOM_TAB_POS }],
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: item.ma_vach || "", font: FONT, size: BARCODE_SIZE_HALF }),
      new TextRun({ children: [new Tab()], font: FONT }),
      new TextRun({ text: (item.dvt || "").toUpperCase(), bold: true, font: FONT, size: UNIT_SIZE_HALF }),
    ],
  });

  const cell = new TableCell({
    width: { size: PAGE_W, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    borders: cellBorderThin,
    children: [titlePara, pricePara, bottomLine],
  });

  const table = new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: [PAGE_W],
    layout: TableLayoutType.FIXED,
    rows: [new TableRow({ height: { value: TABLE_H, rule: HeightRule.ATLEAST }, children: [cell] })],
  });

  return [logoPara, table];
}

function sortForPrint(items: Product[]): Product[] {
  return [...items].sort((a, b) => {
    const catDiff = CATEGORY_ORDER.indexOf(a.category_sheet) - CATEGORY_ORDER.indexOf(b.category_sheet);
    if (catDiff !== 0) return catDiff;
    return a.ten_hang_hoa.localeCompare(b.ten_hang_hoa, "vi");
  });
}

export async function buildVerticalPriceDocx(items: Product[]): Promise<Buffer> {
  const priced = sortForPrint(items.filter((it) => it.gia_ban));

  const sections: any[] = priced.map((item) => ({
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: MARGIN_TOP_BOTTOM, bottom: MARGIN_TOP_BOTTOM, left: MARGIN_SIDE, right: MARGIN_SIDE },
      },
    },
    children: buildPage(item),
  }));

  if (sections.length === 0) {
    sections.push({
      properties: { page: { size: { width: PAGE_W, height: PAGE_H } } },
      children: [new Paragraph({ text: "Không có sản phẩm nào có giá bán lẻ trong danh sách đã chọn." })],
    });
  }

  const doc = new Document({ sections });
  return fixDuplicateDocPrIds(Buffer.from(await Packer.toBuffer(doc)));
}
