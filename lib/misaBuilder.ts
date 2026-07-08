import JSZip from "jszip";
import fs from "fs";
import path from "path";
import { Product } from "./types";

const TEMPLATE_PATH = path.join(process.cwd(), "public", "templates", "Nhap_khau_hang_hoa_MISA.xlsx");
const cellsTemplate: [string, string | null][] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "lib", "row6_template.json"), "utf-8")
);

const LOAI_KHONG_THUOC_TINH = "Hàng hóa không có thuộc tính";
const LOAI_HANG_CHA = "Hàng hóa cha ";
const LOAI_HANG_CON_DVT = "Hàng hóa con theo đơn vị tính";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildRow(rIdx: number, values: Record<string, string>, numValues: Record<string, number | null | undefined>) {
  const parts: string[] = [`<row r="${rIdx}" spans="1:58" ht="16.5" x14ac:dyDescent="0.25">`];
  for (const [col, style] of cellsTemplate) {
    const styleAttr = style ? ` s="${style}"` : "";
    if (values[col] !== undefined && values[col] !== null && values[col] !== "") {
      parts.push(`<c r="${col}${rIdx}"${styleAttr} t="inlineStr"><is><t>${xmlEscape(String(values[col]))}</t></is></c>`);
    } else if (numValues[col] !== undefined && numValues[col] !== null) {
      parts.push(`<c r="${col}${rIdx}"${styleAttr}><v>${numValues[col]}</v></c>`);
    } else {
      parts.push(`<c r="${col}${rIdx}"${styleAttr}/>`);
    }
  }
  parts.push("</row>");
  return parts.join("");
}

function itemToRowSpecs(item: Product) {
  const ma = item.ma_noi_bo;
  const hasConv = Boolean(item.quy_cach && item.ty_le);

  const parentValues: Record<string, string> = {
    A: "Toàn chuỗi",
    C: hasConv ? LOAI_HANG_CHA : LOAI_KHONG_THUOC_TINH,
    D: ma,
    E: item.ma_vach || "",
    G: (item.ten_hoa_don || item.ten_hang_hoa || "").trim(),
    I: (item.dvt || "").trim(),
    L: item.brand?.name || "",
    N: item.category_sheet || "",
  };
  const parentNum: Record<string, number | null> = { H: item.gia_ban, J: 8 };

  const specs: [Record<string, string>, Record<string, number | null | undefined>][] = [[parentValues, parentNum]];

  if (hasConv) {
    const childValues: Record<string, string> = {
      A: "Toàn chuỗi",
      C: LOAI_HANG_CON_DVT,
      F: ma,
      X: "Thùng",
    };
    const childNum: Record<string, number | null | undefined> = {
      Y: item.ty_le,
      Z: item.gia_thung,
    };
    specs.push([childValues, childNum]);
  }
  return specs;
}

export async function buildMisaFile(items: Product[]): Promise<Buffer> {
  const allSpecs: [Record<string, string>, Record<string, number | null | undefined>][] = [];
  for (const it of items) {
    allSpecs.push(...itemToRowSpecs(it));
  }
  const n = allSpecs.length;
  const newRows = allSpecs.map(([v, nv], i) => buildRow(6 + i, v, nv)).join("");

  const templateBuf = fs.readFileSync(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBuf);

  const sheetPath = "xl/worksheets/sheet2.xml"; // "Tep nhap khau"
  const sheetXmlFile = zip.file(sheetPath);
  if (!sheetXmlFile) throw new Error("Không tìm thấy sheet2.xml trong file mẫu MISA");
  const sheetXml = await sheetXmlFile.async("string");

  const start = sheetXml.indexOf('<row r="6"');
  const endRowNum = 6 + n;
  let end = sheetXml.indexOf(`<row r="${endRowNum}"`);
  if (end === -1) end = sheetXml.indexOf("</sheetData>");

  const newSheetXml = sheetXml.slice(0, start) + newRows + sheetXml.slice(end);
  zip.file(sheetPath, newSheetXml);

  const outBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return outBuf;
}
