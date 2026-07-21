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
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 24;

const TITLE_SIZE = 36; // pt, matches the shop's old vertical-sign reference
const PRICE_SIZE = 179; // pt, matches the shop's old vertical-sign reference
const BARCODE_SIZE = 20;
const UNIT_SIZE = 24;

const CONTENT_WIDTH = PAGE_W - MARGIN_X * 2;
const BOTTOM_LINE_Y = PAGE_H - MARGIN_BOTTOM - UNIT_SIZE * 1.2;

function formatPrice(n: number) {
  return Math.round(n).toLocaleString("vi-VN").replace(/,/g, ".");
}

// PRICE_SIZE (179pt, from the reference) is only safe for short prices —
// measured against the real embedded Roboto-Medium glyphs (the actual font
// this PDF renders with), a 6-digit price like "41.000" is already wider
// than the page, which is exactly what caused it to wrap mid-number. Treat
// 179pt as a ceiling instead of a fixed size: shrink only as much as needed
// for each price to still fit on one line, so short prices still get the
// full reference size.
const priceFont = fontkit.openSync(path.join(process.cwd(), "public", "fonts", "Roboto-Medium.ttf"));
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

function buildProductPage(item: Product, isFirst: boolean): any[] {
  const priceStr = formatPrice(item.gia_ban!);
  const priceSize = fitPriceSize(priceStr);
  return [
    {
      stack: [
        { text: item.ten_hang_hoa.toUpperCase(), bold: true, fontSize: TITLE_SIZE, alignment: "center" },
        { text: priceStr, bold: true, fontSize: priceSize, alignment: "center", margin: [0, 90, 0, 0] },
      ],
      pageBreak: isFirst ? undefined : "before",
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
    defaultStyle: { font: "Roboto" },
    content,
  };

  const doc = pdfmake.createPdf(docDefinition);
  return doc.getBuffer();
}
