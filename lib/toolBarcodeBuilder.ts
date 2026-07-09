import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, VerticalAlign,
  HeightRule, PageOrientation, TableLayoutType, ImageRun,
} from "docx";
import { Product } from "./types";
import { generateBarcodePng } from "./barcodeImage";

// Separate 5x3cm barcode-tag layout for the "Công cụ dụng cụ" sheet — smaller
// than the 7.7x4cm price tags, and shows a real scannable barcode image
// instead of printing the mã vạch as plain digits.

const DXA_PER_CM = 566.929;
const cm = (v: number) => Math.round(v * DXA_PER_CM);

const BLOCK_W = cm(5);
const BLOCK_H = cm(3);
const MARGIN = cm(1.0);
const PAGE_W = cm(29.7);
const PAGE_H = cm(21.0);
const COLS = 5; // floor(27.7cm usable width / 5cm)
const ROWS = 6; // floor(19cm usable height / 3cm)
const FONT = "Arial";

const CELL_MARGIN = cm(0.1);
const CELL_BORDER_SIZE = 4;

const TITLE_SIZE_HALF = 14; // 7pt — small block, titles can be long, let Word wrap
const PRICE_SIZE_HALF = 28; // 14pt

const BARCODE_IMG_W = 130; // px, ~3.4cm at 96dpi
const BARCODE_IMG_H = 50; // px, ~1.3cm at 96dpi

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

async function buildCell(item: Product | null): Promise<TableCell> {
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
    spacing: { after: 40 },
    children: [new TextRun({ text: name, bold: true, font: FONT, size: TITLE_SIZE_HALF })],
  });

  const barcodePng = await generateBarcodePng(item.ma_vach || "");
  const barcodePara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: barcodePng
      ? [new ImageRun({ type: "png", data: barcodePng, transformation: { width: BARCODE_IMG_W, height: BARCODE_IMG_H } })]
      : [new TextRun({ text: "Chưa có mã vạch", font: FONT, size: 14, italics: true })],
  });

  const pricePara = new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 0 },
    children: [new TextRun({ text: formatPrice(item.gia_ban), bold: true, font: FONT, size: PRICE_SIZE_HALF })],
  });

  return new TableCell({
    width: { size: BLOCK_W, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: CELL_MARGIN, bottom: CELL_MARGIN, left: CELL_MARGIN, right: CELL_MARGIN },
    borders: cellBorderThin,
    children: [titlePara, barcodePara, pricePara],
  });
}

async function buildPage(label: string, items: (Product | null)[]) {
  const rows: TableRow[] = [];
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    const cells: TableCell[] = [];
    for (let c = 0; c < COLS; c++) {
      cells.push(await buildCell(items[idx] ?? null));
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
      spacing: { after: 150 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 4 } },
    }),
    table,
  ];
}

export async function buildToolBarcodeFile(items: Product[]): Promise<Buffer> {
  const priced = items.filter((it) => it.gia_ban);
  const PER_PAGE = COLS * ROWS;
  const sections = [];
  let pageNum = 0;
  const today = new Date().toLocaleDateString("vi-VN");

  for (let i = 0; i < priced.length; i += PER_PAGE) {
    pageNum += 1;
    const chunk = priced.slice(i, i + PER_PAGE);
    const label = `Tem mã vạch Công cụ dụng cụ ${today} - Trang ${String(pageNum).padStart(2, "0")}`;
    sections.push({
      properties: {
        page: {
          size: { width: PAGE_H, height: PAGE_W, orientation: PageOrientation.LANDSCAPE },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      children: await buildPage(label, chunk),
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
