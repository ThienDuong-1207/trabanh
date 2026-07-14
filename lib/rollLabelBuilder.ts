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

// estimateTextWidthPt is an approximation (published AFM metrics, not the
// actual installed font's real hinting), and fitTitleOneLine's truncation
// loop below stops as soon as the estimate says it fits — landing right at
// the boundary with ~0 real margin. A title that JUST needs full truncation
// to fit hit this: our estimate said 132.41pt fit inside a 133.25pt budget
// (0.6% to spare), but Word's actual render came out wider and wrapped to a
// second line, which overflowed this section onto a blank extra page
// (TITLE_LINE's "exact" height budgets for exactly one line). Shrink the
// budget those comparisons use so a small estimation error can never
// actually reach the true page width.
const TITLE_FIT_SAFETY = 1.08;
const TITLE_FIT_WIDTH_PT = CONTENT_WIDTH_PT / TITLE_FIT_SAFETY;

// docx's ImageRun `transformation.width/height` are pixels at 96 DPI, NOT
// points — 1440 twips/inch ÷ 96 px/inch = 15 twips/px. Dividing by
// TWIPS_PER_PT (20, twips/point) here would under-size every barcode image
// by 20/15 (25% smaller than intended).
const TWIPS_PER_PX_96DPI = 15;

const FONT = "Arial";
const TITLE_SIZE_PT = 7;
// Pushed down from 5pt: prefer shrinking a one-line title as far as
// legibly possible before giving up and wrapping to a second line (which
// costs an extra TITLE_LINE of vertical budget that would otherwise go to
// the barcode/price).
const TITLE_MIN_SIZE_PT = 4;
const TITLE_LINE = 200; // exact twips, from reference
const ZONE_SPACING = 50; // twips, from reference — the "chia đều khoảng cách" gaps

const BARCODE_WIDTH_CM = 4.2;
const BARCODE_MAX_WIDTH_DXA = cm(BARCODE_WIDTH_CM);

const PRICE_SIZE_HALF = 20; // 10pt
const UNIT_SIZE_HALF = 15; // 7.5pt
const BOTTOM_LINE = 200; // exact twips, from reference
const BOTTOM_RIGHT_PAD = cm(0.15); // extra padding beyond the page margin, from reference

// The reference's 4.2cm-wide barcode extent only fits because that one
// barcode's native aspect ratio happens to leave enough vertical room. Short
// codes (e.g. a 4-digit Code128 value) render relatively taller for the same
// width — scaling by width alone let that taller image push the bottom
// price/unit line onto a second page within the same section, which on this
// page's fixed 3cm height showed up as a near-blank extra "tag". Cap the
// image's height to whatever's actually left after the title and bottom
// line reserve their space, and shrink width to match if needed. A two-line
// title costs one extra TITLE_LINE, so this budget depends on how many
// lines the title actually ended up using.
const CONTENT_HEIGHT_DXA = PAGE_H - 2 * MARGIN;
const MIN_BARCODE_HEIGHT_DXA = cm(0.3); // floor so an extreme (2-line, min-size) title can't zero out the image

function barcodeMaxHeightDxa(titleLines: number): number {
  const titleZoneDxa = 2 * ZONE_SPACING + titleLines * TITLE_LINE;
  return Math.max(MIN_BARCODE_HEIGHT_DXA, CONTENT_HEIGHT_DXA - titleZoneDxa - BOTTOM_LINE - ZONE_SPACING);
}

// Splits `name` across exactly two lines at a word boundary, greedily
// filling line 1. Returns null if that boundary split still doesn't fit
// (e.g. the remainder is wider than the page even alone), so the caller can
// try a smaller size before falling back to truncation.
function splitTwoLines(name: string, sizePt: number, maxWidthPt: number): [string, string] | null {
  const words = name.split(" ");
  if (words.length < 2) return null;
  let line1 = words[0];
  let idx = 1;
  for (; idx < words.length; idx++) {
    const candidate = `${line1} ${words[idx]}`;
    if (estimateTextWidthPt(candidate, sizePt) > maxWidthPt) break;
    line1 = candidate;
  }
  const line2 = words.slice(idx).join(" ");
  if (!line2 || estimateTextWidthPt(line2, sizePt) > maxWidthPt) return null;
  return [line1, line2];
}

// Prefers a single line, shrinking down to TITLE_MIN_SIZE_PT before ever
// wrapping — wrapping costs an extra line of vertical budget the
// barcode/price would otherwise get. Only wraps to two lines if no size
// lets the whole name fit on one; only truncates (last resort) if not even
// two lines at the smallest size can fit the whole name.
function fitTitle(name: string): { lines: string[]; sizeHalf: number } {
  for (let sizePt = TITLE_SIZE_PT; sizePt >= TITLE_MIN_SIZE_PT; sizePt -= 0.5) {
    if (estimateTextWidthPt(name, sizePt) <= TITLE_FIT_WIDTH_PT) {
      return { lines: [name], sizeHalf: Math.round(sizePt * 2) };
    }
  }
  for (let sizePt = TITLE_SIZE_PT; sizePt >= TITLE_MIN_SIZE_PT; sizePt -= 0.5) {
    const split = splitTwoLines(name, sizePt, TITLE_FIT_WIDTH_PT);
    if (split) return { lines: split, sizeHalf: Math.round(sizePt * 2) };
  }

  // Even two lines at the smallest size doesn't cleanly fit at a word
  // boundary (an extremely long name) — force it: fill line 1 with as many
  // words as fit, then truncate whatever's left for line 2.
  const words = name.split(" ");
  let line1 = words[0] ?? name;
  let idx = 1;
  for (; idx < words.length; idx++) {
    const candidate = `${line1} ${words[idx]}`;
    if (estimateTextWidthPt(candidate, TITLE_MIN_SIZE_PT) > TITLE_FIT_WIDTH_PT) break;
    line1 = candidate;
  }
  while (line1.length > 1 && estimateTextWidthPt(line1, TITLE_MIN_SIZE_PT) > TITLE_FIT_WIDTH_PT) {
    line1 = line1.slice(0, -1);
  }
  let line2 = words.slice(idx).join(" ");
  while (line2.length > 1 && estimateTextWidthPt(`${line2}…`, TITLE_MIN_SIZE_PT) > TITLE_FIT_WIDTH_PT) {
    line2 = line2.slice(0, -1);
  }
  return { lines: [line1, `${line2}…`], sizeHalf: Math.round(TITLE_MIN_SIZE_PT * 2) };
}

function formatPrice(n: number) {
  return Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".");
}

async function buildLabelSection(item: Product, barcodeValue: string) {
  const name = item.ten_hang_hoa.toUpperCase();
  const { lines: titleLines, sizeHalf: titleSizeHalf } = fitTitle(name);

  const titlePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: ZONE_SPACING, after: ZONE_SPACING, line: TITLE_LINE, lineRule: "exact" },
    children: titleLines.map(
      (line, i) => new TextRun({ text: line, bold: true, font: FONT, size: titleSizeHalf, break: i > 0 ? 1 : undefined })
    ),
  });

  const barcodeMaxHeight = barcodeMaxHeightDxa(titleLines.length);
  const barcodePng = await generateBarcodePng(barcodeValue);
  let barcodeChildren: (ImageRun | TextRun)[];
  if (barcodePng) {
    const { width, height } = pngDimensions(barcodePng);
    let displayWidth = BARCODE_MAX_WIDTH_DXA;
    let displayHeight = Math.round((displayWidth * height) / width);
    if (displayHeight > barcodeMaxHeight) {
      displayHeight = barcodeMaxHeight;
      displayWidth = Math.round((displayHeight * width) / height);
    }
    barcodeChildren = [new ImageRun({ type: "png", data: barcodePng, transformation: { width: displayWidth / TWIPS_PER_PX_96DPI, height: displayHeight / TWIPS_PER_PX_96DPI } })];
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

// A section always emits title+barcode+bottom-line together from one
// product's data, so a "blank tag" can't come from a genuinely missing
// field further down the line — but skip defensively anyway rather than
// ever hand a broken/incomplete tag to the printer.
function hasUsableData(item: Product, barcode: string): boolean {
  const name = (item.ten_hang_hoa || "").trim();
  return name.length > 0 && barcode.trim().length > 0;
}

export async function buildRollLabelFile(items: { product: Product; barcode: string }[]): Promise<Buffer> {
  const eligible = items.filter((it) => it.product.gia_ban && hasUsableData(it.product, it.barcode));
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
