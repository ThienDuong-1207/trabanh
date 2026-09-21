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
  // Giữ NGUYÊN bộ ký tự đầy đủ (~10.5MB/weight, chỉ ép về 2 weight tĩnh
  // 400/700 từ variable font gốc bằng fontTools varLib.instancer, KHÔNG cắt
  // gọn/subset) — vì tên sản phẩm giờ được dịch tự động qua Claude API
  // (lib/productTranslation.ts) nên có thể ra bất kỳ chữ Hán nào, không còn
  // là tập nhãn cố định nhỏ như ban đầu (từng cắt gọn còn ~45KB/file khi chỉ
  // cần đúng chữ trong tiêu đề/tên cột/ghi chú). Đã xác nhận font này có sẵn
  // đủ dấu tiếng Việt (kiểm tra cmap) nên dùng chung 1 font cho toàn bộ nội
  // dung ở chế độ tiếng Trung — không cần ép font riêng cho tên sản phẩm/địa
  // chỉ tiệm như bản cắt gọn trước đây.
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
