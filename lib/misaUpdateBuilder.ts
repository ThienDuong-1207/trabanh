import JSZip from "jszip";
import fs from "fs";
import path from "path";
import { Product } from "./types";
import { extractUnitFromQuyCach } from "./suggestionLists";

// Builds MISA's "cập nhật thông tin hàng hóa" (update existing product info)
// import file — a different template from misaBuilder.ts's "nhập hàng hóa
// mới" (create new product) file. Same byte-patch technique: keep the
// template's sheet structure/styles/dropdown validations untouched, splice
// in our own rows starting at row 3 (rows 1-2 are the fixed header).
//
// Confirmed by cross-referencing 3 real products against MISA's own export:
// `ma_noi_bo` IS the exact "Mã hàng hóa" code MISA already uses to identify
// the product (e.g. "SUATUOI-MILKSECRET-185500") — not a value we invent,
// so this file's key column always matches an existing MISA product.
const TEMPLATE_PATH = path.join(process.cwd(), "public", "templates", "Nhap_khau_cap_nhat_thong_tin_hang_hoa.xlsx");
const cellsTemplate: [string, string | null][] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "lib", "misaUpdateRowStyle.json"), "utf-8")
);

// MISA's internal "Nhóm hàng hóa" codes — derived by cross-referencing the
// template's own sample rows against our database (10 of 11 categories
// matched a real product 1:1). "Công cụ dụng cụ" -> NHH000010 is inferred
// (it's the one category and the one code left over from the closed set
// NHH000001-NHH000011 the template's Categories sheet lists), not directly
// observed in a real row.
const CATEGORY_TO_NHH: Record<string, string> = {
  "Sữa tươi": "NHH000001",
  "Trà": "NHH000002",
  "Sữa đặc": "NHH000003",
  "Bột": "NHH000004",
  "Đồ lon": "NHH000005",
  "Mứt": "NHH000006",
  "Syrup": "NHH000007",
  "Trân châu": "NHH000008",
  "Kem đông lạnh": "NHH000009",
  "Công cụ dụng cụ": "NHH000010",
  "Mặt hàng khác": "NHH000011",
};

const TAX_RATE = "8"; // every row in the reference file uses 8%, same default as misaBuilder.ts

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildRow(rIdx: number, values: Record<string, string>, numValues: Record<string, number | null | undefined>) {
  const parts: string[] = [`<row r="${rIdx}" spans="1:27" ht="15">`];
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

// One row per unit (retail always, a case-level row only when quy_cach+ty_le
// are both set). The case unit's name comes from quy_cach itself (e.g. "Hộp"
// out of "Hộp (12 gói)") rather than assuming "Thùng" — plenty of products
// use "Hộp" or another word as their actual case-level packaging unit.
function itemToRowSpecs(item: Product) {
  const ma = item.ma_noi_bo;
  const hasConv = Boolean(item.quy_cach && item.ty_le);
  const nhh = CATEGORY_TO_NHH[item.category_sheet] ?? "";

  const retailValues: Record<string, string> = {
    A: ma,
    C: item.ma_vach || "",
    G: (item.ten_hang_hoa || "").trim(),
    H: nhh,
    I: (item.dvt || "").trim(),
    K: TAX_RATE,
    L: item.brand?.name || "",
    P: TAX_RATE,
    Z: (item.ten_hoa_don || item.ten_hang_hoa || "").trim(),
  };
  const retailNum: Record<string, number | null | undefined> = { D: 0, J: item.gia_ban, Y: 0 };

  const specs: [Record<string, string>, Record<string, number | null | undefined>][] = [[retailValues, retailNum]];

  if (hasConv) {
    const caseValues: Record<string, string> = {
      A: ma,
      C: item.ma_thung || "",
      I: extractUnitFromQuyCach(item.quy_cach || ""),
      S: "00001",
    };
    const caseNum: Record<string, number | null | undefined> = { D: 0, J: item.gia_thung, T: item.ty_le };
    specs.push([caseValues, caseNum]);
  }
  return specs;
}

export async function buildMisaUpdateFile(items: Product[]): Promise<Buffer> {
  const allSpecs: [Record<string, string>, Record<string, number | null | undefined>][] = [];
  for (const it of items) {
    allSpecs.push(...itemToRowSpecs(it));
  }
  const newRows = allSpecs.map(([v, nv], i) => buildRow(3 + i, v, nv)).join("");

  const templateBuf = fs.readFileSync(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBuf);

  const sheetPath = "xl/worksheets/sheet1.xml"; // "Nhap_khau_cap_nhat_thong_tin"
  const sheetXmlFile = zip.file(sheetPath);
  if (!sheetXmlFile) throw new Error("Không tìm thấy sheet1.xml trong file mẫu cập nhật MISA");
  const sheetXml = await sheetXmlFile.async("string");

  // The shipped template has no real data rows (stripped before committing,
  // so no real business data sits in the repo) — rows 1-2 are the fixed
  // header, immediately followed by </sheetData>, so new rows always insert
  // right there.
  const end = sheetXml.indexOf("</sheetData>");
  if (end === -1) throw new Error("Không tìm thấy vùng dữ liệu trong file mẫu cập nhật MISA");

  const newSheetXml = sheetXml.slice(0, end) + newRows + sheetXml.slice(end);
  zip.file(sheetPath, newSheetXml);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
