import fs from "fs";
import path from "path";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, VerticalAlign,
  HeightRule, PageOrientation, TableLayoutType, Tab, ImageRun,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType,
} from "docx";
import { Product } from "./types";

const DXA_PER_CM = 566.929;
const cm = (v: number) => Math.round(v * DXA_PER_CM);

const BLOCK_W = cm(7.7);
const BLOCK_H = cm(4.0);
const MARGIN = cm(1.0);
const PAGE_W = cm(29.7);
const PAGE_H = cm(21.0);
const COLS = 3;
const ROWS = 3;
const FONT = "Arial";

const TITLE_ZONE_PT = 1.0 * 28.3465;
const PRICE_ZONE_PT = 2.7 * 28.3465;
const BOTTOM_ZONE_PT = 0.4 * 28.3465;
const SAFETY = 1.15;
const CHAR_WIDTH_FACTOR = 0.66;

const LOGO_PATH = path.join(process.cwd(), "public", "templates", "logo.png");
const LOGO_ORIG_W = 4230;
const LOGO_ORIG_H = 1362;
const LOGO_DISPLAY_W = 90;
const LOGO_DISPLAY_H = Math.round((LOGO_DISPLAY_W * LOGO_ORIG_H) / LOGO_ORIG_W);
const EMU_PER_CM = 360000;

function logoImageRun() {
  if (!fs.existsSync(LOGO_PATH)) return null;
  return new ImageRun({
    type: "png",
    data: fs.readFileSync(LOGO_PATH),
    transformation: { width: LOGO_DISPLAY_W, height: LOGO_DISPLAY_H },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0.3 * EMU_PER_CM },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0.3 * EMU_PER_CM },
      wrap: { type: TextWrappingType.TOP_AND_BOTTOM },
    },
  });
}

function titleFontSize(name: string) {
  const len = name.length;
  if (len > 34) return 32;
  if (len > 24) return 36;
  if (len > 16) return 40;
  return 44;
}

function wrapTitle(name: string, maxCharsPerLine: number) {
  const words = name.split(" ");
  let lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = (cur + " " + w).trim();
    if (trial.length <= maxCharsPerLine) cur = trial;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) lines = [lines[0], lines.slice(1).join(" ")];
  return lines;
}

function fitTitle(name: string) {
  const boxWidthPt = ((BLOCK_W / DXA_PER_CM) - 0.24) * 28.3465;
  let sizeHalf = titleFontSize(name);
  while (sizeHalf >= 12) {
    const sizePt = sizeHalf / 2;
    const maxChars = Math.max(1, Math.floor(boxWidthPt / (sizePt * CHAR_WIDTH_FACTOR * SAFETY)));
    const lines = wrapTitle(name, maxChars);
    const widest = Math.max(...lines.map((l) => l.length));
    const estWidthPt = widest * sizePt * CHAR_WIDTH_FACTOR * SAFETY;
    const estHeightPt = lines.length * sizePt * 1.15 * SAFETY;
    if (estWidthPt <= boxWidthPt && estHeightPt <= TITLE_ZONE_PT) return { lines, sizeHalf };
    sizeHalf -= 2;
  }
  const sizePt = 6;
  const maxChars = Math.max(1, Math.floor(boxWidthPt / (sizePt * CHAR_WIDTH_FACTOR * SAFETY)));
  return { lines: wrapTitle(name, maxChars).slice(0, 2), sizeHalf: 12 };
}

function priceFontSizeHalf(price: string) {
  // Same per-char width factor as fitTitle() — bold digits are wider than the
  // 0.5 previously used here, which let long prices (e.g. "63.000") overflow
  // past the block's left/right edge in some renderers.
  const boxWidthPt = ((BLOCK_W / DXA_PER_CM) - 0.24) * 28.3465;
  const numChars = price.length;
  const sizeFromWidth = boxWidthPt / (numChars * CHAR_WIDTH_FACTOR * SAFETY);
  const sizeFromHeight = PRICE_ZONE_PT / (1.15 * SAFETY);
  const sizePt = Math.min(sizeFromWidth, sizeFromHeight);
  return Math.round(sizePt * 2);
}

function unitFontSizeHalf(unit: string) {
  const boxWidthPt = (BLOCK_W / DXA_PER_CM) * 0.55 * 28.3465;
  const sizeFromHeight = BOTTOM_ZONE_PT / (1.15 * SAFETY);
  const sizeFromWidth = boxWidthPt / (Math.max(unit.length, 1) * 0.6 * SAFETY);
  const sizePt = Math.min(sizeFromHeight, sizeFromWidth, 19);
  return Math.round(sizePt * 2);
}

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const cellBorderThin = {
  top: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
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
  const { lines, sizeHalf: tSize } = fitTitle(name);
  const SIDE_MARGIN_DXA = cm(0.12);
  const displayLines = lines.length < 2 ? [...lines, ""] : lines;
  const titleParas = displayLines.map(
    (l) =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0, line: 240, lineRule: "auto" },
        indent: { left: SIDE_MARGIN_DXA, right: SIDE_MARGIN_DXA },
        children: [new TextRun({ text: l, bold: true, font: FONT, size: tSize })],
      })
  );

  const priceStr = formatPrice(item.gia_ban);
  const priceSize = priceFontSizeHalf(priceStr);
  const priceParas = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 },
      indent: { left: SIDE_MARGIN_DXA, right: SIDE_MARGIN_DXA },
      children: [new TextRun({ text: priceStr, bold: true, font: FONT, size: priceSize })],
    }),
  ];

  const unitSize = unitFontSizeHalf(item.dvt || "");
  const bottomLine = new Paragraph({
    tabStops: [{ type: "right", position: BLOCK_W - SIDE_MARGIN_DXA }],
    spacing: { before: 0 },
    indent: { left: SIDE_MARGIN_DXA, right: SIDE_MARGIN_DXA },
    children: [
      new TextRun({ text: item.ma_vach || item.ma_hang_hoa || "", font: FONT, size: 16 }),
      new TextRun({ children: [new Tab()], font: FONT }),
      new TextRun({ text: (item.dvt || "").toUpperCase(), bold: true, font: FONT, size: unitSize }),
    ],
  });

  return new TableCell({
    width: { size: BLOCK_W, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 20, bottom: cm(0.1), left: 0, right: 0 },
    borders: cellBorderThin,
    children: [...titleParas, ...priceParas, bottomLine],
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
  const headerChildren = logo
    ? [logo, new TextRun({ text: label, bold: true, font: FONT, size: 32 })]
    : [new TextRun({ text: label, bold: true, font: FONT, size: 32 })];

  return [
    new Paragraph({
      children: headerChildren,
      spacing: { after: 120 },
      indent: { left: logo ? cm(2.7) : 0 },
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
          size: { width: PAGE_W, height: PAGE_H, orientation: PageOrientation.LANDSCAPE },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      children: buildPage(label, chunk),
    });
  }

  if (sections.length === 0) {
    sections.push({
      properties: { page: { size: { width: PAGE_W, height: PAGE_H } } },
      children: [new Paragraph({ text: "Không có sản phẩm nào có giá bán lẻ trong danh sách đã chọn." })],
    });
  }

  const doc = new Document({ sections });
  return Buffer.from(await Packer.toBuffer(doc));
}
