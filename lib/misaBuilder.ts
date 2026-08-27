import JSZip from "jszip";
import fs from "fs";
import path from "path";
import { Product } from "./types";
import { extractUnitFromQuyCach } from "./suggestionLists";

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
  // Không kèm x14ac:dyDescent — bản mẫu mới (tải trực tiếp từ MISA 21/08)
  // không khai báo namespace x14ac ở gốc <worksheet>, thêm attribute dùng
  // prefix đó vào sẽ làm XML không hợp lệ ("unbound prefix"). Bỏ hẳn, chỉ
  // ảnh hưởng cách Excel tự tính chiều cao dòng mặc định, không ảnh hưởng dữ
  // liệu hay tính hợp lệ khi MISA đọc file.
  const parts: string[] = [`<row r="${rIdx}" spans="1:58" ht="16.5">`];
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

export type MisaExportMode = "new" | "add_unit_only";

function itemToRowSpecs(item: Product, mode: MisaExportMode) {
  const ma = item.ma_noi_bo;
  // KHÁC file Cập nhật (misaUpdateBuilder.ts): ở đây KHÔNG đòi gia_thung phải
  // có sẵn — chỉ cần đã biết quy_cach+ty_le (tức đã biết SẼ bán theo Thùng,
  // dù chưa chốt giá) là sinh luôn dòng con để MISA tạo cấp Thùng ngay từ lúc
  // tạo sản phẩm. Giá bỏ trống (buildRow tự để cell rỗng khi gia_thung null)
  // — có thể bổ sung giá sau này qua file Cập nhật, không cần tạo bù cấp Thùng
  // lần 2. ĐANG THỬ NGHIỆM: guard cũ (đòi có giá) tồn tại vì nghi MISA có thể
  // từ chối dòng con thiếu giá (suy ra từ lỗi DC0001-DC0007 gặp ở file Cập
  // nhật, chưa xác nhận riêng cho file Nhập khẩu hàng hóa) — nếu MISA báo lỗi
  // "tệp không hợp lệ"/thiếu giá khi test thật, phải khôi phục lại điều kiện
  // `&& item.gia_thung` / `&& item.gia_hop` như cũ.
  const hasConv = Boolean(item.quy_cach && item.ty_le);
  // Cấp Hộp (trung gian) — chỉ số ít sản phẩm bán đủ 3 cấp Gói/Túi → Hộp →
  // Thùng mới có (vd Bột Rau Câu); Gói/Hộp/Thùng dùng chung 1 mã hàng hóa,
  // nhân viên tự chọn đơn vị lúc quét trên MISA nên không cần mã vạch riêng.
  const hasHop = Boolean(item.dvt_cap_2 && item.ty_le_cap_2);

  const parentValues: Record<string, string> = {
    A: "Toàn chuỗi",
    C: hasConv || hasHop ? LOAI_HANG_CHA : LOAI_KHONG_THUOC_TINH,
    D: ma,
    E: item.ma_vach || "",
    G: (item.ten_hang_hoa || item.ten_hoa_don || "").trim(),
    I: (item.dvt || "").trim(),
    L: item.brand?.name || "",
    N: item.category_sheet || "",
    // MISA thêm cột này (W) vào file mẫu sau này — không có ở bản mẫu cũ. Xác
    // nhận qua bản mẫu mới tải trực tiếp từ MISA (21/08): toàn bộ cột từ đây
    // trở đi lệch thêm 1 vị trí so với trước, đã cập nhật lại bên dưới.
    W: (item.ten_hoa_don || "").trim(),
  };
  const parentNum: Record<string, number | null> = { H: item.gia_ban, J: 8 };

  // mode "add_unit_only": mã cha ĐÃ tồn tại sẵn trên MISA — gửi lại dòng cha
  // sẽ bị MISA từ chối ("Mã hàng hóa đã tồn tại") và kéo theo từ chối luôn cả
  // dòng con Thùng/Hộp đi kèm ("...vui lòng sử dụng tính năng nhập khẩu cập
  // nhật") — xác nhận bằng lỗi thật (801/805 dòng lỗi khi xuất lẫn cả 2 loại
  // trong 1 lần). Chỉ gửi đúng dòng con (F: ma vẫn tham chiếu đúng mã cha có
  // sẵn) để MISA thêm cấp đơn vị còn thiếu mà không đụng tới dòng cha.
  const specs: [Record<string, string>, Record<string, number | null | undefined>][] =
    mode === "new" ? [[parentValues, parentNum]] : [];

  // Sinh trước cấp Hộp rồi tới cấp Thùng — khớp thứ tự Gói → Hộp → Thùng.
  // Cả 2 đều là dòng "con" độc lập tham chiếu thẳng về mã cha (F: ma), không
  // lồng dòng Thùng vào trong dòng Hộp.
  if (hasHop) {
    const hopValues: Record<string, string> = {
      A: "Toàn chuỗi",
      C: LOAI_HANG_CON_DVT,
      F: ma,
      // extractUnitFromQuyCach chứ không dùng dvt_cap_2 thô — cột này đôi khi
      // được điền kiểu mô tả "Hộp (12 gói)" giống quy_cach thay vì chỉ "Hộp",
      // mà MISA chỉ nhận đơn vị tính đơn giản (Hộp/Túi/Thùng/...), không nhận
      // cả cụm mô tả kèm số lượng.
      Y: extractUnitFromQuyCach(item.dvt_cap_2 || ""),
    };
    const hopNum: Record<string, number | null | undefined> = {
      Z: item.ty_le_cap_2,
      AA: item.gia_hop,
    };
    specs.push([hopValues, hopNum]);
  }

  if (hasConv) {
    const childValues: Record<string, string> = {
      A: "Toàn chuỗi",
      C: LOAI_HANG_CON_DVT,
      F: ma,
      Y: extractUnitFromQuyCach(item.quy_cach || ""),
    };
    // MISA's "Tỷ lệ quy đổi" luôn tính so với đơn vị tính CƠ BẢN (dvt), không
    // phải so với cấp Hộp trung gian. Nhưng ty_le trong app lại nhập theo
    // nghĩa "Thùng chứa bao nhiêu Hộp" (khớp chữ trong quy_cach, vd "Thùng
    // (10 hộp)" -> ty_le=10) — nên khi có cả cấp Hộp, phải nhân dồn qua
    // ty_le_cap_2 mới ra đúng tỷ lệ so với đơn vị cơ bản. Phát hiện qua lỗi
    // thật: Sóc Vàng (54070001) ty_le=10, ty_le_cap_2=10, gửi thẳng ty_le=10
    // khiến MISA hiểu sai "1 Thùng = 10 Túi" thay vì đúng "1 Thùng = 10 Hộp"
    // (= 100 Túi).
    const childNum: Record<string, number | null | undefined> = {
      Z: hasHop ? (item.ty_le as number) * (item.ty_le_cap_2 as number) : item.ty_le,
      AA: item.gia_thung,
    };
    specs.push([childValues, childNum]);
  }
  return specs;
}

export async function buildMisaFile(items: Product[], mode: MisaExportMode = "new"): Promise<Buffer> {
  const allSpecs: [Record<string, string>, Record<string, number | null | undefined>][] = [];
  for (const it of items) {
    allSpecs.push(...itemToRowSpecs(it, mode));
  }
  const newRows = allSpecs.map(([v, nv], i) => buildRow(6 + i, v, nv)).join("");

  const templateBuf = fs.readFileSync(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBuf);

  const sheetPath = "xl/worksheets/sheet2.xml"; // "Tep nhap khau"
  const sheetXmlFile = zip.file(sheetPath);
  if (!sheetXmlFile) throw new Error("Không tìm thấy sheet2.xml trong file mẫu MISA");
  const sheetXml = await sheetXmlFile.async("string");

  // The shipped template has no real data rows below the row-5 header (this
  // was sanitized after discovering MISA's own worked examples — an "áo
  // thun" parent+4-children block and a "sữa tươi" one — sat in rows 6-16
  // and leaked into small exports whenever generated content didn't fully
  // overwrite them). Always insert right before </sheetData> rather than
  // searching for a specific row number, so this can't regress even if the
  // template changes again.
  const end = sheetXml.indexOf("</sheetData>");
  if (end === -1) throw new Error("Không tìm thấy vùng dữ liệu trong file mẫu MISA");

  const newSheetXml = sheetXml.slice(0, end) + newRows + sheetXml.slice(end);
  zip.file(sheetPath, newSheetXml);

  const outBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return outBuf;
}
