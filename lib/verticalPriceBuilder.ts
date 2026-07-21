import path from "path";
import * as fontkit from "fontkit";
import pdfmake from "./pdfFonts";
import { CATEGORY_ORDER, Product } from "./types";

// One full A4 page per product — product name, a big fixed-size price, and a
// barcode/unit line pinned near the bottom. Switched from a .docx build
// (lib/wordBuilder.ts-style paragraphs/table) to a PDF: Word's own layout
// engine reflows cell/paragraph spacing differently across versions, which
// kept producing layout glitches; pdfmake renders every position exactly as
// specified, so the same page looks identical everywhere.

const PAGE_W = 595.28; // A4 portrait, pt
const PAGE_H = 841.89;
const MARGIN_X = 14; // pt, keeps text off the border frame — narrow enough that a
// typical 6-char price (page 1 of the reference: "30.000") still fits at the
// full 179pt instead of being shrunk
const MARGIN_TOP = 24;
const MARGIN_BOTTOM = 24;
// Gap kept between the title's baseline area and the price above it — the
// title sits right above the price instead of up near the top of the page,
// both so they read as one block and so a physical sign holder/frame (whose
// edge covers the first stretch of the page) can't hide the title behind it.
const TITLE_PRICE_GAP = 20;

const TITLE_SIZE = 36; // pt, Arial
const PRICE_SIZE = 179; // pt, Arial
const BARCODE_SIZE = 24; // pt, Arial
const UNIT_SIZE = 24; // pt, Arial

const CONTENT_WIDTH = PAGE_W - MARGIN_X * 2;
const BOTTOM_LINE_Y = PAGE_H - MARGIN_BOTTOM - UNIT_SIZE * 1.2;

function formatPrice(n: number) {
  return Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".");
}

// PRICE_SIZE (179pt) is only safe for short prices — measured against the
// real embedded Arimo-Bold glyphs (the actual font this PDF renders with), a
// 7+ digit price is wider than the page, which is exactly what caused it to
// wrap mid-number. Treat 179pt as a ceiling instead of a fixed size: shrink
// only as much as needed for each price to still fit on one line, so short
// prices still get the full size.
const priceFont = fontkit.openSync(path.join(process.cwd(), "public", "fonts", "Arimo-Bold.ttf"));
const PRICE_FIT_SAFETY = 0.99;

function priceEmWidth(text: string): number {
  const run = priceFont.layout(text);
  let advance = 0;
  for (const glyph of run.glyphs) advance += glyph.advanceWidth;
  return advance / priceFont.unitsPerEm;
}

function fitPriceSize(priceStr: string): number {
  const emWidth = priceEmWidth(priceStr);
  const maxByWidth = (CONTENT_WIDTH * PRICE_FIT_SAFETY) / emWidth;
  return Math.min(PRICE_SIZE, maxByWidth);
}

function sortForPrint(items: Product[]): Product[] {
  return [...items].sort((a, b) => {
    const catDiff = CATEGORY_ORDER.indexOf(a.category_sheet) - CATEGORY_ORDER.indexOf(b.category_sheet);
    if (catDiff !== 0) return catDiff;
    return a.ten_hang_hoa.localeCompare(b.ten_hang_hoa, "vi");
  });
}

// Roughly the visual height of a line of bold digits (cap-height to
// baseline, no descenders) — used only to center the price box on the page,
// not for precise typographic measurement.
const LINE_HEIGHT_FACTOR = 1.15;

function buildProductPage(item: Product, isFirst: boolean): any[] {
  const priceStr = formatPrice(item.gia_ban!);
  const priceSize = fitPriceSize(priceStr);
  const priceY = PAGE_H / 2 - (priceSize * LINE_HEIGHT_FACTOR) / 2;
  const titleY = priceY - TITLE_PRICE_GAP - TITLE_SIZE * LINE_HEIGHT_FACTOR;
  return [
    {
      text: item.ten_hang_hoa.toUpperCase(),
      bold: true,
      fontSize: TITLE_SIZE,
      alignment: "center",
      width: CONTENT_WIDTH,
      absolutePosition: { x: MARGIN_X, y: titleY },
      pageBreak: isFirst ? undefined : "before",
    },
    {
      text: priceStr,
      bold: true,
      fontSize: priceSize,
      alignment: "center",
      width: CONTENT_WIDTH,
      absolutePosition: { x: MARGIN_X, y: priceY },
    },
    { text: item.ma_vach || "", bold: true, fontSize: BARCODE_SIZE, absolutePosition: { x: MARGIN_X, y: BOTTOM_LINE_Y } },
    {
      text: (item.dvt || "").toUpperCase(),
      bold: true,
      fontSize: UNIT_SIZE,
      alignment: "right",
      width: CONTENT_WIDTH,
      absolutePosition: { x: MARGIN_X, y: BOTTOM_LINE_Y },
    },
  ];
}

export async function buildVerticalPricePdf(items: Product[]): Promise<Buffer> {
  const priced = sortForPrint(items.filter((it) => it.gia_ban));

  const content: any[] =
    priced.length === 0
      ? [{ text: "Không có sản phẩm nào có giá bán lẻ trong danh sách đã chọn." }]
      : priced.flatMap((item, i) => buildProductPage(item, i === 0));

  const docDefinition: any = {
    pageSize: "A4",
    pageMargins: [MARGIN_X, MARGIN_TOP, MARGIN_X, MARGIN_BOTTOM],
    background: (_page: number, pageSize: { width: number; height: number }) => ({
      canvas: [
        {
          type: "rect",
          x: 10,
          y: 10,
          w: pageSize.width - 20,
          h: pageSize.height - 20,
          lineWidth: 1,
          lineColor: "#000000",
        },
      ],
    }),
    defaultStyle: { font: "Arimo" },
    content,
  };

  const doc = pdfmake.createPdf(docDefinition);
  return doc.getBuffer();
}
