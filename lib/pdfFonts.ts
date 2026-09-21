import path from "path";
import pdfmake from "pdfmake";

// pdfmake's PdfPrinter needs font descriptors pointing at real TTF data —
// unlike its browser build, it doesn't bundle Roboto server-side. These are
// the same 4 Roboto files (full Vietnamese glyph coverage) added under
// public/fonts for that reason. Shared module so every PDF builder registers
// fonts/access policy exactly once, on the one pdfmake singleton instance.
const FONT_DIR = path.join(process.cwd(), "public", "fonts");

pdfmake.addFonts({
  Roboto: {
    normal: path.join(FONT_DIR, "Roboto-Regular.ttf"),
    bold: path.join(FONT_DIR, "Roboto-Medium.ttf"),
    italics: path.join(FONT_DIR, "Roboto-Italic.ttf"),
    bolditalics: path.join(FONT_DIR, "Roboto-MediumItalic.ttf"),
  },
  // Arimo: an Arial-metric-compatible, openly-licensed (OFL) typeface, for
  // builders where the shop specifically wants an Arial look. Built from
  // @fontsource/arimo's "latin" + "vietnamese" subset files merged into one
  // file per weight with `python -m fontTools.merge` — each subset alone is
  // missing glyphs the other has (e.g. "latin" alone has no Đ/Ữ/Ặ, and the
  // "vietnamese" subset alone has no plain ASCII digits/letters).
  Arimo: {
    normal: path.join(FONT_DIR, "Arimo-Regular.ttf"),
    bold: path.join(FONT_DIR, "Arimo-Bold.ttf"),
    italics: path.join(FONT_DIR, "Arimo-Regular.ttf"),
    bolditalics: path.join(FONT_DIR, "Arimo-Bold.ttf"),
  },
  // NotoSansSC: chữ Hán giản thể cho bảng báo giá tiếng Trung (lib/quoteBuilder.ts).
  // File gốc (Google Noto Sans SC, giấy phép OFL) nặng ~10.5MB/weight vì chứa
  // toàn bộ bảng chữ Hán — đã cắt gọn (fontTools varLib.instancer để lấy đúng
  // 2 weight tĩnh 400/700 từ variable font, rồi pyftsubset) chỉ còn đúng ~100
  // ký tự thật sự dùng trong các nhãn cố định (tiêu đề, tên cột, ghi chú, tên
  // nhóm hàng + vài ký tự Việt có dấu trong "Tiệm Trà&Bánh") — còn ~45KB/file
  // thay vì ~10.5MB. KHÔNG dùng để in tên sản phẩm (tiếng Việt, thiếu dấu) hay
  // địa chỉ tiệm — 2 chỗ đó vẫn giữ font Roboto ngay cả khi chọn tiếng Trung.
  NotoSansSC: {
    normal: path.join(FONT_DIR, "NotoSansSC-Regular.ttf"),
    bold: path.join(FONT_DIR, "NotoSansSC-Bold.ttf"),
    italics: path.join(FONT_DIR, "NotoSansSC-Regular.ttf"),
    bolditalics: path.join(FONT_DIR, "NotoSansSC-Bold.ttf"),
  },
});
// docDefinition content never references remote resources, so deny those —
// but local access must stay allowed since the Roboto font files above are
// themselves loaded through this same policy check.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => true);

export default pdfmake;
