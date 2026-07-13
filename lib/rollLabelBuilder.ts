import { Document, Packer, Paragraph, TextRun, ImageRun, Tab, AlignmentType } from "docx";
import { Product } from "./types";
import { generateBarcodePng, pngDimensions } from "./barcodeImage";
import { estimateTextWidthPt } from "./textWidth";
import { fixDuplicateDocPrIds } from "./docxFixup";

// Single-label-per-page layout for roll label printers (e.g. iPOS IP3350):
// each page IS one physical 5x3cm label, not a grid of many labels on an
// A4 sheet. Every twips/spacing value below matches
// "Misa hàng hóa/Tem_test_5x3cm_3.docx" (read directly from its XML), the
// reference this shop already validated on a real printer.
//
// Known pitfalls this deliberately avoids:
// - No Table: a single-column table on a page this narrow can get
//   auto-expanded by Word/LibreOffice's default autofit. Plain paragraphs
//   directly in the page body don't have that failure mode.
// - Page size passed as-is (width > height) with default portrait
//   orientation — NOT `orientation: LANDSCAPE` with swapped dimensions.
//   docx swaps whatever width/height it's given when LANDSCAPE is set, so
//   doing both double-swaps back to the wrong shape (bit us already once
//   in wordBuilder.ts).
// - No padded blank second line for the title — Word/LibreOffice can
//   collapse a truly empty paragraph's height. This layout doesn't need one
//   (title is always exactly one line, enforced by fitTitleOneLine below).
// - Title fit is computed from real per-glyph widths (lib/textWidth.ts),
//   not character count — an "IIIII" and a "MMMMM" are not the same width.

const DXA_PER_CM = 566.929;
const cm = (v: number) => Math.round(v * DXA_PER_CM);
const TWIPS_PER_PT = 20;

const PAGE_W = cm(5);
const PAGE_H = cm(3);
const MARGIN = cm(0.15);
const CONTENT_WIDTH_DXA = PAGE_W - 2 * MARGIN;
const CONTENT_WIDTH_PT = CONTENT_WIDTH_DXA / TWIPS_PER_PT;

const FONT = "Arial";
const TITLE_SIZE_PT = 7;
const TITLE_MIN_SIZE_PT = 5;
const TITLE_LINE = 200; // exact twips, from reference
const ZONE_SPACING = 50; // twips, from reference — the "chia đều khoảng cách" gaps

const BARCODE_WIDTH_CM = 4.2;
const BARCODE_MAX_WIDTH_DXA = cm(BARCODE_WIDTH_CM);

const PRICE_SIZE_HALF = 20; // 10pt
const UNIT_SIZE_HALF = 15; // 7.5pt
const BOTTOM_LINE = 200; // exact twips, from reference
const BOTTOM_RIGHT_PAD = cm(0.15); // extra padding beyond the page margin, from reference

function fitTitleOneLine(name: string): { text: string; sizeHalf: number } {
  for (let sizePt = TITLE_SIZE_PT; sizePt >= TITLE_MIN_SIZE_PT; sizePt -= 0.5) {
    if (estimateTextWidthPt(name, sizePt) <= CONTENT_WIDTH_PT) {
      return { text: name, sizeHalf: Math.round(sizePt * 2) };
    }
  }
  let truncated = name;
  while (truncated.length > 1 && estimateTextWidthPt(truncated + "…", TITLE_MIN_SIZE_PT) > CONTENT_WIDTH_PT) {
    truncated = truncated.slice(0, -1);
  }
  return { text: truncated + "…", sizeHalf: Math.round(TITLE_MIN_SIZE_PT * 2) };
}

function formatPrice(n: number) {
  return Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".");
}

async function buildLabelSection(item: Product, barcodeValue: string) {
  const name = (item.ten_hoa_don || item.ten_hang_hoa).toUpperCase();
  const { text: titleText, sizeHalf: titleSizeHalf } = fitTitleOneLine(name);

  const titlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: ZONE_SPACING, after: ZONE_SPACING, line: TITLE_LINE, lineRule: "exact" },
    children: [new TextRun({ text: titleText, bold: true, font: FONT, size: titleSizeHalf })],
  });

  const barcodePng = await generateBarcodePng(barcodeValue);
  let barcodeChildren: (ImageRun | TextRun)[];
  if (barcodePng) {
    const { width, height } = pngDimensions(barcodePng);
    const displayWidth = BARCODE_MAX_WIDTH_DXA;
    const displayHeight = Math.round((displayWidth * height) / width);
    barcodeChildren = [new ImageRun({ type: "png", data: barcodePng, transformation: { width: displayWidth / TWIPS_PER_PT, height: displayHeight / TWIPS_PER_PT } })];
  } else {
    barcodeChildren = [new TextRun({ text: barcodeValue, font: FONT, size: 14 })];
  }
  const barcodePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: ZONE_SPACING },
    children: barcodeChildren,
  });

  const bottomLine = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0, line: BOTTOM_LINE, lineRule: "exact" },
    indent: { right: BOTTOM_RIGHT_PAD },
    tabStops: [{ type: "right", position: CONTENT_WIDTH_DXA - BOTTOM_RIGHT_PAD }],
    children: [
      new TextRun({ text: formatPrice(item.gia_ban!), bold: true, font: FONT, size: PRICE_SIZE_HALF }),
      new TextRun({ children: [new Tab()], font: FONT }),
      new TextRun({ text: (item.dvt || "").toUpperCase(), bold: true, font: FONT, size: UNIT_SIZE_HALF }),
    ],
  });

  return {
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      },
    },
    children: [titlePara, barcodePara, bottomLine],
  };
}

export async function buildRollLabelFile(items: { product: Product; barcode: string }[]): Promise<Buffer> {
  const eligible = items.filter((it) => it.product.gia_ban);
  const sections = await Promise.all(eligible.map((it) => buildLabelSection(it.product, it.barcode)));

  if (sections.length === 0) {
    sections.push({
      properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      children: [new Paragraph({ text: "Không có sản phẩm nào có giá bán lẻ trong danh sách đã chọn." })],
    } as any);
  }

  const doc = new Document({ sections });
  return fixDuplicateDocPrIds(Buffer.from(await Packer.toBuffer(doc)));
}
